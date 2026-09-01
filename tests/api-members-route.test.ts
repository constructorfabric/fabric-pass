import { afterAll, beforeEach, expect, test } from 'vitest'
import { GET as membersRoute } from '@/app/api/members/route'
import { regenerateApiKey } from '@/lib/api-keys'
import { createApplication, regenerateApplicationApiKey } from '@/lib/applications'
import { pool } from '@/lib/db'
import { setCapacity } from '@/lib/track-capacity'

beforeEach(async () => {
  await pool.query(
    'TRUNCATE contributor_api_keys, track_members, tracks, contributors, application_api_keys, applications CASCADE',
  )
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

// IDEA-121 — an application key authorizes this same endpoint, with no
// separate role check (an application isn't a person with a role).
test('a valid application key also gets every contributor, across every status', async () => {
  await pool.query("INSERT INTO contributors (github_id, github_login, status) VALUES ('2002', 'draft-signup', 'draft')")
  const application = await createApplication('Insight', 'A', 'a@example.com')
  const { key } = await regenerateApplicationApiKey(application.id)

  const response = await membersRoute(requestWithKey(key))
  const body = await response.json()

  expect(response.status).toBe(200)
  expect(body.map((row: { githubLogin: string }) => row.githubLogin)).toEqual(['draft-signup'])
})

// IDEA-128
test('each track entry includes its capacity ratio', async () => {
  const {
    rows: [{ id: trackId }],
  } = await pool.query<{ id: string }>(`INSERT INTO tracks (slug, name) VALUES ('studio', 'Studio') RETURNING id`)
  await pool.query(
    "INSERT INTO contributors (github_id, github_login, is_admin, status) VALUES ('1001', 'fabric-admin', true, 'confirmed'), ('2002', 'member', false, 'confirmed')",
  )
  await pool.query(
    `INSERT INTO track_members (track_id, github_id, status, requested_at, decided_at, decided_by_github_id)
     VALUES ($1, '2002', 'approved', now(), now(), '1001')`,
    [trackId],
  )
  await setCapacity(trackId, '2002', 0.25)
  const { key } = await regenerateApiKey('1001')

  const response = await membersRoute(requestWithKey(key))
  const body = await response.json()

  const member = body.find((row: { githubLogin: string }) => row.githubLogin === 'member')
  expect(member.tracks).toEqual([expect.objectContaining({ trackSlug: 'studio', capacity: 0.25 })])
})

// IDEA-128
test('a track with no capacity row of its own defaults to 1', async () => {
  const {
    rows: [{ id: trackId }],
  } = await pool.query<{ id: string }>(`INSERT INTO tracks (slug, name) VALUES ('studio', 'Studio') RETURNING id`)
  await pool.query(
    "INSERT INTO contributors (github_id, github_login, is_admin, status) VALUES ('1001', 'fabric-admin', true, 'confirmed'), ('2002', 'member', false, 'confirmed')",
  )
  await pool.query(
    `INSERT INTO track_members (track_id, github_id, status, requested_at, decided_at, decided_by_github_id)
     VALUES ($1, '2002', 'approved', now(), now(), '1001')`,
    [trackId],
  )
  const { key } = await regenerateApiKey('1001')

  const response = await membersRoute(requestWithKey(key))
  const body = await response.json()

  const member = body.find((row: { githubLogin: string }) => row.githubLogin === 'member')
  expect(member.tracks[0].capacity).toBe(1)
})
