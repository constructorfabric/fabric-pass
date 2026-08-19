import { expect, test } from 'vitest'
import type { ZodError } from 'zod'
import { configuration, toIdentity } from './github.ts'

// Regression for a real production outage (2026-08-19): GitHub's callback
// started including an `iss` query parameter, and openid-client's underlying
// oauth4webapi rejects the whole callback whenever a present `iss` doesn't
// exactly equal the configured issuer — confirmed against real callback logs
// to be `https://github.com/login/oauth`, not the bare origin every sign-in
// was rejected against before this fix.
test('the configured issuer matches what GitHub actually sends back as the iss response parameter', () => {
  expect(configuration('http://localhost:3000/auth/github/callback').serverMetadata().issuer).toBe(
    'https://github.com/login/oauth',
  )
})

test('takes the numeric id and login from a github profile', () => {
  const identity = toIdentity({ id: 583231, login: 'octocat', name: 'The Octocat' })
  expect(identity).toEqual({ providerId: '583231', username: 'octocat', name: 'The Octocat' })
})

test('takes the public email when the profile has one', () => {
  const identity = toIdentity({ id: 583231, login: 'octocat', email: 'octocat@github.com' })
  expect(identity.email).toBe('octocat@github.com')
})

test('leaves name and email out entirely when the profile has neither public', () => {
  const identity = toIdentity({ id: 583231, login: 'octocat', name: null, email: null })
  expect(identity.name).toBeUndefined()
  expect(identity.email).toBeUndefined()
})

test('stringifies an id beyond Number.MAX_SAFE_INTEGER with no further precision loss', () => {
  // A literal this large written directly in source is already rounded by
  // the JS parser before this test even runs, so it can't tell a correct
  // `String(id)` conversion from a broken one — every input would look the
  // same. Going through JSON.parse of a string instead exercises the exact
  // path production uses (`response.json()` parses wire bytes the same
  // way), so the assertion checks the real value that conversion sees, not
  // just its type.
  const profile = JSON.parse('{"id": 9007199254740993, "login": "big"}')
  expect(profile.id).toBe(9007199254740992) // JSON.parse's own double rounding, not toIdentity's
  const identity = toIdentity(profile)
  expect(identity.providerId).toBe('9007199254740992')
})

test('rejects a profile with no login', () => {
  expect(() => toIdentity({ id: 1 })).toThrow(/login/)
})

test('rejects a profile with no id', () => {
  try {
    toIdentity({ login: 'octocat' })
    expect.unreachable('a profile with no id must be rejected')
  } catch (error) {
    // A /id/ regex on the message would also match Zod's "invalid_type" code
    // (it contains the substring "id"), so it would pass even for a missing
    // login. Assert the failing path instead — the same fix already applied
    // to discord.test.ts.
    expect((error as ZodError).issues.map((issue) => issue.path)).toEqual([['id']])
  }
})
