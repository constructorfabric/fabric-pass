import { afterAll, beforeEach, expect, test, vi } from 'vitest'

const { state } = vi.hoisted(() => ({
  state: {
    calls: [] as string[],
    ensureTeamResult: true,
  },
}))

// One ordered log of every GitHub-side call, so a test can pin down both
// what happened and in which order (team before membership, invite first).
vi.mock('@/lib/github-org', () => ({
  ensureGitHubTeam: async (org: string, team: string, options?: { privacy?: string }) => {
    state.calls.push(`ensure ${org}/${team} ${options?.privacy ?? 'default'}`)
    return state.ensureTeamResult
  },
  grantTeamRepository: async (org: string, team: string, owner: string, repo: string, permission: string) => {
    state.calls.push(`grant ${org}/${team} ${owner}/${repo} ${permission}`)
    return true
  },
  removeTeamRepository: async (org: string, team: string, owner: string, repo: string) => {
    state.calls.push(`ungrant ${org}/${team} ${owner}/${repo}`)
    return true
  },
  addToGitHubTeam: async (login: string, org: string, team: string) => {
    state.calls.push(`add ${login} ${org}/${team}`)
    return true
  },
  removeFromGitHubTeam: async (login: string, org: string, team: string) => {
    state.calls.push(`remove ${login} ${org}/${team}`)
    return true
  },
}))

vi.mock('@/lib/invites', () => ({
  inviteConfirmedContributor: async (contributor: { githubLogin: string }) => {
    state.calls.push(`invite ${contributor.githubLogin}`)
  },
}))

const { syncAppConfig } = await import('./app-config.ts')
const { pool } = await import('./db.ts')
const { grantLabAccess, labTeamSlug, revokeDeletedLabAccess, revokeLabAccess, syncLabRepositories } = await import(
  './lab-access.ts'
)

beforeEach(async () => {
  await pool.query('TRUNCATE app_config')
  await syncAppConfig({ githubOrganization: 'constructorfabric' })
  state.calls = []
  state.ensureTeamResult = true
})

afterAll(async () => {
  await pool.end()
})

const LAB = {
  slug: 'agentic-search',
  repositories: [
    { url: 'https://github.com/constructorfabric/lab-x' },
    { url: 'https://github.com/someone-else/fork' },
  ],
}

function contributor(login: string, invited = true) {
  return { githubId: '1', githubLogin: login, githubOrgInvitedAt: invited ? new Date() : undefined } as never
}

test('labTeamSlug names the two teams after the Lab', () => {
  expect(labTeamSlug('agentic-search', 'leader')).toBe('agentic-search-leaders')
  expect(labTeamSlug('agentic-search', 'maintainer')).toBe('agentic-search-maintainers')
})

test('grantLabAccess creates a closed team, grants it on org repositories only, then adds the person', async () => {
  await grantLabAccess(contributor('ada'), LAB, 'leader', null)

  expect(state.calls).toEqual([
    'ensure constructorfabric/agentic-search-leaders closed',
    'grant constructorfabric/agentic-search-leaders constructorfabric/lab-x maintain',
    'add ada constructorfabric/agentic-search-leaders',
  ])
})

test('grantLabAccess gives Maintainers write (push)', async () => {
  await grantLabAccess(contributor('ada'), LAB, 'maintainer', null)

  expect(state.calls).toContain('grant constructorfabric/agentic-search-maintainers constructorfabric/lab-x push')
})

test('grantLabAccess invites someone never invited to the org before anything else', async () => {
  await grantLabAccess(contributor('ada', false), LAB, 'maintainer', null)

  expect(state.calls[0]).toBe('invite ada')
})

test('grantLabAccess on a role switch joins the new team and leaves the old one', async () => {
  await grantLabAccess(contributor('ada'), LAB, 'leader', 'maintainer')

  expect(state.calls.slice(-2)).toEqual([
    'add ada constructorfabric/agentic-search-leaders',
    'remove ada constructorfabric/agentic-search-maintainers',
  ])
})

test('grantLabAccess adds nobody to a team that could not be ensured', async () => {
  state.ensureTeamResult = false

  await grantLabAccess(contributor('ada'), LAB, 'leader', null)

  expect(state.calls).toEqual(['ensure constructorfabric/agentic-search-leaders closed'])
})

test('nothing touches GitHub when no organization is configured', async () => {
  await pool.query('TRUNCATE app_config')

  await grantLabAccess(contributor('ada', false), LAB, 'leader', null)
  await revokeLabAccess(contributor('ada'), LAB, 'leader')
  await syncLabRepositories({ ...LAB, roles: ['leader'] }, [])
  await revokeDeletedLabAccess(LAB, [{ contributor: contributor('ada'), role: 'leader' }])

  expect(state.calls).toEqual([])
})

test('revokeLabAccess takes the person out of their role team only', async () => {
  await revokeLabAccess(contributor('ada'), LAB, 'maintainer')

  expect(state.calls).toEqual(['remove ada constructorfabric/agentic-search-maintainers'])
})

test('syncLabRepositories grants added repositories to held roles and ungrants removed ones from both teams', async () => {
  await syncLabRepositories(
    { slug: 'agentic-search', repositories: [{ url: 'https://github.com/constructorfabric/lab-y' }], roles: ['leader'] },
    [{ url: 'https://github.com/constructorfabric/Lab-X' }, { url: 'https://github.com/someone-else/fork' }],
  )

  expect(state.calls).toEqual([
    'grant constructorfabric/agentic-search-leaders constructorfabric/lab-y maintain',
    'ungrant constructorfabric/agentic-search-leaders constructorfabric/Lab-X',
    'ungrant constructorfabric/agentic-search-maintainers constructorfabric/Lab-X',
  ])
})

test('syncLabRepositories treats a case-only change of a URL as the same repository', async () => {
  await syncLabRepositories(
    { slug: 'agentic-search', repositories: [{ url: 'https://github.com/constructorfabric/lab-x' }], roles: ['leader'] },
    [{ url: 'https://github.com/ConstructorFabric/Lab-X' }],
  )

  expect(state.calls).toEqual([])
})

test('revokeDeletedLabAccess empties both teams and drops their repository grants', async () => {
  await revokeDeletedLabAccess(LAB, [
    { contributor: contributor('ada'), role: 'leader' },
    { contributor: contributor('grace'), role: 'maintainer' },
  ])

  expect(state.calls).toEqual([
    'remove ada constructorfabric/agentic-search-leaders',
    'remove grace constructorfabric/agentic-search-maintainers',
    'ungrant constructorfabric/agentic-search-leaders constructorfabric/lab-x',
    'ungrant constructorfabric/agentic-search-maintainers constructorfabric/lab-x',
  ])
})
