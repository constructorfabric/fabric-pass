import { beforeEach, expect, test, vi } from 'vitest'

// setContributorStatusAction re-checks the caller is an Admin itself — the
// page's own gate keeps a non-admin from ever seeing the button, but the
// action is reachable directly and must not trust that alone. Session,
// contributor lookup, the admin check, and the actual write are all
// replaced with in-memory doubles so this exercises just that logic.
const { fakeSession, state } = vi.hoisted(() => ({
  fakeSession: {
    github: { id: '1001', login: 'octocat' } as { id: string; login: string } | undefined,
  },
  state: {
    caller: { githubId: '1001', isAdmin: true } as { githubId: string; isAdmin: boolean } | null,
    // IDEA-071 — setContributorStatusAction now also looks up the *target*
    // to check the requested transition is actually allowed from its
    // current status (draft/blocked here are what every existing test in
    // this file exercises; 'draft' lets both Confirm and Ignore through).
    // revokeRequestedByGithubId/revokeReason back approveRevokeAction's own
    // tests below.
    target: {
      githubId: '2002',
      githubLogin: 'requester',
      isAdmin: false,
      status: 'draft',
      revokeRequestedByGithubId: undefined as string | undefined,
      revokeReason: undefined as string | undefined,
    } as { githubId: string; githubLogin: string; isAdmin: boolean; status: string; revokeRequestedByGithubId?: string; revokeReason?: string } | null,
    calls: [] as { githubId: string; status: string }[],
    shouldThrow: false,
    loggedActions: [] as unknown[],
    invited: [] as string[],
    revokeRequests: [] as { githubId: string; requestedBy: string; reason: string }[],
    revokeApprovals: [] as { githubId: string; approvedBy: string }[],
    revokeCancellations: [] as string[],
    shouldThrowNotConfirmed: false,
    shouldThrowNotRevokePending: false,
    teamRemovals: [] as { login: string; org: string; team: string }[],
    orgRemovals: [] as { login: string; org: string }[],
    orgRemovalSucceeds: true,
    appConfig: {
      githubOrganization: 'constructorfabric',
      githubContributorsTeam: 'contributors',
    } as { githubOrganization?: string; githubContributorsTeam?: string } | null,
  },
}))

vi.mock('@/lib/session', () => ({
  getSession: async () => fakeSession,
}))

// IDEA-022's logAdminAction talks to the real database (via lib/db's pool)
// and isn't the thing under test here — every other collaborator in this
// file is already a double, so this one is too, rather than letting it hit
// a real Postgres connection this test file has no other reason to need.
vi.mock('@/lib/audit-log', () => ({
  logAdminAction: async (input: unknown) => {
    state.loggedActions.push(input)
  },
}))

// IDEA-041's inviteConfirmedContributor talks to GitHub/Discord/the real
// database — a double for the same reason logAdminAction is, above.
vi.mock('@/lib/invites', () => ({
  inviteConfirmedContributor: async (contributor: { githubId: string }) => {
    state.invited.push(contributor.githubId)
  },
}))

vi.mock('@/lib/contributors', async () => {
  const actual = await vi.importActual<typeof import('@/lib/contributors')>('@/lib/contributors')
  return {
    ...actual,
    findByGithubId: async (githubId: string) => {
      if (state.caller && state.caller.githubId === githubId) {
        return { githubId: state.caller.githubId, isAdmin: state.caller.isAdmin }
      }
      // setContributorStatusAction looks up the target twice: once for its
      // own transition guard, and (only after a real Confirm) again to hand
      // to inviteConfirmedContributor — both resolve through here.
      if (state.target && state.target.githubId === githubId) return state.target
      return null
    },
    setContributorStatus: async (githubId: string, status: string) => {
      if (state.shouldThrow) throw new Error('connection refused')
      state.calls.push({ githubId, status })
    },
    requestRevoke: async (githubId: string, requestedBy: string, reason: string) => {
      if (state.shouldThrowNotConfirmed) throw new actual.NotConfirmedError(githubId)
      state.revokeRequests.push({ githubId, requestedBy, reason })
    },
    approveRevoke: async (githubId: string, approvedByGithubId: string) => {
      if (state.shouldThrowNotRevokePending) throw new actual.NotRevokePendingError(githubId)
      state.revokeApprovals.push({ githubId, approvedBy: approvedByGithubId })
    },
    cancelRevoke: async (githubId: string) => {
      if (state.shouldThrowNotRevokePending) throw new actual.NotRevokePendingError(githubId)
      state.revokeCancellations.push(githubId)
    },
  }
})

vi.mock('@/lib/roles', () => ({
  isAdmin: (contributor: { isAdmin: boolean }) => contributor.isAdmin,
}))

vi.mock('@/lib/github-org', () => ({
  removeFromGitHubTeam: async (login: string, org: string, team: string) => {
    state.teamRemovals.push({ login, org, team })
    return true
  },
  removeFromGitHubOrg: async (login: string, org: string) => {
    state.orgRemovals.push({ login, org })
    return state.orgRemovalSucceeds
  },
}))

vi.mock('@/lib/app-config', () => ({
  getAppConfig: async () => state.appConfig,
}))

const { setContributorStatusAction, requestRevokeAction, approveRevokeAction, cancelRevokeAction } = await import('./actions.ts')

beforeEach(() => {
  fakeSession.github = { id: '1001', login: 'octocat' }
  state.caller = { githubId: '1001', isAdmin: true }
  state.target = {
    githubId: '2002',
    githubLogin: 'requester',
    isAdmin: false,
    status: 'draft',
    revokeRequestedByGithubId: undefined,
    revokeReason: undefined,
  }
  state.calls = []
  state.shouldThrow = false
  state.loggedActions = []
  state.invited = []
  state.revokeRequests = []
  state.revokeApprovals = []
  state.revokeCancellations = []
  state.shouldThrowNotConfirmed = false
  state.shouldThrowNotRevokePending = false
  state.teamRemovals = []
  state.orgRemovals = []
  state.orgRemovalSucceeds = true
  state.appConfig = { githubOrganization: 'constructorfabric', githubContributorsTeam: 'contributors' }
})

test('an Admin can confirm a contributor, which also triggers the invite', async () => {
  const result = await setContributorStatusAction('2002', 'confirmed')

  expect(result).toEqual({ ok: true })
  expect(state.calls).toEqual([{ githubId: '2002', status: 'confirmed' }])
  expect(state.loggedActions).toEqual([{ actorGithubId: '1001', action: 'confirm', targetGithubId: '2002' }])
  expect(state.invited).toEqual(['2002'])
})

test('an Admin can ignore a stranger — ignoring never triggers an invite', async () => {
  const result = await setContributorStatusAction('2002', 'blocked')

  expect(result).toEqual({ ok: true })
  expect(state.calls).toEqual([{ githubId: '2002', status: 'blocked' }])
  expect(state.loggedActions).toEqual([{ actorGithubId: '1001', action: 'ignore', targetGithubId: '2002' }])
  expect(state.invited).toEqual([])
})

test('an Admin can re-confirm an already-Ignored contributor', async () => {
  state.target = { githubId: '2002', githubLogin: 'requester', isAdmin: false, status: 'blocked' }

  const result = await setContributorStatusAction('2002', 'confirmed')

  expect(result).toEqual({ ok: true })
  expect(state.calls).toEqual([{ githubId: '2002', status: 'confirmed' }])
})

// IDEA-071 — a confirmed contributor no longer has an Ignore-shaped action
// at all (Revoke replaced it); this is the server-side guard behind that,
// not just the button being hidden client-side.
test('refuses to ignore a contributor who is already confirmed', async () => {
  state.target = { githubId: '2002', githubLogin: 'requester', isAdmin: false, status: 'confirmed' }

  const result = await setContributorStatusAction('2002', 'blocked')

  expect(result).toEqual({ ok: false, message: 'This contributor is not in a state that allows that action.' })
  expect(state.calls).toEqual([])
  expect(state.loggedActions).toEqual([])
})

test('refuses to confirm a contributor mid-revoke', async () => {
  state.target = { githubId: '2002', githubLogin: 'requester', isAdmin: false, status: 'revoke_pending' }

  const result = await setContributorStatusAction('2002', 'confirmed')

  expect(result).toEqual({ ok: false, message: 'This contributor is not in a state that allows that action.' })
  expect(state.calls).toEqual([])
})

test('refuses when the target no longer exists', async () => {
  state.target = null

  const result = await setContributorStatusAction('2002', 'confirmed')

  expect(result).toEqual({ ok: false, message: 'This contributor no longer exists.' })
  expect(state.calls).toEqual([])
})

test('refuses when nobody is signed in, and offers a way to sign in again', async () => {
  fakeSession.github = undefined

  const result = await setContributorStatusAction('2002', 'confirmed')

  expect(result).toEqual({ ok: false, message: 'Please sign in with GitHub first.', reauthRequired: true })
  expect(state.calls).toEqual([])
  expect(state.loggedActions).toEqual([])
  expect(state.invited).toEqual([])
})

// The page's own gate already keeps this button from ever rendering for a
// non-admin — this is the defense-in-depth check for the action itself,
// reachable directly regardless of what the UI shows.
test('refuses a signed-in contributor who is not an Admin', async () => {
  state.caller = { githubId: '1001', isAdmin: false }

  const result = await setContributorStatusAction('2002', 'confirmed')

  expect(result).toEqual({ ok: false, message: 'Not authorized.' })
  expect(state.calls).toEqual([])
  expect(state.loggedActions).toEqual([])
  expect(state.invited).toEqual([])
})

// A session naming a githubId with no row (README's "session outlives its
// row") must not read as authorized just because it has a session.
test('refuses when the caller session names a row that no longer exists', async () => {
  state.caller = null

  const result = await setContributorStatusAction('2002', 'confirmed')

  expect(result).toEqual({ ok: false, message: 'Not authorized.' })
  expect(state.calls).toEqual([])
  expect(state.loggedActions).toEqual([])
  expect(state.invited).toEqual([])
})

test('a database outage is reported without leaking the underlying error', async () => {
  state.shouldThrow = true

  const result = await setContributorStatusAction('2002', 'confirmed')

  expect(result.ok).toBe(false)
  expect(result.message).toBe('Could not update this contributor right now. Please try again in a moment.')
  expect(state.loggedActions).toEqual([])
  expect(state.invited).toEqual([])
})

test('an Admin can request a revoke, with a reason, and no GitHub calls happen yet', async () => {
  const result = await requestRevokeAction('2002', 'Left the organization')

  expect(result).toEqual({ ok: true })
  expect(state.revokeRequests).toEqual([{ githubId: '2002', requestedBy: '1001', reason: 'Left the organization' }])
  expect(state.loggedActions).toEqual([
    { actorGithubId: '1001', action: 'revoke_requested', targetGithubId: '2002', details: { reason: 'Left the organization' } },
  ])
  expect(state.teamRemovals).toEqual([])
  expect(state.orgRemovals).toEqual([])
})

test('requestRevokeAction refuses a blank reason', async () => {
  const result = await requestRevokeAction('2002', '   ')

  expect(result).toEqual({ ok: false, message: 'Please explain why this contributor is being revoked.' })
  expect(state.revokeRequests).toEqual([])
})

test('requestRevokeAction reports a clear message when the target is not currently confirmed', async () => {
  state.shouldThrowNotConfirmed = true

  const result = await requestRevokeAction('2002', 'reason')

  expect(result).toEqual({ ok: false, message: 'This contributor is not currently confirmed.' })
  expect(state.loggedActions).toEqual([])
})

test('requestRevokeAction refuses a non-Admin', async () => {
  state.caller = { githubId: '1001', isAdmin: false }

  const result = await requestRevokeAction('2002', 'reason')

  expect(result).toEqual({ ok: false, message: 'Not authorized.' })
  expect(state.revokeRequests).toEqual([])
})

test('a different Admin can approve a pending revoke, which removes GitHub team and org access', async () => {
  state.target = {
    githubId: '2002',
    githubLogin: 'requester',
    isAdmin: false,
    status: 'revoke_pending',
    revokeRequestedByGithubId: '3003',
    revokeReason: 'Left the organization',
  }

  const result = await approveRevokeAction('2002')

  expect(result).toEqual({ ok: true })
  expect(state.revokeApprovals).toEqual([{ githubId: '2002', approvedBy: '1001' }])
  expect(state.loggedActions).toEqual([
    {
      actorGithubId: '1001',
      action: 'revoke_approved',
      targetGithubId: '2002',
      details: { reason: 'Left the organization', requestedBy: '3003', githubAccessRemoved: true },
    },
  ])
  expect(state.teamRemovals).toEqual([{ login: 'requester', org: 'constructorfabric', team: 'contributors' }])
  expect(state.orgRemovals).toEqual([{ login: 'requester', org: 'constructorfabric' }])
})

// The entire point of the two-person gate — the Admin who requested a
// revoke cannot also be the one who approves it.
test('approveRevokeAction refuses the same Admin who requested the revoke', async () => {
  state.target = {
    githubId: '2002',
    githubLogin: 'requester',
    isAdmin: false,
    status: 'revoke_pending',
    revokeRequestedByGithubId: '1001',
    revokeReason: 'reason',
  }

  const result = await approveRevokeAction('2002')

  expect(result).toEqual({ ok: false, message: 'Only another Admin can approve this revoke — not the Admin who requested it.' })
  expect(state.revokeApprovals).toEqual([])
  expect(state.teamRemovals).toEqual([])
  expect(state.orgRemovals).toEqual([])
})

test('approveRevokeAction skips the GitHub team removal when no default team is configured, but still removes from the org', async () => {
  state.target = {
    githubId: '2002',
    githubLogin: 'requester',
    isAdmin: false,
    status: 'revoke_pending',
    revokeRequestedByGithubId: '3003',
    revokeReason: 'reason',
  }
  state.appConfig = { githubOrganization: 'constructorfabric' }

  await approveRevokeAction('2002')

  expect(state.teamRemovals).toEqual([])
  expect(state.orgRemovals).toEqual([{ login: 'requester', org: 'constructorfabric' }])
})

test('approveRevokeAction reports a clear message when the revoke is no longer pending', async () => {
  state.target = { githubId: '2002', githubLogin: 'requester', isAdmin: false, status: 'confirmed' }
  state.shouldThrowNotRevokePending = true

  const result = await approveRevokeAction('2002')

  expect(result).toEqual({ ok: false, message: 'This revoke is no longer pending.' })
  expect(state.loggedActions).toEqual([])
})

test('approveRevokeAction refuses a non-Admin', async () => {
  state.caller = { githubId: '1001', isAdmin: false }
  state.target = {
    githubId: '2002',
    githubLogin: 'requester',
    isAdmin: false,
    status: 'revoke_pending',
    revokeRequestedByGithubId: '3003',
    revokeReason: 'reason',
  }

  const result = await approveRevokeAction('2002')

  expect(result).toEqual({ ok: false, message: 'Not authorized.' })
  expect(state.revokeApprovals).toEqual([])
  expect(state.teamRemovals).toEqual([])
  expect(state.orgRemovals).toEqual([])
})

test('approveRevokeAction warns when the decision persists but GitHub access could not be removed', async () => {
  state.target = {
    githubId: '2002',
    githubLogin: 'requester',
    isAdmin: false,
    status: 'revoke_pending',
    revokeRequestedByGithubId: '3003',
    revokeReason: 'Left the organization',
  }
  state.orgRemovalSucceeds = false

  const result = await approveRevokeAction('2002')

  expect(result).toEqual({
    ok: true,
    message: 'Revoked, but GitHub access could not be removed automatically — remove it manually.',
  })
  expect(state.revokeApprovals).toEqual([{ githubId: '2002', approvedBy: '1001' }])
  expect(state.loggedActions).toEqual([
    {
      actorGithubId: '1001',
      action: 'revoke_approved',
      targetGithubId: '2002',
      details: { reason: 'Left the organization', requestedBy: '3003', githubAccessRemoved: false },
    },
  ])
})

test('any Admin, including the one who requested it, can cancel a pending revoke', async () => {
  state.target = {
    githubId: '2002',
    githubLogin: 'requester',
    isAdmin: false,
    status: 'revoke_pending',
    revokeRequestedByGithubId: '1001',
    revokeReason: 'reason',
  }

  const result = await cancelRevokeAction('2002')

  expect(result).toEqual({ ok: true })
  expect(state.revokeCancellations).toEqual(['2002'])
  expect(state.loggedActions).toEqual([{ actorGithubId: '1001', action: 'revoke_cancelled', targetGithubId: '2002' }])
})

test('cancelRevokeAction reports a clear message when the revoke is no longer pending', async () => {
  state.shouldThrowNotRevokePending = true

  const result = await cancelRevokeAction('2002')

  expect(result).toEqual({ ok: false, message: 'This revoke is no longer pending.' })
  expect(state.loggedActions).toEqual([])
})

test('cancelRevokeAction refuses a non-Admin', async () => {
  state.caller = { githubId: '1001', isAdmin: false }

  const result = await cancelRevokeAction('2002')

  expect(result).toEqual({ ok: false, message: 'Not authorized.' })
  expect(state.revokeCancellations).toEqual([])
})
