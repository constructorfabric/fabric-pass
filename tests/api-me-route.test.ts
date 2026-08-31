import { afterAll, beforeEach, expect, test } from 'vitest'
import { GET as meRoute } from '@/app/api/me/route'
import { regenerateApiKey } from '@/lib/api-keys'
import { pool } from '@/lib/db'

beforeEach(async () => {
  await pool.query('TRUNCATE contributor_api_keys, track_members, tracks, contributors CASCADE')
})

afterAll(async () => {
  await pool.end()
})

function requestWithKey(key?: string): Request {
  return new Request('http://localhost/api/me', key ? { headers: { authorization: `Bearer ${key}` } } : {})
}

test('401s without a valid API key', async () => {
  const response = await meRoute(requestWithKey())
  expect(response.status).toBe(401)
})

test('401s for an unknown key', async () => {
  const response = await meRoute(requestWithKey('fp_not-a-real-key'))
  expect(response.status).toBe(401)
})

test('404s when the key owner is not a confirmed contributor', async () => {
  await pool.query("INSERT INTO contributors (github_id, github_login, status) VALUES ('1001', 'octocat', 'draft')")
  const { key } = await regenerateApiKey('1001')

  const response = await meRoute(requestWithKey(key))

  expect(response.status).toBe(404)
})

test('returns the same fields the public profile screen shows, plus track participation', async () => {
  await pool.query(
    "INSERT INTO contributors (github_id, github_login, name, email, email_confirmed_at, status) VALUES ('1001', 'octocat', 'Ada Lovelace', 'ada@example.com', now(), 'confirmed')",
  )
  const { key } = await regenerateApiKey('1001')
  const { rows: trackRows } = await pool.query<{ id: string }>(
    "INSERT INTO tracks (slug, name) VALUES ('studio', 'Studio') RETURNING id",
  )
  await pool.query("INSERT INTO track_members (track_id, github_id, status) VALUES ($1, '1001', 'approved')", [
    trackRows[0].id,
  ])

  const response = await meRoute(requestWithKey(key))
  const body = await response.json()

  expect(response.status).toBe(200)
  expect(body.githubLogin).toBe('octocat')
  expect(body.name).toBe('Ada Lovelace')
  expect(body.emailLabel).toBe('ada@example.com')
  expect(body.tracks).toEqual([
    expect.objectContaining({ trackSlug: 'studio', trackName: 'Studio', role: 'contributor' }),
  ])
})
