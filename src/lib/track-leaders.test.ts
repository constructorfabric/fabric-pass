import { afterAll, beforeEach, expect, test } from 'vitest'
import { pool } from './db.ts'
import { appointTrackLeader, appointedLeadersByTrackId, demoteTrackLeader, RoleFullError, setTrackLeaderRole } from './track-leaders.ts'
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

test('appointTrackLeader writes the leadership row and the derived admin row together (IDEA-150)', async () => {
  await pool.query("INSERT INTO contributors (github_id, github_login) VALUES (1001, 'octocat')")
  await syncTracks([trackSync({ slug: 'studio', name: 'Constructor Studio' })])
  const { rows } = await pool.query<{ id: string }>("SELECT id FROM tracks WHERE slug = 'studio'")

  await appointTrackLeader(rows[0].id, '1001', 'architect')

  const leaders = await pool.query('SELECT role, github_id::text FROM track_leaders')
  expect(leaders.rows).toEqual([{ role: 'architect', github_id: '1001' }])
  const admins = await pool.query('SELECT github_id::text FROM track_admins')
  expect(admins.rows).toEqual([{ github_id: '1001' }])

  // Re-appointing the same (track, role, person) is idempotent.
  await appointTrackLeader(rows[0].id, '1001', 'architect')
  const again = await pool.query('SELECT count(*)::int AS n FROM track_leaders')
  expect(again.rows[0].n).toBe(1)
})

test('appointTrackLeader counts only other holders toward MAX_LEADERS_PER_ROLE (IDEA-150)', async () => {
  await pool.query(
    "INSERT INTO contributors (github_id, github_login) VALUES (1001, 'octocat'), (2002, 'grace'), (4004, 'newbie')",
  )
  await syncTracks([
    trackSync({
      slug: 'studio',
      name: 'Constructor Studio',
      leaders: [
        { role: 'developer', githubLogin: 'octocat' },
        { role: 'developer', githubLogin: 'grace' },
        { role: 'developer', githubLogin: 'newbie' },
      ],
    }),
  ])
  const { rows } = await pool.query<{ id: string }>("SELECT id FROM tracks WHERE slug = 'studio'")

  // The profile is full (3), but re-appointing one of its own holders must
  // not read as a fourth: their existing row doesn't count against them.
  await expect(appointTrackLeader(rows[0].id, '4004', 'developer')).resolves.toBeUndefined()
})

test('appointTrackLeader rejects a fourth leader for a profile that already has three (IDEA-150)', async () => {
  await pool.query(
    "INSERT INTO contributors (github_id, github_login) VALUES (1001, 'octocat'), (2002, 'grace'), (3003, 'ada'), (4004, 'newbie')",
  )
  await syncTracks([
    trackSync({
      slug: 'studio',
      name: 'Constructor Studio',
      leaders: [
        { role: 'quality', githubLogin: 'octocat' },
        { role: 'quality', githubLogin: 'grace' },
        { role: 'quality', githubLogin: 'ada' },
      ],
    }),
  ])
  const { rows } = await pool.query<{ id: string }>("SELECT id FROM tracks WHERE slug = 'studio'")

  await expect(appointTrackLeader(rows[0].id, '4004', 'quality')).rejects.toBeInstanceOf(RoleFullError)
})

test('setTrackLeaderRole rewrites the row; dedupes onto an already-held profile; keeps admins (IDEA-150)', async () => {
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
  const trackId = rows[0].id

  await setTrackLeaderRole(trackId, '1001', 'architect', 'developer')
  let roles = await pool.query('SELECT role FROM track_leaders ORDER BY role')
  expect(roles.rows).toEqual([{ role: 'developer' }, { role: 'governance' }])

  // Changing architect→governance when governance is already held collapses
  // to the single held row instead of duplicating the person-profile pair.
  await setTrackLeaderRole(trackId, '1001', 'developer', 'governance')
  roles = await pool.query('SELECT role FROM track_leaders')
  expect(roles.rows).toEqual([{ role: 'governance' }])

  const admins = await pool.query('SELECT github_id::text FROM track_admins')
  expect(admins.rows).toEqual([{ github_id: '1001' }])
})

test('demoteTrackLeader takes every profile, drops the admin row, and lands a Maintainer membership (IDEA-150)', async () => {
  await pool.query("INSERT INTO contributors (github_id, github_login) VALUES (1001, 'octocat'), (999, 'admin')")
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
  const trackId = rows[0].id

  await demoteTrackLeader(trackId, '1001', '999')

  const leaders = await pool.query('SELECT * FROM track_leaders')
  expect(leaders.rows).toEqual([])
  const admins = await pool.query('SELECT * FROM track_admins')
  expect(admins.rows).toEqual([])
  const membership = await pool.query('SELECT status, role, decided_by_github_id::text FROM track_members')
  expect(membership.rows).toEqual([{ status: 'approved', role: 'maintainer', decided_by_github_id: '999' }])
})

test('demoteTrackLeader lands a pending membership row on approved Maintainer too (IDEA-150)', async () => {
  await pool.query("INSERT INTO contributors (github_id, github_login) VALUES (1001, 'octocat'), (999, 'admin')")
  await syncTracks([trackSync({ slug: 'studio', name: 'Constructor Studio' })])
  const { rows } = await pool.query<{ id: string }>("SELECT id FROM tracks WHERE slug = 'studio'")
  const trackId = rows[0].id
  await appointTrackLeader(trackId, '1001', 'architect')
  await pool.query("INSERT INTO track_members (track_id, github_id, status) VALUES ($1, 1001, 'pending')", [trackId])

  await demoteTrackLeader(trackId, '1001', '999')

  const membership = await pool.query('SELECT status, role FROM track_members')
  expect(membership.rows).toEqual([{ status: 'approved', role: 'maintainer' }])
})
