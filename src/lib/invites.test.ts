import { afterAll, beforeEach, expect, test, vi } from 'vitest'

const { state } = vi.hoisted(() => ({
  state: {
    inviteCalls: [] as [string, string][],
    teamCalls: [] as [string, string, string][],
    emailCalls: [] as [string, string][],
  },
}))

// github-org.ts/email.ts's own real behavior (HTTP calls, Resend) isn't
// what's under test here — invites.ts's orchestration (which config values
// gate which channel, and that the timestamp only gets stamped when the
// channel was actually attempted) is. Real Postgres still backs app-config.ts
// and contributors.ts below, same as every other lib test in this codebase.
vi.mock('@/lib/github-org', () => ({
  inviteToGitHubOrg: async (login: string, org: string) => {
    state.inviteCalls.push([login, org])
    return true
  },
  addToGitHubTeam: async (login: string, org: string, team: string) => {
    state.teamCalls.push([login, org, team])
    return true
  },
}))

vi.mock('@/lib/email', () => ({
  sendDiscordInviteEmail: async (to: string, url: string) => {
    state.emailCalls.push([to, url])
  },
}))

const { syncAppConfig } = await import('./app-config.ts')
const { pool } = await import('./db.ts')
const { inviteConfirmedContributor } = await import('./invites.ts')

beforeEach(async () => {
  await pool.query('TRUNCATE app_config, contributors CASCADE')
  state.inviteCalls = []
  state.teamCalls = []
  state.emailCalls = []
})

afterAll(async () => {
  await pool.end()
})

async function seedContributor(overrides: { githubId: string; email?: string }) {
  await pool.query(
    `INSERT INTO contributors (github_id, github_login, name, email, status) VALUES ($1, $2, $2, $3, 'confirmed')`,
    [overrides.githubId, `login-${overrides.githubId}`, overrides.email ?? null],
  )
}

function contributor(githubId: string, email?: string) {
  return { githubId, githubLogin: `login-${githubId}`, email } as never
}

test('does nothing at all when config has never synced', async () => {
  await inviteConfirmedContributor(contributor('1', 'a@example.com'))

  expect(state.inviteCalls).toEqual([])
  expect(state.emailCalls).toEqual([])
})

test('invites to GitHub org and stamps githubOrgInvitedAt when the org is configured', async () => {
  await seedContributor({ githubId: '1', email: 'a@example.com' })
  await syncAppConfig({ githubOrganization: 'constructorfabric' })

  await inviteConfirmedContributor(contributor('1', 'a@example.com'))

  expect(state.inviteCalls).toEqual([['login-1', 'constructorfabric']])
  const { rows } = await pool.query('SELECT github_org_invited_at, discord_invited_at FROM contributors WHERE github_id = $1', ['1'])
  expect(rows[0].github_org_invited_at).not.toBeNull()
  expect(rows[0].discord_invited_at).toBeNull()
})

test('does not add to the Contributors team when only the org is configured, not the team', async () => {
  await seedContributor({ githubId: '1', email: 'a@example.com' })
  await syncAppConfig({ githubOrganization: 'constructorfabric' })

  await inviteConfirmedContributor(contributor('1', 'a@example.com'))

  expect(state.teamCalls).toEqual([])
  const { rows } = await pool.query('SELECT github_contributors_team_added_at FROM contributors WHERE github_id = $1', ['1'])
  expect(rows[0].github_contributors_team_added_at).toBeNull()
})

test('adds to the configured Contributors team and stamps githubContributorsTeamAddedAt when both org and team are configured', async () => {
  await seedContributor({ githubId: '1', email: 'a@example.com' })
  await syncAppConfig({ githubOrganization: 'constructorfabric', githubContributorsTeam: 'contributors' })

  await inviteConfirmedContributor(contributor('1', 'a@example.com'))

  expect(state.teamCalls).toEqual([['login-1', 'constructorfabric', 'contributors']])
  const { rows } = await pool.query('SELECT github_contributors_team_added_at FROM contributors WHERE github_id = $1', ['1'])
  expect(rows[0].github_contributors_team_added_at).not.toBeNull()
})

test('never adds to the Contributors team when the org itself is not configured, even if the team is', async () => {
  await seedContributor({ githubId: '1', email: 'a@example.com' })
  await syncAppConfig({ githubContributorsTeam: 'contributors' })

  await inviteConfirmedContributor(contributor('1', 'a@example.com'))

  expect(state.inviteCalls).toEqual([])
  expect(state.teamCalls).toEqual([])
})

test('sends the Discord invite email and stamps discordInvitedAt when the invite url is configured', async () => {
  await seedContributor({ githubId: '1', email: 'a@example.com' })
  await syncAppConfig({ discordInviteUrl: 'https://discord.gg/example' })

  await inviteConfirmedContributor(contributor('1', 'a@example.com'))

  expect(state.emailCalls).toEqual([['a@example.com', 'https://discord.gg/example']])
  const { rows } = await pool.query('SELECT github_org_invited_at, discord_invited_at FROM contributors WHERE github_id = $1', ['1'])
  expect(rows[0].discord_invited_at).not.toBeNull()
  expect(rows[0].github_org_invited_at).toBeNull()
})

test('does not send a Discord invite email when the contributor has no email on file', async () => {
  await seedContributor({ githubId: '1' })
  await syncAppConfig({ discordInviteUrl: 'https://discord.gg/example' })

  await inviteConfirmedContributor(contributor('1', undefined))

  expect(state.emailCalls).toEqual([])
})

test('both channels fire independently when both are configured', async () => {
  await seedContributor({ githubId: '1', email: 'a@example.com' })
  await syncAppConfig({ githubOrganization: 'constructorfabric', discordInviteUrl: 'https://discord.gg/example' })

  await inviteConfirmedContributor(contributor('1', 'a@example.com'))

  expect(state.inviteCalls).toEqual([['login-1', 'constructorfabric']])
  expect(state.emailCalls).toEqual([['a@example.com', 'https://discord.gg/example']])
})
