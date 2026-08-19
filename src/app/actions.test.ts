import { beforeEach, expect, test, vi } from 'vitest'

// saveField() is a server action: it reads the session via getSession() and
// writes via @/lib/contributors's saveField. Neither is available in a unit
// test, so both are replaced with in-memory doubles.
const { fakeSession, persisted } = vi.hoisted(() => ({
  fakeSession: {
    github: { id: '1001', login: 'octocat' } as { id: string; login: string } | undefined,
    save: async () => {},
  },
  // Records every call the mocked DB layer receives, and can be told to throw.
  persisted: {
    calls: [] as { githubId: string; field: string; value: string | undefined }[],
    shouldThrow: false,
    shouldThrowNotFound: false,
  },
}))

vi.mock('@/lib/session', () => ({
  getSession: async () => fakeSession,
}))

vi.mock('@/lib/contributors', async () => {
  const actual = await vi.importActual<typeof import('@/lib/contributors')>('@/lib/contributors')
  return {
    ...actual,
    saveField: async (githubId: string, field: string, value: string | undefined) => {
      if (persisted.shouldThrowNotFound) throw new actual.ContributorNotFoundError(githubId)
      if (persisted.shouldThrow) throw new Error('connection refused')
      persisted.calls.push({ githubId, field, value })
    },
  }
})

const { saveField } = await import('./actions.ts')

beforeEach(() => {
  fakeSession.github = { id: '1001', login: 'octocat' }
  persisted.calls = []
  persisted.shouldThrow = false
  persisted.shouldThrowNotFound = false
})

test('refuses to save when nobody is signed in, and offers a way to sign in again', async () => {
  fakeSession.github = undefined

  const result = await saveField('name', 'Ada Lovelace')

  expect(result).toEqual({ ok: false, message: 'Please sign in with GitHub first.', reauthRequired: true })
  expect(persisted.calls).toEqual([])
})

test('a valid name is persisted for the signed-in contributor', async () => {
  const result = await saveField('name', '  Ada Lovelace  ')

  expect(result).toEqual({ ok: true })
  expect(persisted.calls).toEqual([{ githubId: '1001', field: 'name', value: 'Ada Lovelace' }])
})

test('a malformed email is refused and never reaches the database', async () => {
  const result = await saveField('email', 'not-an-email')

  expect(result.ok).toBe(false)
  expect(result.message).toMatch(/email/i)
  expect(persisted.calls).toEqual([])
})

test('clearing a field to blank persists it as cleared', async () => {
  const result = await saveField('company', '   ')

  expect(result).toEqual({ ok: true })
  expect(persisted.calls).toEqual([{ githubId: '1001', field: 'company', value: undefined }])
})

test('a database outage is reported without leaking the underlying error', async () => {
  persisted.shouldThrow = true

  const result = await saveField('name', 'Ada Lovelace')

  expect(result.ok).toBe(false)
  expect(result.message).toBe('Could not save right now. Please try again in a moment.')
  // reauthRequired is specific to a stale session naming a deleted row — a
  // generic outage must not trigger the "sign in again" link.
  expect(result.reauthRequired).toBeUndefined()
})

// This action is a `'use server'` endpoint: `field` arrives as a plain
// string over the wire, not the compile-time `DetailField` it's typed as on
// the client. An arbitrary field name must be refused here, before it ever
// reaches the query that persists it.
test('a field name outside the closed set is refused and never reaches the database', async () => {
  const result = await saveField('is_admin', 'true')

  expect(result.ok).toBe(false)
  expect(persisted.calls).toEqual([])
})

// A stale session cookie naming a contributor row that's since been deleted
// can never be fixed by retrying the same save — only signing in again can —
// so this must read differently from the generic "try again" message above.
test('a session naming a contributor row that no longer exists is told to sign in again, not to retry', async () => {
  persisted.shouldThrowNotFound = true

  const result = await saveField('name', 'Ada Lovelace')

  expect(result.ok).toBe(false)
  expect(result.message).toMatch(/sign in/i)
  // The client's only way to act on this from inside the page — see
  // README's "session outlives its row" — is this flag.
  expect(result.reauthRequired).toBe(true)
})

// The defect this guards: "zatsepin.gmail.com" mid-typing showed the same
// red error it would on blur. `phase` is threaded through from the client
// (see use-autosave-field.ts) so the two read differently.
test('an incomplete email is guidance while still typing, and never reaches the database', async () => {
  const result = await saveField('email', 'zatsepin.gmail.com', 'typing')

  expect(result.ok).toBe(false)
  expect(result.guidance).toBe(true)
  expect(persisted.calls).toEqual([])
})

test('the same incomplete email is a real error once the field has been left, defaulting to final', async () => {
  const result = await saveField('email', 'zatsepin.gmail.com')

  expect(result.ok).toBe(false)
  expect(result.guidance).toBeUndefined()
  expect(persisted.calls).toEqual([])
})
