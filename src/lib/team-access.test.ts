import { afterAll, beforeEach, expect, test, vi } from 'vitest'

const { state } = vi.hoisted(() => ({
  state: {
    ensureTeamCalls: [] as [string, string][],
    ensureTeamResult: true,
    teamCalls: [] as [string, string, string][],
    roleCalls: [] as [string, string, string][],
    inviteCalls: [] as string[],
  },
}))

vi.mock('@/lib/github-org', () => ({
  ensureGitHubTeam: async (org: string, teamSlug: string) => {
    state.ensureTeamCalls.push([org, teamSlug])
    return state.ensureTeamResult
  },
  addToGitHubTeam: async (login: string, org: string, team: string) => {
    state.teamCalls.push([login, org, team])
    return true
  },
}))

vi.mock('@/lib/discord-role', () => ({
  grantDiscordRole: async (userId: string, guildId: string, roleId: string) => {
    state.roleCalls.push([userId, guildId, roleId])
    return true
  },
}))

vi.mock('@/lib/invites', () => ({
  inviteConfirmedContributor: async (contributor: { githubId: string }) => {
    state.inviteCalls.push(contributor.githubId)
  },
}))

const { syncAppConfig } = await import('./app-config.ts')
const { pool } = await import('./db.ts')
const { grantTrackAccess } = await import('./team-access.ts')

beforeEach(async () => {
  await pool.query('TRUNCATE app_config, track_members, tracks, contributors CASCADE')
  state.ensureTeamCalls = []
  state.ensureTeamResult = true
  state.teamCalls = []
  state.roleCalls = []
  state.inviteCalls = []
})

afterAll(async () => {
  await pool.end()
})

async function seedTrack(overrides: { discordRoleId?: string } = {}) {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO tracks (slug, name, discord_role_id) VALUES ('studio', 'Studio', $1) RETURNING id`,
    [overrides.discordRoleId ?? null],
  )
  return { id: rows[0].id, slug: 'studio', discordRoleId: overrides.discordRoleId } as never
}

async function seedContributor(githubId: string, discordId?: string) {
  await pool.query(
    `INSERT INTO contributors (github_id, github_login, name, email, discord_id, status) VALUES ($1, $2, $2, $2 || '@example.com', $3, 'confirmed')`,
    [githubId, `login-${githubId}`, discordId ?? null],
  )
}

function contributor(githubId: string, overrides: { discordId?: string; githubOrgInvitedAt?: Date } = {}) {
  return { githubId, githubLogin: `login-${githubId}`, discordId: overrides.discordId, githubOrgInvitedAt: overrides.githubOrgInvitedAt } as never
}

test('does nothing when the track has no Discord role and config has no GitHub org/pattern', async () => {
  const track = await seedTrack()
  await seedContributor('1')

  await grantTrackAccess(contributor('1'), track)

  expect(state.teamCalls).toEqual([])
  expect(state.roleCalls).toEqual([])
})

test('computes the team slug from the pattern and the track slug, ensures it exists, adds the contributor, and stamps githubTeamAddedAt', async () => {
  const track = await seedTrack()
  await seedContributor('1')
  await pool.query(`INSERT INTO track_members (track_id, github_id, status) VALUES ($1, '1', 'approved')`, [(track as { id: string }).id])
  await syncAppConfig({ githubOrganization: 'constructorfabric', githubTrackTeamPattern: '{track}-contributors' })

  await grantTrackAccess(contributor('1', { githubOrgInvitedAt: new Date() }), track)

  expect(state.ensureTeamCalls).toEqual([['constructorfabric', 'studio-contributors']])
  expect(state.teamCalls).toEqual([['login-1', 'constructorfabric', 'studio-contributors']])
  const { rows } = await pool.query('SELECT github_team_added_at FROM track_members WHERE github_id = $1', ['1'])
  expect(rows[0].github_team_added_at).not.toBeNull()
})

test('does not touch the GitHub team when the org is configured but the team pattern is not', async () => {
  const track = await seedTrack()
  await seedContributor('1')
  await syncAppConfig({ githubOrganization: 'constructorfabric' })

  await grantTrackAccess(contributor('1', { githubOrgInvitedAt: new Date() }), track)

  expect(state.ensureTeamCalls).toEqual([])
  expect(state.teamCalls).toEqual([])
})

test('does not touch the GitHub team when the pattern is configured but the org is not', async () => {
  const track = await seedTrack()
  await seedContributor('1')
  await syncAppConfig({ githubTrackTeamPattern: '{track}-contributors' })

  await grantTrackAccess(contributor('1', { githubOrgInvitedAt: new Date() }), track)

  expect(state.ensureTeamCalls).toEqual([])
  expect(state.teamCalls).toEqual([])
})

test('invites the contributor to the org first when they have never been invited, before granting the team', async () => {
  const track = await seedTrack()
  await seedContributor('1')
  await syncAppConfig({ githubOrganization: 'constructorfabric', githubTrackTeamPattern: '{track}-contributors' })

  await grantTrackAccess(contributor('1', { githubOrgInvitedAt: undefined }), track)

  expect(state.inviteCalls).toEqual(['1'])
  expect(state.teamCalls).toEqual([['login-1', 'constructorfabric', 'studio-contributors']])
})

test('does not re-invite a contributor who has already been invited to the org', async () => {
  const track = await seedTrack()
  await seedContributor('1')
  await syncAppConfig({ githubOrganization: 'constructorfabric', githubTrackTeamPattern: '{track}-contributors' })

  await grantTrackAccess(contributor('1', { githubOrgInvitedAt: new Date() }), track)

  expect(state.inviteCalls).toEqual([])
})

test('does not attempt to add the contributor, and does not stamp githubTeamAddedAt, when the team could not be created', async () => {
  const track = await seedTrack()
  await seedContributor('1')
  await pool.query(`INSERT INTO track_members (track_id, github_id, status) VALUES ($1, '1', 'approved')`, [(track as { id: string }).id])
  await syncAppConfig({ githubOrganization: 'constructorfabric', githubTrackTeamPattern: '{track}-contributors' })
  state.ensureTeamResult = false

  await grantTrackAccess(contributor('1', { githubOrgInvitedAt: new Date() }), track)

  expect(state.teamCalls).toEqual([])
  const { rows } = await pool.query('SELECT github_team_added_at FROM track_members WHERE github_id = $1', ['1'])
  expect(rows[0].github_team_added_at).toBeNull()
})

test('grants the Discord role and stamps discordRoleAddedAt when the guild and the contributor discordId are both known', async () => {
  const track = await seedTrack({ discordRoleId: 'role-123' })
  await seedContributor('1', 'discord-user-1')
  await pool.query(`INSERT INTO track_members (track_id, github_id, status) VALUES ($1, '1', 'approved')`, [(track as { id: string }).id])
  await syncAppConfig({ discordGuildId: 'guild-456' })

  await grantTrackAccess(contributor('1', { discordId: 'discord-user-1' }), track)

  expect(state.roleCalls).toEqual([['discord-user-1', 'guild-456', 'role-123']])
  const { rows } = await pool.query('SELECT discord_role_added_at FROM track_members WHERE github_id = $1', ['1'])
  expect(rows[0].discord_role_added_at).not.toBeNull()
})

test('does not grant a Discord role when the contributor has no linked Discord account', async () => {
  const track = await seedTrack({ discordRoleId: 'role-123' })
  await seedContributor('1')
  await pool.query(`INSERT INTO track_members (track_id, github_id, status) VALUES ($1, '1', 'approved')`, [(track as { id: string }).id])
  await syncAppConfig({ discordGuildId: 'guild-456' })

  await grantTrackAccess(contributor('1', { discordId: undefined }), track)

  expect(state.roleCalls).toEqual([])
})
