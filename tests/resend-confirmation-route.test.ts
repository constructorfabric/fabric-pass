import { beforeEach, expect, test, vi } from 'vitest'

// Session-authenticated, unlike /confirm-email: getSession() and
// resendConfirmationEmail (which talks straight to Postgres and sends mail
// via @/lib/contributors) are both replaced with in-memory doubles, the same
// seam the auth-callback tests use.
const { fakeSession, resendCalls } = vi.hoisted(() => ({
  fakeSession: {
    github: undefined as { id: string; login: string } | undefined,
  },
  resendCalls: [] as string[],
}))

vi.mock('@/lib/session', () => ({
  getSession: async () => fakeSession,
}))

vi.mock('@/lib/contributors', async () => {
  const actual = await vi.importActual<typeof import('@/lib/contributors')>('@/lib/contributors')
  return {
    ...actual,
    resendConfirmationEmail: async (githubId: string) => {
      resendCalls.push(githubId)
    },
  }
})

const { GET } = await import('@/app/auth/resend-confirmation/route')

beforeEach(() => {
  fakeSession.github = { id: '1001', login: 'octocat' }
  resendCalls.length = 0
})

// IDEA-058 — this used to redirect with notice=expired, worded for a stale
// sign-in link ("that sign-in link has expired") rather than a contributor
// who clicked "Confirm" on their email with no session at all — real
// production case: a contributor's session lapsed before they clicked
// Confirm, and Profile's misleading banner left them believing nothing had
// gone wrong when in fact resendConfirmationEmail was never even called.
test('with nobody signed in, the request is refused as sign-in-required, landing on Profile', async () => {
  fakeSession.github = undefined

  const response = await GET()

  expect(response.headers.get('location')).toBe('http://localhost:3000/profile?notice=sign-in-required')
  expect(resendCalls).toEqual([])
})

test('a signed-in contributor gets the confirmation resent and lands on Profile with the confirmation-resent notice', async () => {
  const response = await GET()

  expect(response.headers.get('location')).toBe('http://localhost:3000/profile?notice=confirmation-resent')
  expect(resendCalls).toEqual(['1001'])
})
