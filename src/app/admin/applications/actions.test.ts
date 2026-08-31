import { afterAll, beforeEach, expect, test, vi } from 'vitest'

const { fakeSession } = vi.hoisted(() => ({
  fakeSession: { github: { id: '1001', login: 'admin' } as { id: string; login: string } | undefined },
}))

vi.mock('@/lib/session', () => ({
  getSession: async () => fakeSession,
}))

const { pool } = await import('@/lib/db')
const { createApplication } = await import('@/lib/applications')
const { createApplicationAction, regenerateApplicationApiKeyAction } = await import('./actions.ts')

beforeEach(async () => {
  fakeSession.github = { id: '1001', login: 'admin' }
  await pool.query('TRUNCATE application_api_keys, applications, contributors CASCADE')
})

afterAll(async () => {
  await pool.end()
})

async function seedAdmin(): Promise<void> {
  await pool.query("INSERT INTO contributors (github_id, github_login, is_admin, status) VALUES ('1001', 'admin', true, 'confirmed')")
}

async function seedNonAdmin(): Promise<void> {
  await pool.query("INSERT INTO contributors (github_id, github_login, status) VALUES ('1001', 'not-admin', 'confirmed')")
}

test('createApplicationAction refuses when nobody is signed in', async () => {
  fakeSession.github = undefined

  const result = await createApplicationAction('Insight', 'Ada', 'ada@example.com')

  expect(result).toEqual({ ok: false, message: 'Please sign in with GitHub first.' })
})

test('createApplicationAction refuses a non-admin', async () => {
  await seedNonAdmin()

  const result = await createApplicationAction('Insight', 'Ada', 'ada@example.com')

  expect(result).toEqual({ ok: false, message: 'Not authorized.' })
})

test('createApplicationAction refuses when any of the three fields is blank', async () => {
  await seedAdmin()

  const result = await createApplicationAction('  ', 'Ada', 'ada@example.com')

  expect(result.ok).toBe(false)
  expect(result.message).toMatch(/required/)
})

test('createApplicationAction creates the application and returns it', async () => {
  await seedAdmin()

  const result = await createApplicationAction('Insight', 'Ada Lovelace', 'ada@example.com')

  expect(result.ok).toBe(true)
  expect(result.application).toEqual(
    expect.objectContaining({ name: 'Insight', contactName: 'Ada Lovelace', contactEmail: 'ada@example.com' }),
  )
})

test('regenerateApplicationApiKeyAction refuses a non-admin', async () => {
  await seedNonAdmin()
  const application = await createApplication('Insight', 'Ada', 'ada@example.com')

  const result = await regenerateApplicationApiKeyAction(application.id)

  expect(result).toEqual({ ok: false, message: 'Not authorized.' })
})

test('regenerateApplicationApiKeyAction generates a key for an admin', async () => {
  await seedAdmin()
  const application = await createApplication('Insight', 'Ada', 'ada@example.com')

  const result = await regenerateApplicationApiKeyAction(application.id)

  expect(result.ok).toBe(true)
  expect(result.key).toMatch(/^fp_app_/)
  expect(result.maskedKey).toBeDefined()
})
