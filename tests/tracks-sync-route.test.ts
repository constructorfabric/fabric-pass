import { afterAll, beforeEach, expect, test } from 'vitest'
import { POST as syncRoute } from '@/app/internal/tracks/sync/route'
import { listTracks } from '@/lib/tracks'
import { pool } from '@/lib/db'

// tests/setup.ts has loaded .env.test, so this matches its TRACKS_SYNC_SECRET.
const SYNC_SECRET = 'test-tracks-sync-secret'

beforeEach(async () => {
  await pool.query('TRUNCATE tracks, contributors CASCADE')
})

afterAll(async () => {
  await pool.end()
})

test('refuses a request with no or the wrong secret', async () => {
  const noAuth = await syncRoute(new Request('http://localhost/internal/tracks/sync', { method: 'POST', body: 'tracks: []' }))
  expect(noAuth.status).toBe(401)

  const wrongAuth = await syncRoute(
    new Request('http://localhost/internal/tracks/sync', {
      method: 'POST',
      body: 'tracks: []',
      headers: { authorization: 'Bearer nope' },
    }),
  )
  expect(wrongAuth.status).toBe(401)
})

test('syncs tracks from the registry file', async () => {
  const response = await syncRoute(
    new Request('http://localhost/internal/tracks/sync', {
      method: 'POST',
      headers: { authorization: `Bearer ${SYNC_SECRET}` },
      body: 'tracks:\n  - slug: studio\n    name: Constructor Studio\n',
    }),
  )

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ synced: 1, skipped: 0 })

  const tracks = await listTracks()
  expect(tracks).toHaveLength(1)
  expect(tracks[0].slug).toBe('studio')
})

test('reports invalid rows and unresolved logins as skipped, without failing the request', async () => {
  const response = await syncRoute(
    new Request('http://localhost/internal/tracks/sync', {
      method: 'POST',
      headers: { authorization: `Bearer ${SYNC_SECRET}` },
      body: 'tracks:\n  - name: no slug here\n  - slug: studio\n    name: Constructor Studio\n    leaders:\n      product_manager: [nobody-by-this-login]\n',
    }),
  )

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ synced: 0, skipped: 2 })
})
