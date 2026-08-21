import { afterEach, expect, test, vi } from 'vitest'

const { fakeEnv } = vi.hoisted(() => ({ fakeEnv: { GITHUB_ORG_TOKEN: undefined as string | undefined } }))

vi.mock('@/lib/env', () => ({ env: fakeEnv }))

const { inviteToGitHubOrg, addToGitHubTeam, ensureGitHubTeam, removeFromGitHubTeam, removeFromGitHubOrg } = await import(
  './github-org.ts'
)

afterEach(() => {
  fakeEnv.GITHUB_ORG_TOKEN = undefined
  vi.unstubAllGlobals()
})

test('inviteToGitHubOrg returns false without throwing when GITHUB_ORG_TOKEN is unset', async () => {
  await expect(inviteToGitHubOrg('octocat', 'constructorfabric')).resolves.toBe(false)
})

test('inviteToGitHubOrg calls the org membership endpoint and returns true on success', async () => {
  fakeEnv.GITHUB_ORG_TOKEN = 'test-token'
  const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)

  const result = await inviteToGitHubOrg('octocat', 'constructorfabric')

  expect(result).toBe(true)
  expect(fetchMock).toHaveBeenCalledWith(
    'https://api.github.com/orgs/constructorfabric/memberships/octocat',
    expect.objectContaining({
      method: 'PUT',
      headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
    }),
  )
})

test('inviteToGitHubOrg returns false without throwing when GitHub responds with an error', async () => {
  fakeEnv.GITHUB_ORG_TOKEN = 'test-token'
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('nope', { status: 403 })),
  )

  await expect(inviteToGitHubOrg('octocat', 'constructorfabric')).resolves.toBe(false)
})

test('inviteToGitHubOrg returns false without throwing on a network failure', async () => {
  fakeEnv.GITHUB_ORG_TOKEN = 'test-token'
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('network down')
    }),
  )

  await expect(inviteToGitHubOrg('octocat', 'constructorfabric')).resolves.toBe(false)
})

test('addToGitHubTeam returns false without throwing when GITHUB_ORG_TOKEN is unset', async () => {
  await expect(addToGitHubTeam('octocat', 'constructorfabric', 'studio-track')).resolves.toBe(false)
})

test('addToGitHubTeam calls the team membership endpoint and returns true on success', async () => {
  fakeEnv.GITHUB_ORG_TOKEN = 'test-token'
  const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)

  const result = await addToGitHubTeam('octocat', 'constructorfabric', 'studio-track')

  expect(result).toBe(true)
  expect(fetchMock).toHaveBeenCalledWith(
    'https://api.github.com/orgs/constructorfabric/teams/studio-track/memberships/octocat',
    expect.objectContaining({ method: 'PUT' }),
  )
})

test('ensureGitHubTeam returns false without throwing when GITHUB_ORG_TOKEN is unset', async () => {
  await expect(ensureGitHubTeam('constructorfabric', 'gears-contributors')).resolves.toBe(false)
})

test('ensureGitHubTeam returns true and never calls create when the team already exists', async () => {
  fakeEnv.GITHUB_ORG_TOKEN = 'test-token'
  const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)

  const result = await ensureGitHubTeam('constructorfabric', 'gears-contributors')

  expect(result).toBe(true)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(fetchMock).toHaveBeenCalledWith(
    'https://api.github.com/orgs/constructorfabric/teams/gears-contributors',
    expect.objectContaining({}),
  )
})

test('ensureGitHubTeam creates the team, named exactly the given slug, when a lookup 404s', async () => {
  fakeEnv.GITHUB_ORG_TOKEN = 'test-token'
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response('not found', { status: 404 }))
    .mockResolvedValueOnce(new Response(null, { status: 201 }))
  vi.stubGlobal('fetch', fetchMock)

  const result = await ensureGitHubTeam('constructorfabric', 'gears-contributors')

  expect(result).toBe(true)
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    'https://api.github.com/orgs/constructorfabric/teams',
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'gears-contributors' }) }),
  )
})

test('ensureGitHubTeam returns false without throwing when team creation fails', async () => {
  fakeEnv.GITHUB_ORG_TOKEN = 'test-token'
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response('not found', { status: 404 }))
    .mockResolvedValueOnce(new Response('nope', { status: 403 }))
  vi.stubGlobal('fetch', fetchMock)

  await expect(ensureGitHubTeam('constructorfabric', 'gears-contributors')).resolves.toBe(false)
})

test('ensureGitHubTeam returns false without throwing when the existence lookup itself errors', async () => {
  fakeEnv.GITHUB_ORG_TOKEN = 'test-token'
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('server error', { status: 500 })),
  )

  await expect(ensureGitHubTeam('constructorfabric', 'gears-contributors')).resolves.toBe(false)
})

test('ensureGitHubTeam returns false without throwing on a network failure', async () => {
  fakeEnv.GITHUB_ORG_TOKEN = 'test-token'
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('network down')
    }),
  )

  await expect(ensureGitHubTeam('constructorfabric', 'gears-contributors')).resolves.toBe(false)
})

test('removeFromGitHubTeam returns false without throwing when GITHUB_ORG_TOKEN is unset', async () => {
  await expect(removeFromGitHubTeam('octocat', 'constructorfabric', 'studio-contributors')).resolves.toBe(false)
})

test('removeFromGitHubTeam calls the team membership endpoint with DELETE and returns true on success', async () => {
  fakeEnv.GITHUB_ORG_TOKEN = 'test-token'
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetchMock)

  const result = await removeFromGitHubTeam('octocat', 'constructorfabric', 'studio-contributors')

  expect(result).toBe(true)
  expect(fetchMock).toHaveBeenCalledWith(
    'https://api.github.com/orgs/constructorfabric/teams/studio-contributors/memberships/octocat',
    expect.objectContaining({ method: 'DELETE' }),
  )
})

// Unlike addToGitHubTeam, a 404 here means "already not a member" —
// already in the desired end state, not a failure.
test('removeFromGitHubTeam returns true, not false, on a 404 (already not a member)', async () => {
  fakeEnv.GITHUB_ORG_TOKEN = 'test-token'
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('not found', { status: 404 })),
  )

  await expect(removeFromGitHubTeam('octocat', 'constructorfabric', 'studio-contributors')).resolves.toBe(true)
})

test('removeFromGitHubTeam returns false without throwing on a network failure', async () => {
  fakeEnv.GITHUB_ORG_TOKEN = 'test-token'
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('network down')
    }),
  )

  await expect(removeFromGitHubTeam('octocat', 'constructorfabric', 'studio-contributors')).resolves.toBe(false)
})

test('removeFromGitHubOrg returns false without throwing when GITHUB_ORG_TOKEN is unset', async () => {
  await expect(removeFromGitHubOrg('octocat', 'constructorfabric')).resolves.toBe(false)
})

test('removeFromGitHubOrg calls the org membership endpoint with DELETE and returns true on success', async () => {
  fakeEnv.GITHUB_ORG_TOKEN = 'test-token'
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetchMock)

  const result = await removeFromGitHubOrg('octocat', 'constructorfabric')

  expect(result).toBe(true)
  expect(fetchMock).toHaveBeenCalledWith(
    'https://api.github.com/orgs/constructorfabric/memberships/octocat',
    expect.objectContaining({ method: 'DELETE' }),
  )
})

// Unlike a grant, a 404 here means "already not a member" — already in the
// desired end state, not a failure — same reasoning removeFromGitHubTeam's
// own 404 handling already documents.
test('removeFromGitHubOrg returns true, not false, on a 404 (already not a member)', async () => {
  fakeEnv.GITHUB_ORG_TOKEN = 'test-token'
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('not found', { status: 404 })),
  )

  await expect(removeFromGitHubOrg('octocat', 'constructorfabric')).resolves.toBe(true)
})

test('removeFromGitHubOrg returns false without throwing on a network failure', async () => {
  fakeEnv.GITHUB_ORG_TOKEN = 'test-token'
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('network down')
    }),
  )

  await expect(removeFromGitHubOrg('octocat', 'constructorfabric')).resolves.toBe(false)
})
