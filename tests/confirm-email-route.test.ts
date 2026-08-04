import { beforeEach, expect, test, vi } from 'vitest'

// confirmEmail talks straight to Postgres via @/lib/contributors; replaced
// with an in-memory double, the same seam the auth-callback tests use.
const { confirmEmailState } = vi.hoisted(() => ({
  confirmEmailState: {
    result: 'confirmed' as 'confirmed' | 'expired' | 'invalid',
  },
}))

vi.mock('@/lib/contributors', async () => {
  const actual = await vi.importActual<typeof import('@/lib/contributors')>('@/lib/contributors')
  return {
    ...actual,
    confirmEmail: async () => confirmEmailState.result,
  }
})

const { GET } = await import('@/app/confirm-email/route')

beforeEach(() => {
  confirmEmailState.result = 'confirmed'
})

test('a request with no token is refused as an invalid confirmation link, landing on Profile', async () => {
  const request = new Request('http://localhost:3000/confirm-email')

  const response = await GET(request)

  expect(response.headers.get('location')).toBe('http://localhost:3000/profile?notice=invalid-confirmation-link')
})

test('an unrecognized token is refused as an invalid confirmation link, landing on Profile', async () => {
  confirmEmailState.result = 'invalid'
  const request = new Request('http://localhost:3000/confirm-email?token=nonexistent')

  const response = await GET(request)

  expect(response.headers.get('location')).toBe('http://localhost:3000/profile?notice=invalid-confirmation-link')
})

test('a valid token confirms the email and lands on Profile', async () => {
  confirmEmailState.result = 'confirmed'
  const request = new Request('http://localhost:3000/confirm-email?token=valid-token')

  const response = await GET(request)

  expect(response.headers.get('location')).toBe('http://localhost:3000/profile?notice=email-confirmed')
})

test('an expired token lands on Profile with the confirmation-expired notice', async () => {
  confirmEmailState.result = 'expired'
  const request = new Request('http://localhost:3000/confirm-email?token=stale-token')

  const response = await GET(request)

  expect(response.headers.get('location')).toBe('http://localhost:3000/profile?notice=confirmation-expired')
})
