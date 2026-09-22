import { afterAll, beforeEach, expect, test } from 'vitest'
import { pool } from './db.ts'
import { appointedLeadersByTrackId } from './track-leaders.ts'
import { syncTracks, type TrackSync } from './tracks.ts'

function trackSync(overrides: Partial<TrackSync> & { slug: string; name: string }): TrackSync {
  return { repositories: [], leaders: [], ...overrides }
}

beforeEach(async () => {
  // CASCADE: track_leaders and track_admins FK-reference tracks; contributors
  // is truncated too since every leader login below resolves to a real row in
  // it. Same starting state as tracks.test.ts.
  await pool.query('TRUNCATE tracks, contributors, app_config CASCADE')
})

afterAll(async () => {
  await pool.end()
})

test('returns each track’s leaders enriched with contributor details, grouped by track id', async () => {
  await pool.query("INSERT INTO contributors (github_id, github_login, name) VALUES (1001, 'octocat', 'Octo Cat')")

  await syncTracks([
    trackSync({ slug: 'studio', name: 'Constructor Studio', leaders: [{ role: 'architect', githubLogin: 'octocat' }] }),
    trackSync({ slug: 'insight', name: 'Constructor Insight' }),
  ])

  const { rows } = await pool.query<{ id: string; slug: string }>('SELECT id, slug FROM tracks')
  const studio = rows.find((row) => row.slug === 'studio')!
  const insight = rows.find((row) => row.slug === 'insight')!

  const byTrack = await appointedLeadersByTrackId([studio.id, insight.id])

  expect(byTrack.get(studio.id)).toEqual([
    {
      githubId: '1001',
      githubLogin: 'octocat',
      name: 'Octo Cat',
      role: 'architect',
      contributorStatus: 'draft',
      profileHash: expect.stringMatching(/^[0-9a-f]{32}$/),
    },
  ])
  // IDEA-149's warning case — a track with no leaders at all.
  expect(byTrack.get(insight.id)).toEqual([])
})

test('orders a track’s leaders by the canonical role order, not alphabetically', async () => {
  await pool.query("INSERT INTO contributors (github_id, github_login) VALUES (1001, 'octocat'), (2002, 'grace')")

  await syncTracks([
    trackSync({
      slug: 'studio',
      name: 'Constructor Studio',
      leaders: [
        { role: 'researcher', githubLogin: 'octocat' },
        { role: 'product_manager', githubLogin: 'grace' },
      ],
    }),
  ])

  const { rows } = await pool.query<{ id: string }>("SELECT id FROM tracks WHERE slug = 'studio'")
  const byTrack = await appointedLeadersByTrackId([rows[0].id])

  // product_manager comes first in TRACK_LEADER_ROLES even though
  // 'architect'-style alphabetical ordering would disagree for other pairs.
  expect(byTrack.get(rows[0].id)!.map((leader) => leader.role)).toEqual(['product_manager', 'researcher'])
})

test('keeps two roles held by the same person as two entries', async () => {
  await pool.query("INSERT INTO contributors (github_id, github_login) VALUES (1001, 'octocat')")

  await syncTracks([
    trackSync({
      slug: 'studio',
      name: 'Constructor Studio',
      leaders: [
        { role: 'architect', githubLogin: 'octocat' },
        { role: 'governance', githubLogin: 'octocat' },
      ],
    }),
  ])

  const { rows } = await pool.query<{ id: string }>("SELECT id FROM tracks WHERE slug = 'studio'")
  const byTrack = await appointedLeadersByTrackId([rows[0].id])

  expect(byTrack.get(rows[0].id)!.map((leader) => leader.role)).toEqual(['architect', 'governance'])
})

test('an unknown track id maps to an empty list', async () => {
  await pool.query("INSERT INTO contributors (github_id, github_login) VALUES (1001, 'octocat')")
  await syncTracks([trackSync({ slug: 'studio', name: 'Constructor Studio' })])

  const byTrack = await appointedLeadersByTrackId(['00000000-0000-0000-0000-000000000000'])

  expect(byTrack.get('00000000-0000-0000-0000-000000000000')).toEqual([])
})

test('empty input yields an empty map without querying', async () => {
  const byTrack = await appointedLeadersByTrackId([])

  expect(byTrack.size).toBe(0)
})
