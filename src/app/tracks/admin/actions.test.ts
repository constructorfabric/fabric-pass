import { beforeEach, expect, test, vi } from 'vitest'

// removeFromTrackAction re-checks the caller is actually authorized (Admin,
// or Track Admin for this specific track) server-side — the page's own gate
// keeps an unauthorized contributor from ever seeing the button, but the
// action is reachable directly. Session, contributor/track lookups, the
// authorization check, the underlying write, and the revoke side effect are
// all replaced with in-memory doubles, the same seam admin/actions.test.ts's
// own tests use.
const { fakeSession, state } = vi.hoisted(() => ({
  fakeSession: {
    github: { id: '1001', login: 'trackadmin' } as { id: string; login: string } | undefined,
  },
  state: {
    caller: { githubId: '1001', isAdmin: false } as { githubId: string; isAdmin: boolean } | null,
    isTrackAdminResult: true,
    track: { id: 'track-1', slug: 'studio', name: 'Studio' } as { id: string; slug: string; name: string } | null,
    member: { githubId: '2002' } as { githubId: string } | null,
    removeCalls: [] as [string, string, string][],
    setRoleCalls: [] as [string, string, string][],
    shouldThrowNotApproved: false,
    loggedActions: [] as unknown[],
    revokedFor: [] as string[],
    promotedFor: [] as string[],
    demotedFor: [] as string[],
    decideCalls: [] as [string, string, string, string][],
    shouldThrowNotPending: false,
    grantedFor: [] as string[],
    trackParticipation: [{ trackId: 'track-1', trackSlug: 'studio', trackName: 'Studio', role: 'contributor', isTrackAdmin: false }] as unknown[],
    shouldThrowTrackParticipation: false,
  },
}))

vi.mock('@/lib/session', () => ({
  getSession: async () => fakeSession,
}))

vi.mock('@/lib/audit-log', () => ({
  logAdminAction: async (input: unknown) => {
    state.loggedActions.push(input)
  },
}))

vi.mock('@/lib/team-access', () => ({
  grantTrackAccess: async (contributor: { githubId: string }) => {
    state.grantedFor.push(contributor.githubId)
  },
  revokeTrackAccess: async (contributor: { githubId: string }) => {
    state.revokedFor.push(contributor.githubId)
  },
  promoteToMaintainer: async (contributor: { githubId: string }) => {
    state.promotedFor.push(contributor.githubId)
  },
  demoteToContributor: async (contributor: { githubId: string }) => {
    state.demotedFor.push(contributor.githubId)
  },
}))

vi.mock('@/lib/email', () => ({
  sendTrackDecisionEmail: async () => {},
}))

vi.mock('@/lib/contributors', async () => {
  const actual = await vi.importActual<typeof import('@/lib/contributors')>('@/lib/contributors')
  return {
    ...actual,
    findByGithubId: async (githubId: string) => {
      if (state.caller && state.caller.githubId === githubId) return state.caller
      if (state.member && state.member.githubId === githubId) return { githubId: state.member.githubId, githubLogin: 'requester' }
      return null
    },
  }
})

vi.mock('@/lib/roles', () => ({
  isAdmin: (contributor: { isAdmin: boolean }) => contributor.isAdmin,
  isTrackAdmin: async () => state.isTrackAdminResult,
}))

vi.mock('@/lib/tracks', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tracks')>('@/lib/tracks')
  return {
    ...actual,
    findTrackBySlug: async (slug: string) => (state.track && state.track.slug === slug ? state.track : null),
  }
})

vi.mock('@/lib/track-members', async () => {
  const actual = await vi.importActual<typeof import('@/lib/track-members')>('@/lib/track-members')
  return {
    ...actual,
    removeTrackMember: async (trackId: string, githubId: string, decidedByGithubId: string) => {
      if (state.shouldThrowNotApproved) throw new actual.NotApprovedError(`${trackId}/${githubId}`)
      state.removeCalls.push([trackId, githubId, decidedByGithubId])
    },
    setTrackMemberRole: async (trackId: string, githubId: string, role: string) => {
      if (state.shouldThrowNotApproved) throw new actual.NotApprovedError(`${trackId}/${githubId}`)
      state.setRoleCalls.push([trackId, githubId, role])
    },
    decideJoinRequest: async (trackId: string, githubId: string, decision: string, decidedByGithubId: string) => {
      if (state.shouldThrowNotPending) throw new actual.NotPendingError(`${trackId}/${githubId}`)
      state.decideCalls.push([trackId, githubId, decision, decidedByGithubId])
    },
    listTrackParticipation: async () => {
      if (state.shouldThrowTrackParticipation) throw new Error('db unavailable')
      return state.trackParticipation
    },
  }
})

const {
  removeFromTrackAction,
  promoteToMaintainerAction,
  demoteToContributorAction,
  decideJoinRequestAction,
} = await import('./actions.ts')

beforeEach(() => {
  fakeSession.github = { id: '1001', login: 'trackadmin' }
  state.caller = { githubId: '1001', isAdmin: false }
  state.isTrackAdminResult = true
  state.track = { id: 'track-1', slug: 'studio', name: 'Studio' }
  state.member = { githubId: '2002' }
  state.removeCalls = []
  state.setRoleCalls = []
  state.shouldThrowNotApproved = false
  state.loggedActions = []
  state.revokedFor = []
  state.promotedFor = []
  state.demotedFor = []
  state.decideCalls = []
  state.shouldThrowNotPending = false
  state.grantedFor = []
  state.trackParticipation = [{ trackId: 'track-1', trackSlug: 'studio', trackName: 'Studio', role: 'contributor', isTrackAdmin: false }]
  state.shouldThrowTrackParticipation = false
})

test('a Track Admin can remove an approved member, which revokes their track access and logs the action', async () => {
  const result = await removeFromTrackAction('studio', '2002')

  expect(result).toEqual({ ok: true })
  expect(state.removeCalls).toEqual([['track-1', '2002', '1001']])
  expect(state.revokedFor).toEqual(['2002'])
  expect(state.loggedActions).toEqual([
    { actorGithubId: '1001', action: 'remove_from_track', targetGithubId: '2002', trackId: 'track-1' },
  ])
})

test('refuses when nobody is signed in, and offers a way to sign in again', async () => {
  fakeSession.github = undefined

  const result = await removeFromTrackAction('studio', '2002')

  expect(result).toEqual({ ok: false, message: 'Please sign in with GitHub first.', reauthRequired: true })
  expect(state.removeCalls).toEqual([])
  expect(state.revokedFor).toEqual([])
})

test('refuses a contributor who is neither an Admin nor this track\'s Track Admin', async () => {
  state.isTrackAdminResult = false

  const result = await removeFromTrackAction('studio', '2002')

  expect(result).toEqual({ ok: false, message: 'Not authorized.' })
  expect(state.removeCalls).toEqual([])
})

test('refuses when the track no longer exists', async () => {
  state.track = null

  const result = await removeFromTrackAction('gone', '2002')

  expect(result).toEqual({ ok: false, message: 'This track no longer exists.' })
})

// Retrying can never fix this — the member was already not approved (a
// stale page, a double click, or Reject/Remove clicked twice) — so this
// must read differently from a generic "try again" failure.
test('reports a clear message when the member is not currently approved, without logging or revoking anything', async () => {
  state.shouldThrowNotApproved = true

  const result = await removeFromTrackAction('studio', '2002')

  expect(result).toEqual({ ok: false, message: 'This contributor is not currently an approved member.' })
  expect(state.loggedActions).toEqual([])
  expect(state.revokedFor).toEqual([])
})

test('a Track Admin can promote an approved member to maintainer, which grants the maintainer team and logs the action', async () => {
  const result = await promoteToMaintainerAction('studio', '2002')

  expect(result).toEqual({ ok: true })
  expect(state.setRoleCalls).toEqual([['track-1', '2002', 'maintainer']])
  expect(state.promotedFor).toEqual(['2002'])
  expect(state.loggedActions).toEqual([
    { actorGithubId: '1001', action: 'promote_to_maintainer', targetGithubId: '2002', trackId: 'track-1' },
  ])
})

test('promoteToMaintainerAction refuses a contributor who is neither an Admin nor this track\'s Track Admin', async () => {
  state.isTrackAdminResult = false

  const result = await promoteToMaintainerAction('studio', '2002')

  expect(result).toEqual({ ok: false, message: 'Not authorized.' })
  expect(state.setRoleCalls).toEqual([])
})

test('promoteToMaintainerAction reports a clear message when the member is not currently approved', async () => {
  state.shouldThrowNotApproved = true

  const result = await promoteToMaintainerAction('studio', '2002')

  expect(result).toEqual({ ok: false, message: 'This contributor is not currently an approved member.' })
  expect(state.loggedActions).toEqual([])
  expect(state.promotedFor).toEqual([])
})

test('a Track Admin can demote a maintainer back to contributor, which revokes the maintainer team and logs the action', async () => {
  const result = await demoteToContributorAction('studio', '2002')

  expect(result).toEqual({ ok: true })
  expect(state.setRoleCalls).toEqual([['track-1', '2002', 'contributor']])
  expect(state.demotedFor).toEqual(['2002'])
  expect(state.loggedActions).toEqual([
    { actorGithubId: '1001', action: 'demote_to_contributor', targetGithubId: '2002', trackId: 'track-1' },
  ])
})

test('demoteToContributorAction refuses a contributor who is neither an Admin nor this track\'s Track Admin', async () => {
  state.isTrackAdminResult = false

  const result = await demoteToContributorAction('studio', '2002')

  expect(result).toEqual({ ok: false, message: 'Not authorized.' })
  expect(state.setRoleCalls).toEqual([])
})

// IDEA-113 — approving a request must return the requester's fresh
// track-participation list, not leave the reviewer's optimistic UI update
// stuck with pre-decision role/tracks data.

test('approving a pending request grants access and returns the requester\'s fresh track participation', async () => {
  state.trackParticipation = [
    { trackId: 'track-1', trackSlug: 'studio', trackName: 'Studio', role: 'contributor', isTrackAdmin: false },
    { trackId: 'track-2', trackSlug: 'governance', trackName: 'Governance', role: 'contributor', isTrackAdmin: false },
  ]

  const result = await decideJoinRequestAction('studio', '2002', 'approved')

  expect(result.ok).toBe(true)
  expect(result.tracks).toEqual(state.trackParticipation)
  expect(state.decideCalls).toEqual([['track-1', '2002', 'approved', '1001']])
  expect(state.grantedFor).toEqual(['2002'])
  expect(state.loggedActions).toEqual([{ actorGithubId: '1001', action: 'accept', targetGithubId: '2002', trackId: 'track-1' }])
})

test('rejecting a pending request does not return a tracks field', async () => {
  const result = await decideJoinRequestAction('studio', '2002', 'rejected')

  expect(result).toEqual({ ok: true })
  expect(state.grantedFor).toEqual([])
})

test('decideJoinRequestAction refuses a contributor who is neither an Admin nor this track\'s Track Admin', async () => {
  state.isTrackAdminResult = false

  const result = await decideJoinRequestAction('studio', '2002', 'approved')

  expect(result).toEqual({ ok: false, message: 'Not authorized.' })
  expect(state.decideCalls).toEqual([])
})

test('decideJoinRequestAction reports a clear message when the request was already decided', async () => {
  state.shouldThrowNotPending = true

  const result = await decideJoinRequestAction('studio', '2002', 'approved')

  expect(result).toEqual({ ok: false, message: 'This request was already decided.' })
  expect(state.loggedActions).toEqual([])
  expect(state.grantedFor).toEqual([])
})

// The decision itself (write, log, email, grant) has already succeeded by
// the time the fresh-tracks refresh runs — a failure there must degrade to
// the plain success shape, not throw out of an already-successful action.
test('approving still reports success, without a tracks field, when the post-approval refresh itself fails', async () => {
  state.shouldThrowTrackParticipation = true

  const result = await decideJoinRequestAction('studio', '2002', 'approved')

  expect(result).toEqual({ ok: true })
  expect(state.decideCalls).toEqual([['track-1', '2002', 'approved', '1001']])
  expect(state.grantedFor).toEqual(['2002'])
})
