import { afterAll, beforeEach, expect, test, vi } from 'vitest'

const { fakeSession, state } = vi.hoisted(() => ({
  fakeSession: { github: { id: '1001', login: 'octocat' } as { id: string; login: string } | undefined },
  state: { shouldThrow: false },
}))

vi.mock('@/lib/session', () => ({
  getSession: async () => fakeSession,
}))

vi.mock('@/lib/api-keys', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-keys')>('@/lib/api-keys')
  return {
    ...actual,
    regenerateApiKey: async (githubId: string) => {
      if (state.shouldThrow) throw new Error('db unavailable')
      return actual.regenerateApiKey(githubId)
    },
  }
})

const { pool } = await import('@/lib/db')
const { regenerateApiKeyAction } = await import('./actions.ts')

beforeEach(async () => {
  fakeSession.github = { id: '1001', login: 'octocat' }
  state.shouldThrow = false
  await pool.query('TRUNCATE contributor_api_keys, contributors CASCADE')
  await pool.query("INSERT INTO contributors (github_id, github_login) VALUES ('1001', 'octocat')")
})

afterAll(async () => {
  await pool.end()
})

test('refuses when nobody is signed in, and offers a way to sign in again', async () => {
  fakeSession.github = undefined

  const result = await regenerateApiKeyAction()

  expect(result).toEqual({ ok: false, message: 'Please sign in with GitHub first.', reauthRequired: true })
})

test('generates a key and returns the full value, once', async () => {
  const result = await regenerateApiKeyAction()

  expect(result.ok).toBe(true)
  expect(result.key).toMatch(/^fp_/)
  expect(result.maskedKey).toBeDefined()
  expect(result.maskedKey).not.toBe(result.key)
  expect(result.createdAt).toBeDefined()
})

test('regenerating returns a different key each time', async () => {
  const first = await regenerateApiKeyAction()
  const second = await regenerateApiKeyAction()

  expect(second.key).not.toBe(first.key)
})

// A DB failure while generating must never surface as an unhandled
// rejection out of the action — the client has no try/catch of its own
// to fall back on beyond this.
test('reports a clear message, without throwing, when generation fails', async () => {
  state.shouldThrow = true

  const result = await regenerateApiKeyAction()

  expect(result).toEqual({ ok: false, message: 'Could not generate a key right now. Please try again in a moment.' })
})
