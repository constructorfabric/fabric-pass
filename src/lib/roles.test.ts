import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest'
import { pool } from './db.ts'
import type { Contributor } from './contributors.ts'

function contributor(overrides: Partial<Contributor> & { githubId: string }): Contributor {
  return {
    id: 'id-1',
    githubLogin: 'octocat',
    status: 'confirmed',
    isAgent: false,
    isAdmin: false,
    profileCompleteness: 'incomplete',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  }
}

// `env` (and isRootUser, which reads it) is a module-level singleton parsed
// at import time — same seam root-user.test.ts's own tests use — so
// exercising more than one ROOT_GITHUB_ID value needs a fresh module graph
// per test. TRUNCATE only matters for the DB-backed tests further down, but
// running it for every test is harmless. `tracks` no longer FK-references
// contributors itself (IDEA-055 moved leaders to track_leaders, which
// does), so it needs listing explicitly for `seedTrack` below to get a
// clean slate every test — CASCADE from contributors alone won't reach it.
beforeEach(async () => {
  vi.resetModules()
  await pool.query('TRUNCATE contributors, tracks CASCADE')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

afterAll(async () => {
  await pool.end()
})

test('isAdmin is true for the root user regardless of isAdmin on the row', async () => {
  vi.stubEnv('ROOT_GITHUB_ID', '1001')
  const { isAdmin } = await import('./roles.ts')
  expect(isAdmin(contributor({ githubId: '1001', isAdmin: false }))).toBe(true)
})

test('isAdmin is true when the row itself is marked admin, root user or not', async () => {
  vi.stubEnv('ROOT_GITHUB_ID', undefined)
  const { isAdmin } = await import('./roles.ts')
  expect(isAdmin(contributor({ githubId: '2002', isAdmin: true }))).toBe(true)
})

test('isAdmin is false for a plain contributor, neither the root user nor marked admin', async () => {
  vi.stubEnv('ROOT_GITHUB_ID', '1001')
  const { isAdmin } = await import('./roles.ts')
  expect(isAdmin(contributor({ githubId: '2002', isAdmin: false }))).toBe(false)
})

// IDEA-071 — Revoke exists to pull an existing contributor's access; an
// Admin revoked by two other Admins must lose in-app Admin capability too,
// not just their GitHub team/org membership.
test('isAdmin is false for a revoked contributor, even one marked admin', async () => {
  vi.stubEnv('ROOT_GITHUB_ID', undefined)
  const { isAdmin } = await import('./roles.ts')
  expect(isAdmin(contributor({ githubId: '2002', isAdmin: true, status: 'revoked' }))).toBe(false)
})

// isRootUser is the env-configured bootstrap admin and stays exempt from
// the status check above — it may have no `confirmed` (or any) contributor
// row yet, and gating it here would reintroduce the exact chicken-and-egg
// problem it exists to avoid.
test('isAdmin is true for the root user even with a non-confirmed status', async () => {
  vi.stubEnv('ROOT_GITHUB_ID', '1001')
  const { isAdmin } = await import('./roles.ts')
  expect(isAdmin(contributor({ githubId: '1001', isAdmin: false, status: 'draft' }))).toBe(true)
})

async function seedTrack(slug: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>('INSERT INTO tracks (slug, name) VALUES ($1, $1) RETURNING id', [slug])
  return rows[0].id
}

test('isTrackAdmin is true only for a contributor actually in track_admins for that track', async () => {
  const { isTrackAdmin } = await import('./roles.ts')
  await pool.query("INSERT INTO contributors (github_id, github_login) VALUES (1001, 'octocat'), (2002, 'grace')")
  const trackId = await seedTrack('studio')
  await pool.query('INSERT INTO track_admins (track_id, github_id) VALUES ($1, 1001)', [trackId])

  expect(await isTrackAdmin('1001', trackId)).toBe(true)
  expect(await isTrackAdmin('2002', trackId)).toBe(false)
})

test('adminTrackIds lists every track a contributor administers, and nothing else', async () => {
  const { adminTrackIds } = await import('./roles.ts')
  await pool.query("INSERT INTO contributors (github_id, github_login) VALUES (1001, 'octocat')")
  const studioId = await seedTrack('studio')
  const insightId = await seedTrack('insight')
  await seedTrack('gears') // 1001 admins neither this nor is asked about it
  await pool.query('INSERT INTO track_admins (track_id, github_id) VALUES ($1, 1001), ($2, 1001)', [studioId, insightId])

  const ids = await adminTrackIds('1001')
  expect(ids.sort()).toEqual([studioId, insightId].sort())
})
