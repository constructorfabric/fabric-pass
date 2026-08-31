import { afterAll, beforeEach, expect, test, vi } from 'vitest'

const { state } = vi.hoisted(() => ({
  state: {
    ensureTeamCalls: [] as [string, string][],
    ensureTeamResult: true,
    teamCalls: [] as [string, string, string][],
    removeTeamCalls: [] as [string, string, string][],
    roleCalls: [] as [string, string, string][],
    revokeRoleCalls: [] as [string, string, string][],
    inviteCalls: [] as string[],
    teamExistsCalls: [] as [string, string][],
    teamExistsResult: true,
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
  removeFromGitHubTeam: async (login: string, org: string, team: string) => {
    state.removeTeamCalls.push([login, org, team])
    return true
  },
  teamExists: async (org: string, teamSlug: string) => {
    state.teamExistsCalls.push([org, teamSlug])
    return state.teamExistsResult
  },
}))

vi.mock('@/lib/discord-role', () => ({
  grantDiscordRole: async (userId: string, guildId: string, roleId: string) => {
    state.roleCalls.push([userId, guildId, roleId])
    return true
  },
  revokeDiscordRole: async (userId: string, guildId: string, roleId: string) => {
    state.revokeRoleCalls.push([userId, guildId, roleId])
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
const {
  grantTrackAccess,
  revokeTrackAccess,
  promoteToMaintainer,
  demoteToContributor,
  ensureTrackAdminsAreGovernanceContributors,
} = await import('./team-access.ts')

beforeEach(async () => {
  await pool.query('TRUNCATE app_config, track_members, track_admins, tracks, contributors CASCADE')
  state.ensureTeamCalls = []
  state.ensureTeamResult = true
  state.teamCalls = []
  state.removeTeamCalls = []
  state.roleCalls = []
  state.revokeRoleCalls = []
  state.inviteCalls = []
  state.teamExistsCalls = []
  state.teamExistsResult = true
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

test('revokeTrackAccess removes the contributor from the computed GitHub team when the org and pattern are both configured', async () => {
  const track = await seedTrack()
  await seedContributor('1')
  await syncAppConfig({ githubOrganization: 'constructorfabric', githubTrackTeamPattern: '{track}-contributors' })

  await revokeTrackAccess(contributor('1'), track)

  expect(state.removeTeamCalls).toEqual([['login-1', 'constructorfabric', 'studio-contributors']])
  // Unlike grantTrackAccess, there's no "ensure the team exists" step —
  // nothing to remove them from if it doesn't.
  expect(state.ensureTeamCalls).toEqual([])
})

test('revokeTrackAccess does not touch the GitHub team when the pattern is not configured', async () => {
  const track = await seedTrack()
  await seedContributor('1')
  await syncAppConfig({ githubOrganization: 'constructorfabric' })

  await revokeTrackAccess(contributor('1'), track)

  expect(state.removeTeamCalls).toEqual([])
})

test('revokeTrackAccess revokes the Discord role when the guild and the contributor discordId are both known', async () => {
  const track = await seedTrack({ discordRoleId: 'role-123' })
  await seedContributor('1', 'discord-user-1')
  await syncAppConfig({ discordGuildId: 'guild-456' })

  await revokeTrackAccess(contributor('1', { discordId: 'discord-user-1' }), track)

  expect(state.revokeRoleCalls).toEqual([['discord-user-1', 'guild-456', 'role-123']])
})

test('revokeTrackAccess does not revoke a Discord role when the contributor has no linked Discord account', async () => {
  const track = await seedTrack({ discordRoleId: 'role-123' })
  await seedContributor('1')
  await syncAppConfig({ discordGuildId: 'guild-456' })

  await revokeTrackAccess(contributor('1', { discordId: undefined }), track)

  expect(state.revokeRoleCalls).toEqual([])
})

test('revokeTrackAccess also removes the contributor from the computed maintainer GitHub team when that pattern is configured', async () => {
  const track = await seedTrack()
  await seedContributor('1')
  await syncAppConfig({
    githubOrganization: 'constructorfabric',
    githubTrackTeamPattern: '{track}-contributors',
    githubTrackMaintainerTeamPattern: '{track}-maintainers',
  })

  await revokeTrackAccess(contributor('1'), track)

  expect(state.removeTeamCalls).toEqual([
    ['login-1', 'constructorfabric', 'studio-contributors'],
    ['login-1', 'constructorfabric', 'studio-maintainers'],
  ])
})

test('revokeTrackAccess also removes the contributor from the computed internal-readers GitHub team when that pattern is configured', async () => {
  const track = await seedTrack()
  await seedContributor('1')
  await syncAppConfig({
    githubOrganization: 'constructorfabric',
    githubTrackTeamPattern: '{track}-contributors',
    githubTrackInternalReaderTeamPattern: '{track}-internal-readers',
  })

  await revokeTrackAccess(contributor('1'), track)

  expect(state.removeTeamCalls).toEqual([
    ['login-1', 'constructorfabric', 'studio-contributors'],
    ['login-1', 'constructorfabric', 'studio-internal-readers'],
  ])
})

test('revokeTrackAccess does not touch the internal-readers GitHub team when that pattern is not configured', async () => {
  const track = await seedTrack()
  await seedContributor('1')
  await syncAppConfig({ githubOrganization: 'constructorfabric', githubTrackTeamPattern: '{track}-contributors' })

  await revokeTrackAccess(contributor('1'), track)

  expect(state.removeTeamCalls).toEqual([['login-1', 'constructorfabric', 'studio-contributors']])
})

test('revokeTrackAccess does not touch the maintainer GitHub team when that pattern is not configured', async () => {
  const track = await seedTrack()
  await seedContributor('1')
  await syncAppConfig({ githubOrganization: 'constructorfabric', githubTrackTeamPattern: '{track}-contributors' })

  await revokeTrackAccess(contributor('1'), track)

  expect(state.removeTeamCalls).toEqual([['login-1', 'constructorfabric', 'studio-contributors']])
})

test('promoteToMaintainer computes the maintainer team slug, ensures it exists, and adds the contributor', async () => {
  const track = await seedTrack()
  await seedContributor('1')
  await syncAppConfig({ githubOrganization: 'constructorfabric', githubTrackMaintainerTeamPattern: '{track}-maintainers' })

  await promoteToMaintainer(contributor('1'), track)

  expect(state.ensureTeamCalls).toEqual([['constructorfabric', 'studio-maintainers']])
  expect(state.teamCalls).toEqual([['login-1', 'constructorfabric', 'studio-maintainers']])
})

test('promoteToMaintainer does nothing when the maintainer team pattern is not configured', async () => {
  const track = await seedTrack()
  await seedContributor('1')
  await syncAppConfig({ githubOrganization: 'constructorfabric' })

  await promoteToMaintainer(contributor('1'), track)

  expect(state.teamCalls).toEqual([])
})

test('promoteToMaintainer does not attempt to add the contributor when the team could not be created', async () => {
  const track = await seedTrack()
  await seedContributor('1')
  await syncAppConfig({ githubOrganization: 'constructorfabric', githubTrackMaintainerTeamPattern: '{track}-maintainers' })
  state.ensureTeamResult = false

  await promoteToMaintainer(contributor('1'), track)

  expect(state.teamCalls).toEqual([])
})

test('promoteToMaintainer never invites to the org — only an already-approved member can be promoted', async () => {
  const track = await seedTrack()
  await seedContributor('1')
  await syncAppConfig({ githubOrganization: 'constructorfabric', githubTrackMaintainerTeamPattern: '{track}-maintainers' })

  await promoteToMaintainer(contributor('1', { githubOrgInvitedAt: undefined }), track)

  expect(state.inviteCalls).toEqual([])
})

test('demoteToContributor removes the contributor from the computed maintainer GitHub team only', async () => {
  const track = await seedTrack()
  await seedContributor('1')
  await syncAppConfig({ githubOrganization: 'constructorfabric', githubTrackMaintainerTeamPattern: '{track}-maintainers' })

  await demoteToContributor(contributor('1'), track)

  expect(state.removeTeamCalls).toEqual([['login-1', 'constructorfabric', 'studio-maintainers']])
})

test('demoteToContributor does nothing when the maintainer team pattern is not configured', async () => {
  const track = await seedTrack()
  await seedContributor('1')
  await syncAppConfig({ githubOrganization: 'constructorfabric' })

  await demoteToContributor(contributor('1'), track)

  expect(state.removeTeamCalls).toEqual([])
})

// IDEA-115 — the internal-readers grant.

test('grants the internal-readers team when configured and the team already exists on GitHub, and stamps githubTeamAddedAt', async () => {
  const track = await seedTrack()
  await seedContributor('1')
  await pool.query(`INSERT INTO track_members (track_id, github_id, status) VALUES ($1, '1', 'approved')`, [(track as { id: string }).id])
  await syncAppConfig({ githubOrganization: 'constructorfabric', githubTrackInternalReaderTeamPattern: '{track}-internal-readers' })

  await grantTrackAccess(contributor('1', { githubOrgInvitedAt: new Date() }), track)

  expect(state.teamExistsCalls).toEqual([['constructorfabric', 'studio-internal-readers']])
  expect(state.teamCalls).toEqual([['login-1', 'constructorfabric', 'studio-internal-readers']])
  // Never creates the team — only ensureGitHubTeam (used by the
  // contributor/maintainer grants) does that.
  expect(state.ensureTeamCalls).toEqual([])
  // track_members has one "was a GitHub grant attempted" marker, not one
  // per team — a track with only the internal-readers pattern configured
  // still gets a real Re-add cooldown.
  const { rows } = await pool.query('SELECT github_team_added_at FROM track_members WHERE github_id = $1', ['1'])
  expect(rows[0].github_team_added_at).not.toBeNull()
})

test('never adds the contributor to the internal-readers team when it does not already exist', async () => {
  const track = await seedTrack()
  await seedContributor('1')
  await syncAppConfig({ githubOrganization: 'constructorfabric', githubTrackInternalReaderTeamPattern: '{track}-internal-readers' })
  state.teamExistsResult = false

  await grantTrackAccess(contributor('1', { githubOrgInvitedAt: new Date() }), track)

  expect(state.teamCalls).toEqual([])
  expect(state.ensureTeamCalls).toEqual([])
})

test('does not touch the internal-readers team when that pattern is not configured', async () => {
  const track = await seedTrack()
  await seedContributor('1')
  await syncAppConfig({ githubOrganization: 'constructorfabric', githubTrackTeamPattern: '{track}-contributors' })

  await grantTrackAccess(contributor('1', { githubOrgInvitedAt: new Date() }), track)

  expect(state.teamExistsCalls).toEqual([])
})

test('invites the contributor to the org only once when both the contributor and internal-reader patterns are configured', async () => {
  const track = await seedTrack()
  await seedContributor('1')
  await syncAppConfig({
    githubOrganization: 'constructorfabric',
    githubTrackTeamPattern: '{track}-contributors',
    githubTrackInternalReaderTeamPattern: '{track}-internal-readers',
  })

  await grantTrackAccess(contributor('1', { githubOrgInvitedAt: undefined }), track)

  expect(state.inviteCalls).toEqual(['1'])
})

// IDEA-116 — deriving Governance's contributor list from every track's admins.

async function seedGovernance(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(`INSERT INTO tracks (slug, name) VALUES ('governance', 'Governance') RETURNING id`)
  return rows[0].id
}

test('ensureTrackAdminsAreGovernanceContributors does nothing when Governance does not exist', async () => {
  const studio = await seedTrack()
  await seedContributor('1')
  await pool.query(`INSERT INTO track_admins (track_id, github_id) VALUES ($1, '1')`, [(studio as { id: string }).id])

  await expect(ensureTrackAdminsAreGovernanceContributors()).resolves.toBeUndefined()

  const { rows } = await pool.query('SELECT * FROM track_members')
  expect(rows).toEqual([])
})

test('ensureTrackAdminsAreGovernanceContributors approves every distinct track admin as a Governance contributor', async () => {
  const studio = await seedTrack()
  const governanceId = await seedGovernance()
  await seedContributor('1')
  await pool.query(`INSERT INTO track_admins (track_id, github_id) VALUES ($1, '1')`, [(studio as { id: string }).id])

  await ensureTrackAdminsAreGovernanceContributors()

  const { rows } = await pool.query(
    `SELECT status, role, decided_by_github_id FROM track_members WHERE track_id = $1 AND github_id = '1'`,
    [governanceId],
  )
  expect(rows).toEqual([{ status: 'approved', role: 'contributor', decided_by_github_id: null }])
})

test('ensureTrackAdminsAreGovernanceContributors normalizes a stale non-approved row back to a plain contributor approval', async () => {
  const studio = await seedTrack()
  const governanceId = await seedGovernance()
  await seedContributor('1')
  await seedContributor('9') // the admin who made the old (now-stale) decision
  await pool.query(`INSERT INTO track_admins (track_id, github_id) VALUES ($1, '1')`, [(studio as { id: string }).id])
  // A prior real request+decision: approved as maintainer, later removed —
  // this must not resurrect the old maintainer role or the old decider.
  await pool.query(
    `INSERT INTO track_members (track_id, github_id, status, role, decided_by_github_id, decided_at)
     VALUES ($1, '1', 'removed', 'maintainer', '9', now())`,
    [governanceId],
  )

  await ensureTrackAdminsAreGovernanceContributors()

  const { rows } = await pool.query(
    `SELECT status, role, decided_by_github_id FROM track_members WHERE track_id = $1 AND github_id = '1'`,
    [governanceId],
  )
  expect(rows).toEqual([{ status: 'approved', role: 'contributor', decided_by_github_id: null }])
})

test('ensureTrackAdminsAreGovernanceContributors runs the same grant every other approval triggers', async () => {
  const studio = await seedTrack()
  await seedGovernance()
  await seedContributor('1')
  await pool.query(`INSERT INTO track_admins (track_id, github_id) VALUES ($1, '1')`, [(studio as { id: string }).id])
  await syncAppConfig({ githubOrganization: 'constructorfabric', githubTrackTeamPattern: '{track}-contributors' })

  await ensureTrackAdminsAreGovernanceContributors()

  expect(state.teamCalls).toEqual([['login-1', 'constructorfabric', 'governance-contributors']])
})

test('ensureTrackAdminsAreGovernanceContributors is idempotent — a second run does not re-grant an already-approved admin', async () => {
  const studio = await seedTrack()
  await seedGovernance()
  await seedContributor('1')
  await pool.query(`INSERT INTO track_admins (track_id, github_id) VALUES ($1, '1')`, [(studio as { id: string }).id])
  await syncAppConfig({ githubOrganization: 'constructorfabric', githubTrackTeamPattern: '{track}-contributors' })

  await ensureTrackAdminsAreGovernanceContributors()
  state.teamCalls = []
  await ensureTrackAdminsAreGovernanceContributors()

  expect(state.teamCalls).toEqual([])
})

test('ensureTrackAdminsAreGovernanceContributors counts a contributor who admins two tracks only once', async () => {
  const studio = await seedTrack()
  const { rows: insightRows } = await pool.query<{ id: string }>(
    `INSERT INTO tracks (slug, name) VALUES ('insight', 'Insight') RETURNING id`,
  )
  await seedGovernance()
  await seedContributor('1')
  await pool.query(`INSERT INTO track_admins (track_id, github_id) VALUES ($1, '1'), ($2, '1')`, [
    (studio as { id: string }).id,
    insightRows[0].id,
  ])
  await syncAppConfig({ githubOrganization: 'constructorfabric', githubTrackTeamPattern: '{track}-contributors' })

  await ensureTrackAdminsAreGovernanceContributors()

  expect(state.teamCalls).toEqual([['login-1', 'constructorfabric', 'governance-contributors']])
})
