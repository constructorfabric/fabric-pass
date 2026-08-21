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
    shouldThrowNotApproved: false,
    loggedActions: [] as unknown[],
    revokedFor: [] as string[],
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
  grantTrackAccess: async () => {},
  revokeTrackAccess: async (contributor: { githubId: string }) => {
    state.revokedFor.push(contributor.githubId)
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
  }
})

const { removeFromTrackAction } = await import('./actions.ts')

beforeEach(() => {
  fakeSession.github = { id: '1001', login: 'trackadmin' }
  state.caller = { githubId: '1001', isAdmin: false }
  state.isTrackAdminResult = true
  state.track = { id: 'track-1', slug: 'studio', name: 'Studio' }
  state.member = { githubId: '2002' }
  state.removeCalls = []
  state.shouldThrowNotApproved = false
  state.loggedActions = []
  state.revokedFor = []
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
