import { afterAll, beforeEach, expect, test } from 'vitest'
import {
  createApplication,
  findApplicationByApiKey,
  getApplicationApiKey,
  listApplications,
  regenerateApplicationApiKey,
} from './applications.ts'
import { pool } from './db.ts'

beforeEach(async () => {
  await pool.query('TRUNCATE application_api_keys, applications')
})

afterAll(async () => {
  await pool.end()
})

test('listApplications returns an empty list before any are registered', async () => {
  expect(await listApplications()).toEqual([])
})

test('createApplication stores the name and free-text contact', async () => {
  const application = await createApplication('Insight', 'Ada Lovelace', 'ada@example.com')

  expect(application.name).toBe('Insight')
  expect(application.contactName).toBe('Ada Lovelace')
  expect(application.contactEmail).toBe('ada@example.com')

  const [listed] = await listApplications()
  expect(listed.id).toBe(application.id)
})

test('listApplications orders by name', async () => {
  await createApplication('Zebra', 'A', 'a@example.com')
  await createApplication('Apple', 'B', 'b@example.com')

  const applications = await listApplications()

  expect(applications.map((a) => a.name)).toEqual(['Apple', 'Zebra'])
})

test('getApplicationApiKey returns null before a key has ever been generated', async () => {
  const application = await createApplication('Insight', 'A', 'a@example.com')
  expect(await getApplicationApiKey(application.id)).toBeNull()
})

test('regenerateApplicationApiKey returns the full key once, masks it thereafter', async () => {
  const application = await createApplication('Insight', 'A', 'a@example.com')

  const { key, apiKey } = await regenerateApplicationApiKey(application.id)

  expect(key).toMatch(/^fp_app_/)
  expect(apiKey.applicationId).toBe(application.id)
  expect(apiKey.maskedKey).not.toBe(key)

  const stored = await getApplicationApiKey(application.id)
  expect(stored?.maskedKey).toBe(apiKey.maskedKey)
})

test('regenerating replaces the previous key rather than adding a second row', async () => {
  const application = await createApplication('Insight', 'A', 'a@example.com')

  const first = await regenerateApplicationApiKey(application.id)
  const second = await regenerateApplicationApiKey(application.id)

  expect(second.key).not.toBe(first.key)
  const { rows } = await pool.query('SELECT count(*)::int AS count FROM application_api_keys WHERE application_id = $1', [
    application.id,
  ])
  expect(rows[0].count).toBe(1)
})

test('findApplicationByApiKey resolves a real key to its application', async () => {
  const application = await createApplication('Insight', 'A', 'a@example.com')
  const { key } = await regenerateApplicationApiKey(application.id)

  expect(await findApplicationByApiKey(key)).toBe(application.id)
})

test('findApplicationByApiKey returns null for an unknown key', async () => {
  expect(await findApplicationByApiKey('fp_app_not-a-real-key')).toBeNull()
})
