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
    calls: [] as { githubId: string; status: string }[],
    shouldThrow: false,
    loggedActions: [] as unknown[],
    invited: [] as string[],
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
      // setContributorStatusAction re-fetches the just-confirmed target
      // contributor to hand to inviteConfirmedContributor — every id this
      // test suite confirms/blocks (2002) needs to resolve too, not just
      // the caller's own.
      if (githubId === '2002') return { githubId: '2002', isAdmin: false }
      return null
    },
    setContributorStatus: async (githubId: string, status: string) => {
      if (state.shouldThrow) throw new Error('connection refused')
      state.calls.push({ githubId, status })
    },
  }
})

vi.mock('@/lib/roles', () => ({
  isAdmin: (contributor: { isAdmin: boolean }) => contributor.isAdmin,
}))

const { setContributorStatusAction } = await import('./actions.ts')

beforeEach(() => {
  fakeSession.github = { id: '1001', login: 'octocat' }
  state.caller = { githubId: '1001', isAdmin: true }
  state.calls = []
  state.shouldThrow = false
  state.loggedActions = []
  state.invited = []
})

test('an Admin can confirm a contributor, which also triggers the invite', async () => {
  const result = await setContributorStatusAction('2002', 'confirmed')

  expect(result).toEqual({ ok: true })
  expect(state.calls).toEqual([{ githubId: '2002', status: 'confirmed' }])
  expect(state.loggedActions).toEqual([{ actorGithubId: '1001', action: 'confirm', targetGithubId: '2002' }])
  expect(state.invited).toEqual(['2002'])
})

test('an Admin can block a contributor — blocking never triggers an invite', async () => {
  const result = await setContributorStatusAction('2002', 'blocked')

  expect(result).toEqual({ ok: true })
  expect(state.calls).toEqual([{ githubId: '2002', status: 'blocked' }])
  expect(state.loggedActions).toEqual([{ actorGithubId: '1001', action: 'block', targetGithubId: '2002' }])
  expect(state.invited).toEqual([])
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
