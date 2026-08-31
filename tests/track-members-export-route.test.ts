import { afterAll, beforeEach, expect, test } from 'vitest'
import { GET as exportRoute } from '@/app/internal/track-members/export/route'
import { decideJoinRequest, requestToJoinTrack } from '@/lib/track-members'
import { pool } from '@/lib/db'

// tests/setup.ts has loaded .env.test, so this matches its
// TRACK_MEMBERS_EXPORT_SECRET.
const EXPORT_SECRET = 'test-track-members-export-secret'

beforeEach(async () => {
  await pool.query('TRUNCATE track_members, tracks, contributors CASCADE')
})

afterAll(async () => {
  await pool.end()
})

async function seedTrack(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(`INSERT INTO tracks (slug, name) VALUES ('studio', 'Studio') RETURNING id`)
  return rows[0].id
}

test('refuses a request with no or the wrong secret', async () => {
  const noAuth = await exportRoute(new Request('http://localhost/internal/track-members/export'))
  expect(noAuth.status).toBe(401)

  const wrongAuth = await exportRoute(
    new Request('http://localhost/internal/track-members/export', { headers: { authorization: 'Bearer nope' } }),
  )
  expect(wrongAuth.status).toBe(401)
})

test('returns every approved track membership as YAML', async () => {
  const trackId = await seedTrack()
  await pool.query("INSERT INTO contributors (github_id, github_login) VALUES ('1', 'ada'), ('2', 'admin')")
  await requestToJoinTrack(trackId, '1')
  await decideJoinRequest(trackId, '1', 'approved', '2')

  const response = await exportRoute(
    new Request('http://localhost/internal/track-members/export', { headers: { authorization: `Bearer ${EXPORT_SECRET}` } }),
  )

  expect(response.status).toBe(200)
  const body = await response.text()
  expect(body).toContain('track: studio')
  expect(body).toContain('github_login: ada')
  expect(body).toContain('role: contributor')
})
