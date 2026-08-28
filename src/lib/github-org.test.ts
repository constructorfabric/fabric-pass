import { afterEach, expect, test, vi } from 'vitest'

const { fakeEnv } = vi.hoisted(() => ({ fakeEnv: { GITHUB_ORG_TOKEN: undefined as string | undefined } }))

vi.mock('@/lib/env', () => ({ env: fakeEnv }))

const {
  inviteToGitHubOrg,
  addToGitHubTeam,
  ensureGitHubTeam,
  removeFromGitHubTeam,
  removeFromGitHubOrg,
  listOrgRepositories,
  listOrgRepositoryProperties,
  listOrgPropertySchema,
} = await import('./github-org.ts')

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

test('listOrgRepositories returns an empty array without throwing when GITHUB_ORG_TOKEN is unset', async () => {
  await expect(listOrgRepositories('constructorfabric')).resolves.toEqual([])
})

test('listOrgRepositories maps the GitHub response shape and requests per_page=100', async () => {
  fakeEnv.GITHUB_ORG_TOKEN = 'test-token'
  const fetchMock = vi.fn(async () =>
    Response.json([{ name: 'fabric-pass', html_url: 'https://github.com/constructorfabric/fabric-pass', archived: false, private: false }]),
  )
  vi.stubGlobal('fetch', fetchMock)

  const result = await listOrgRepositories('constructorfabric')

  expect(result).toEqual([
    { name: 'fabric-pass', htmlUrl: 'https://github.com/constructorfabric/fabric-pass', archived: false, private: false },
  ])
  expect(fetchMock).toHaveBeenCalledWith(
    'https://api.github.com/orgs/constructorfabric/repos?per_page=100&page=1',
    expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) }),
  )
})

test('listOrgRepositories follows pagination until a short page', async () => {
  fakeEnv.GITHUB_ORG_TOKEN = 'test-token'
  const fullPage = Array.from({ length: 100 }, (_, i) => ({
    name: `repo-${i}`,
    html_url: `https://github.com/constructorfabric/repo-${i}`,
    archived: false,
    private: false,
  }))
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(Response.json(fullPage))
    .mockResolvedValueOnce(Response.json([{ name: 'last-repo', html_url: 'https://github.com/constructorfabric/last-repo', archived: false, private: false }]))
  vi.stubGlobal('fetch', fetchMock)

  const result = await listOrgRepositories('constructorfabric')

  expect(result).toHaveLength(101)
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://api.github.com/orgs/constructorfabric/repos?per_page=100&page=2', expect.anything())
})

test('listOrgRepositories returns an empty array without throwing when GitHub responds with an error', async () => {
  fakeEnv.GITHUB_ORG_TOKEN = 'test-token'
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('nope', { status: 403 })),
  )

  await expect(listOrgRepositories('constructorfabric')).resolves.toEqual([])
})

test('listOrgRepositoryProperties maps each repository\'s properties into a name-keyed record', async () => {
  fakeEnv.GITHUB_ORG_TOKEN = 'test-token'
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json([
        {
          repository_name: 'studio-web',
          properties: [
            { property_name: 'Track', value: 'Studio' },
            { property_name: 'Type', value: null },
          ],
        },
      ]),
    ),
  )

  const result = await listOrgRepositoryProperties('constructorfabric')

  expect(result).toEqual([{ repoName: 'studio-web', properties: { Track: 'Studio', Type: null } }])
})

test('listOrgPropertySchema keeps only single_select properties and reads their allowed values', async () => {
  fakeEnv.GITHUB_ORG_TOKEN = 'test-token'
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json([
        { property_name: 'Track', value_type: 'single_select', allowed_values: ['Studio', 'Insight'] },
        { property_name: 'Description', value_type: 'string' },
      ]),
    ),
  )

  const result = await listOrgPropertySchema('constructorfabric')

  expect(result).toEqual([{ name: 'Track', allowedValues: ['Studio', 'Insight'] }])
})
