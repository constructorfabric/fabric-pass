import { afterAll, beforeEach, expect, test } from 'vitest'
import { GET as membersRoute } from '@/app/api/members/route'
import { regenerateApiKey } from '@/lib/api-keys'
import { pool } from '@/lib/db'

beforeEach(async () => {
  await pool.query('TRUNCATE contributor_api_keys, track_members, tracks, contributors CASCADE')
})

afterAll(async () => {
  await pool.end()
})

function requestWithKey(key?: string): Request {
  return new Request('http://localhost/api/members', key ? { headers: { authorization: `Bearer ${key}` } } : {})
}

test('401s without a valid API key', async () => {
  const response = await membersRoute(requestWithKey())
  expect(response.status).toBe(401)
})

test('403s a contributor who is not a Fabric Admin', async () => {
  await pool.query("INSERT INTO contributors (github_id, github_login, status) VALUES ('1001', 'octocat', 'confirmed')")
  const { key } = await regenerateApiKey('1001')

  const response = await membersRoute(requestWithKey(key))

  expect(response.status).toBe(403)
})

test('a Fabric Admin gets every contributor, across every status', async () => {
  await pool.query(
    "INSERT INTO contributors (github_id, github_login, is_admin, status) VALUES ('1001', 'fabric-admin', true, 'confirmed'), ('2002', 'draft-signup', false, 'draft')",
  )
  const { key } = await regenerateApiKey('1001')

  const response = await membersRoute(requestWithKey(key))
  const body = await response.json()

  expect(response.status).toBe(200)
  expect(body.map((row: { githubLogin: string }) => row.githubLogin).sort()).toEqual(['draft-signup', 'fabric-admin'])
})
