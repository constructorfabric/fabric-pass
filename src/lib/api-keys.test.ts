import { afterAll, beforeEach, expect, test } from 'vitest'
import { findContributorGithubIdByApiKey, getApiKey, regenerateApiKey } from './api-keys.ts'
import { pool } from './db.ts'

beforeEach(async () => {
  await pool.query('TRUNCATE contributor_api_keys, contributors CASCADE')
})

afterAll(async () => {
  await pool.end()
})

async function seedContributor(githubId = '1001'): Promise<string> {
  await pool.query("INSERT INTO contributors (github_id, github_login) VALUES ($1, 'octocat')", [githubId])
  return githubId
}

test('getApiKey returns null before a contributor has ever generated one', async () => {
  const githubId = await seedContributor()
  expect(await getApiKey(githubId)).toBeNull()
})

test('regenerateApiKey returns the full key once, and getApiKey never returns it', async () => {
  const githubId = await seedContributor()

  const { key, apiKey } = await regenerateApiKey(githubId)

  expect(key).toMatch(/^fp_/)
  expect(apiKey.githubId).toBe(githubId)
  expect(apiKey.maskedKey).not.toBe(key)
  expect(apiKey.maskedKey).toContain(key.slice(0, 10))
  expect(apiKey.maskedKey).toContain(key.slice(-4))

  const stored = await getApiKey(githubId)
  expect(stored?.maskedKey).toBe(apiKey.maskedKey)
})

test('the masked key hides the middle of the full key', async () => {
  const githubId = await seedContributor()
  const { key, apiKey } = await regenerateApiKey(githubId)

  const middle = key.slice(10, -4)
  expect(middle.length).toBeGreaterThan(0)
  expect(apiKey.maskedKey).not.toContain(middle)
})

test('two contributors never generate the same key', async () => {
  const a = await seedContributor('1001')
  const b = await seedContributor('2002')

  const first = await regenerateApiKey(a)
  const second = await regenerateApiKey(b)

  expect(first.key).not.toBe(second.key)
})

test('regenerating replaces the previous key rather than adding a second row', async () => {
  const githubId = await seedContributor()

  const first = await regenerateApiKey(githubId)
  const second = await regenerateApiKey(githubId)

  expect(second.key).not.toBe(first.key)
  const { rows } = await pool.query('SELECT count(*)::int AS count FROM contributor_api_keys WHERE github_id = $1', [
    githubId,
  ])
  expect(rows[0].count).toBe(1)

  const stored = await getApiKey(githubId)
  expect(stored?.maskedKey).toBe(second.apiKey.maskedKey)
})

test('regenerating stamps a fresh created_at', async () => {
  const githubId = await seedContributor()

  const first = await regenerateApiKey(githubId)
  const second = await regenerateApiKey(githubId)

  expect(second.apiKey.createdAt.getTime()).toBeGreaterThanOrEqual(first.apiKey.createdAt.getTime())
})

test('findContributorGithubIdByApiKey resolves a real key to its owner', async () => {
  const githubId = await seedContributor()
  const { key } = await regenerateApiKey(githubId)

  expect(await findContributorGithubIdByApiKey(key)).toBe(githubId)
})

test('findContributorGithubIdByApiKey returns null for an unknown key', async () => {
  expect(await findContributorGithubIdByApiKey('fp_not-a-real-key')).toBeNull()
})

test('findContributorGithubIdByApiKey returns null for a key that was since regenerated', async () => {
  const githubId = await seedContributor()
  const { key: oldKey } = await regenerateApiKey(githubId)
  await regenerateApiKey(githubId)

  expect(await findContributorGithubIdByApiKey(oldKey)).toBeNull()
})
