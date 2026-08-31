import { afterAll, beforeEach, expect, test } from 'vitest'
import { POST as syncRoute } from '@/app/internal/track-page-template/sync/[slug]/route'
import { pool } from '@/lib/db'
import { getTrackPageTemplate } from '@/lib/track-page-template'

// tests/setup.ts has loaded .env.test, so this matches its TRACK_PAGE_TEMPLATE_SYNC_SECRET.
const SYNC_SECRET = 'test-track-page-template-sync-secret'

beforeEach(async () => {
  await pool.query('TRUNCATE track_page_template, tracks CASCADE')
})

afterAll(async () => {
  await pool.end()
})

async function seedTrack(slug = 'studio'): Promise<string> {
  const { rows } = await pool.query<{ id: string }>('INSERT INTO tracks (slug, name) VALUES ($1, $2) RETURNING id', [
    slug,
    slug,
  ])
  return rows[0].id
}

test('refuses a request with no or the wrong secret', async () => {
  const context = { params: Promise.resolve({ slug: 'studio' }) }

  const noAuth = await syncRoute(
    new Request('http://localhost/internal/track-page-template/sync/studio', { method: 'POST', body: '# {{name}}' }),
    context,
  )
  expect(noAuth.status).toBe(401)

  const wrongAuth = await syncRoute(
    new Request('http://localhost/internal/track-page-template/sync/studio', {
      method: 'POST',
      body: '# {{name}}',
      headers: { authorization: 'Bearer nope' },
    }),
    context,
  )
  expect(wrongAuth.status).toBe(401)
})

test('404s for a slug with no matching track', async () => {
  const response = await syncRoute(
    new Request('http://localhost/internal/track-page-template/sync/no-such-track', {
      method: 'POST',
      headers: { authorization: `Bearer ${SYNC_SECRET}` },
      body: '## {{name}}',
    }),
    { params: Promise.resolve({ slug: 'no-such-track' }) },
  )

  expect(response.status).toBe(404)
})

test('stores the request body as that track\'s template, verbatim', async () => {
  const trackId = await seedTrack('studio')

  const response = await syncRoute(
    new Request('http://localhost/internal/track-page-template/sync/studio', {
      method: 'POST',
      headers: { authorization: `Bearer ${SYNC_SECRET}` },
      body: '## {{name}}\n\n{{description}}\n',
    }),
    { params: Promise.resolve({ slug: 'studio' }) },
  )

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ synced: true })
  expect(await getTrackPageTemplate(trackId)).toBe('## {{name}}\n\n{{description}}\n')
})

test('syncing one track never touches another track\'s template', async () => {
  const studioId = await seedTrack('studio')
  const insightId = await seedTrack('insight')

  await syncRoute(
    new Request('http://localhost/internal/track-page-template/sync/studio', {
      method: 'POST',
      headers: { authorization: `Bearer ${SYNC_SECRET}` },
      body: 'studio content',
    }),
    { params: Promise.resolve({ slug: 'studio' }) },
  )

  expect(await getTrackPageTemplate(studioId)).toBe('studio content')
  expect(await getTrackPageTemplate(insightId)).toBeNull()
})
