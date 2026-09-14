import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest'

// lib/contributors.ts/lib/app-config.ts/lib/db.ts all import '@/lib/env'
// transitively — mocking it here (rather than vi.stubEnv + vi.resetModules,
// the seam root-user.test.ts uses for a plain env-driven module with no
// database of its own) keeps this file's whole module graph, crucially
// lib/db.ts's pool, a single instance for the entire run, same as every
// other real-database test file in this suite. Starts as a copy of
// whatever .env.test already loaded (tests/setup.ts has run by the time
// this executes), with GITHUB_ORG_TOKEN mutable per test — .env.test
// deliberately leaves it unset, the same "unconfigured by default" posture
// LINKEDIN_CLIENT_ID has (see auth-linkedin-configuration.test.ts).
// CONTRIBUTORS_SEED_SECRET is also called out explicitly (rather than left
// to the spread above) so TypeScript keeps it as a known property of
// fakeEnv's inferred type — object-literal inference from a spread drops
// the source type's index signature, so only explicitly listed keys are
// visible to assignment later in this file.
const { fakeEnv, orgState } = vi.hoisted(() => ({
  fakeEnv: {
    ...(process.env as Record<string, string | undefined>),
    GITHUB_ORG_TOKEN: undefined as string | undefined,
    CONTRIBUTORS_SEED_SECRET: process.env.CONTRIBUTORS_SEED_SECRET as string | undefined,
  },
  orgState: {
    members: [] as { githubId: string; login: string }[],
    profiles: {} as Record<string, { githubId: string; login: string; name?: string; email?: string } | null>,
  },
}))

vi.mock('@/lib/env', () => ({ env: fakeEnv }))

vi.mock('@/lib/github-org', () => ({
  listOrgMembers: async () => orgState.members,
  fetchGitHubUserProfile: async (login: string) => orgState.profiles[login] ?? null,
}))

const { POST: seedRoute } = await import('@/app/internal/contributors/seed-from-org/route')
const { syncAppConfig } = await import('@/lib/app-config')
const { ensureContributor, findByGithubId, saveField } = await import('@/lib/contributors')
const { pool } = await import('@/lib/db')

// tests/setup.ts has loaded .env.test, so this matches its
// CONTRIBUTORS_SEED_SECRET.
const SEED_SECRET = 'test-contributors-seed-secret'

beforeEach(async () => {
  orgState.members = []
  orgState.profiles = {}
  // CASCADE: track_admins/tracks (migrations/010_tracks.sql) FK-reference
  // contributors, same as contributors-registry-routes.test.ts's own TRUNCATE.
  await pool.query('TRUNCATE contributors CASCADE')
  await pool.query('TRUNCATE app_config')
})

afterEach(() => {
  fakeEnv.GITHUB_ORG_TOKEN = undefined
  fakeEnv.CONTRIBUTORS_SEED_SECRET = SEED_SECRET
})

afterAll(async () => {
  await pool.end()
})

test('reports 503 when CONTRIBUTORS_SEED_SECRET is not configured, even with no Authorization header', async () => {
  fakeEnv.CONTRIBUTORS_SEED_SECRET = undefined

  const response = await seedRoute(
    new Request('http://localhost/internal/contributors/seed-from-org', { method: 'POST' }),
  )

  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({ error: 'CONTRIBUTORS_SEED_SECRET is not configured' })
})

test('refuses a request with no or the wrong secret', async () => {
  const noAuth = await seedRoute(new Request('http://localhost/internal/contributors/seed-from-org', { method: 'POST' }))
  expect(noAuth.status).toBe(401)

  const wrongAuth = await seedRoute(
    new Request('http://localhost/internal/contributors/seed-from-org', {
      method: 'POST',
      headers: { authorization: 'Bearer nope' },
    }),
  )
  expect(wrongAuth.status).toBe(401)
})

test('reports 409 when github_organization is not configured', async () => {
  const response = await seedRoute(
    new Request('http://localhost/internal/contributors/seed-from-org', {
      method: 'POST',
      headers: { authorization: `Bearer ${SEED_SECRET}` },
    }),
  )

  expect(response.status).toBe(409)
  expect(await response.json()).toEqual({ error: 'github_organization is not configured' })
})

test('reports 503 when GITHUB_ORG_TOKEN is not configured', async () => {
  await syncAppConfig({ githubOrganization: 'constructorfabric' })

  const response = await seedRoute(
    new Request('http://localhost/internal/contributors/seed-from-org', {
      method: 'POST',
      headers: { authorization: `Bearer ${SEED_SECRET}` },
    }),
  )

  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({ error: 'GITHUB_ORG_TOKEN is not configured' })
})

test('seeds a draft row per org member, carrying whatever the public profile offers', async () => {
  fakeEnv.GITHUB_ORG_TOKEN = 'test-token'
  await syncAppConfig({ githubOrganization: 'constructorfabric' })
  orgState.members = [
    { githubId: '1001', login: 'octocat' },
    { githubId: '2002', login: 'hubot' },
  ]
  orgState.profiles = {
    octocat: { githubId: '1001', login: 'octocat', name: 'The Octocat', email: 'octocat@github.com' },
    hubot: { githubId: '2002', login: 'hubot' },
  }

  const response = await seedRoute(
    new Request('http://localhost/internal/contributors/seed-from-org', {
      method: 'POST',
      headers: { authorization: `Bearer ${SEED_SECRET}` },
    }),
  )

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ members: 2, created: 2, existing: 0, unresolved: [] })

  const octocat = await findByGithubId('1001')
  expect(octocat?.status).toBe('draft')
  expect(octocat?.githubName).toBe('The Octocat')
  expect(octocat?.email).toBe('octocat@github.com')
  expect(octocat?.emailConfirmedAt).toBeInstanceOf(Date)

  const hubot = await findByGithubId('2002')
  expect(hubot?.status).toBe('draft')
  expect(hubot?.githubName).toBeUndefined()
  expect(hubot?.email).toBeUndefined()
  expect(hubot?.emailConfirmedAt).toBeUndefined()
})

test('never modifies an existing contributor row', async () => {
  fakeEnv.GITHUB_ORG_TOKEN = 'test-token'
  await syncAppConfig({ githubOrganization: 'constructorfabric' })
  await ensureContributor('1001', 'octocat', undefined, 'verified@github.com')
  await saveField('1001', 'name', 'Real Name')
  orgState.members = [{ githubId: '1001', login: 'octocat' }]
  orgState.profiles = { octocat: { githubId: '1001', login: 'octocat', name: 'A Different Name' } }

  const response = await seedRoute(
    new Request('http://localhost/internal/contributors/seed-from-org', {
      method: 'POST',
      headers: { authorization: `Bearer ${SEED_SECRET}` },
    }),
  )

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ members: 1, created: 0, existing: 1, unresolved: [] })

  const contributor = await findByGithubId('1001')
  expect(contributor?.name).toBe('Real Name')
  expect(contributor?.email).toBe('verified@github.com')
  expect(contributor?.githubEmail).toBe('verified@github.com')
  expect(contributor?.githubName).toBeUndefined()
})

test('lists an unresolved profile fetch, but still seeds a row for that member', async () => {
  fakeEnv.GITHUB_ORG_TOKEN = 'test-token'
  await syncAppConfig({ githubOrganization: 'constructorfabric' })
  orgState.members = [{ githubId: '3003', login: 'ghost' }]
  orgState.profiles = { ghost: null }

  const response = await seedRoute(
    new Request('http://localhost/internal/contributors/seed-from-org', {
      method: 'POST',
      headers: { authorization: `Bearer ${SEED_SECRET}` },
    }),
  )

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ members: 1, created: 1, existing: 0, unresolved: ['ghost'] })
  expect((await findByGithubId('3003'))?.status).toBe('draft')
})
