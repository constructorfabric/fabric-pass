import { afterAll, beforeEach, expect, test } from 'vitest'
import { GET as trackMembersRoute } from '@/app/api/tracks/[slug]/members/route'
import { regenerateApiKey } from '@/lib/api-keys'
import { pool } from '@/lib/db'

beforeEach(async () => {
  await pool.query('TRUNCATE contributor_api_keys, track_members, track_admins, tracks, contributors CASCADE')
})

afterAll(async () => {
  await pool.end()
})

function requestWithKey(key?: string): Request {
  return new Request('http://localhost/api/tracks/studio/members', key ? { headers: { authorization: `Bearer ${key}` } } : {})
}

async function seedTrack(slug = 'studio'): Promise<string> {
  const { rows } = await pool.query<{ id: string }>('INSERT INTO tracks (slug, name) VALUES ($1, $2) RETURNING id', [
    slug,
    slug,
  ])
  return rows[0].id
}

test('401s without a valid API key', async () => {
  const response = await trackMembersRoute(requestWithKey(), { params: Promise.resolve({ slug: 'studio' }) })
  expect(response.status).toBe(401)
})

test('404s for an unknown track slug', async () => {
  await pool.query("INSERT INTO contributors (github_id, github_login, is_admin, status) VALUES ('1001', 'admin', true, 'confirmed')")
  const { key } = await regenerateApiKey('1001')

  const response = await trackMembersRoute(requestWithKey(key), { params: Promise.resolve({ slug: 'no-such-track' }) })

  expect(response.status).toBe(404)
})

test('403s a contributor who is neither this track\'s admin nor a Fabric Admin', async () => {
  await seedTrack()
  await pool.query("INSERT INTO contributors (github_id, github_login, status) VALUES ('1001', 'octocat', 'confirmed')")
  const { key } = await regenerateApiKey('1001')

  const response = await trackMembersRoute(requestWithKey(key), { params: Promise.resolve({ slug: 'studio' }) })

  expect(response.status).toBe(403)
})

test('a Track Admin of this track can list its approved members, excluding pending requests', async () => {
  const trackId = await seedTrack()
  await pool.query(
    "INSERT INTO contributors (github_id, github_login, name, status) VALUES ('1001', 'trackadmin', 'Track Admin', 'confirmed'), ('2002', 'approved-member', 'Approved Member', 'confirmed'), ('3003', 'pending-member', 'Pending Member', 'confirmed')",
  )
  await pool.query('INSERT INTO track_admins (track_id, github_id) VALUES ($1, $2)', [trackId, '1001'])
  await pool.query("INSERT INTO track_members (track_id, github_id, status, role) VALUES ($1, '2002', 'approved', 'maintainer')", [
    trackId,
  ])
  await pool.query("INSERT INTO track_members (track_id, github_id, status) VALUES ($1, '3003', 'pending')", [trackId])
  const { key } = await regenerateApiKey('1001')

  const response = await trackMembersRoute(requestWithKey(key), { params: Promise.resolve({ slug: 'studio' }) })
  const body = await response.json()

  expect(response.status).toBe(200)
  // The Track Admin's own row is a synthesized "approved" participant too
  // (listTrackMembership's own documented behavior for a config-assigned
  // admin with no join request of their own) — this endpoint reuses that
  // same function, so it inherits the same nuance, not a bug.
  expect(body).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ githubLogin: 'approved-member', role: 'maintainer' }),
      expect.objectContaining({ githubLogin: 'trackadmin' }),
    ]),
  )
  expect(body).toHaveLength(2)
  expect(body.map((row: { githubLogin: string }) => row.githubLogin)).not.toContain('pending-member')
})

test('a Fabric Admin can list any track\'s members even without being that track\'s admin', async () => {
  const trackId = await seedTrack()
  await pool.query(
    "INSERT INTO contributors (github_id, github_login, is_admin, status) VALUES ('1001', 'fabric-admin', true, 'confirmed'), ('2002', 'approved-member', false, 'confirmed')",
  )
  await pool.query("INSERT INTO track_members (track_id, github_id, status) VALUES ($1, '2002', 'approved')", [trackId])
  const { key } = await regenerateApiKey('1001')

  const response = await trackMembersRoute(requestWithKey(key), { params: Promise.resolve({ slug: 'studio' }) })
  const body = await response.json()

  expect(response.status).toBe(200)
  expect(body).toEqual([expect.objectContaining({ githubLogin: 'approved-member' })])
})
