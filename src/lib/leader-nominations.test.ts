import { afterAll, beforeEach, expect, test } from 'vitest'
import { pool } from './db.ts'
import {
  CandidateNotMemberError,
  clearNominations,
  nominateTrackLeader,
  nominatedCandidatesByTrackId,
  searchNominatableMembers,
} from './leader-nominations.ts'
import { syncTracks, type TrackSync } from './tracks.ts'

function trackSync(overrides: Partial<TrackSync> & { slug: string; name: string }): TrackSync {
  return { repositories: [], leaders: [], ...overrides }
}

async function trackId(slug: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>('SELECT id FROM tracks WHERE slug = $1', [slug])
  return rows[0].id
}

beforeEach(async () => {
  // CASCADE: track_leader_nominations FK-references tracks; contributors is
  // truncated too since every candidate/nominator below resolves to a real
  // row in it. Same starting state as tracks.test.ts.
  await pool.query('TRUNCATE tracks, contributors, app_config CASCADE')
})

afterAll(async () => {
  await pool.end()
})

test('records a nomination, and the same nominator repeating it is a no-op, not a second vote', async () => {
  await pool.query("INSERT INTO contributors (github_id, github_login, status) VALUES (1, 'boss', 'confirmed'), (1001, 'octocat', 'confirmed')")
  await syncTracks([trackSync({ slug: 'studio', name: 'Constructor Studio' })])
  await pool.query("INSERT INTO track_members (track_id, github_id, status) SELECT id, 1001, 'approved' FROM tracks WHERE slug = 'studio'")
  const id = await trackId('studio')

  expect(await nominateTrackLeader(id, '1001', '1')).toBe(true)
  expect(await nominateTrackLeader(id, '1001', '1')).toBe(false)

  const { rows } = await pool.query('SELECT candidate_github_id::text, nominator_github_id::text FROM track_leader_nominations')
  expect(rows).toEqual([{ candidate_github_id: '1001', nominator_github_id: '1' }])
})

test('nominations from several people accumulate instead of overwriting each other', async () => {
  await pool.query(
    "INSERT INTO contributors (github_id, github_login, status) VALUES (1, 'boss', 'confirmed'), (2, 'peer', 'confirmed'), (1001, 'octocat', 'confirmed')",
  )
  await syncTracks([trackSync({ slug: 'studio', name: 'Constructor Studio' })])
  await pool.query("INSERT INTO track_members (track_id, github_id, status) SELECT id, 1001, 'approved' FROM tracks WHERE slug = 'studio'")
  const id = await trackId('studio')

  await nominateTrackLeader(id, '1001', '1')
  await nominateTrackLeader(id, '1001', '2')

  const { rows } = await pool.query(
    'SELECT nominator_github_id::text FROM track_leader_nominations ORDER BY nominator_github_id',
  )
  expect(rows).toEqual([{ nominator_github_id: '1' }, { nominator_github_id: '2' }])
})

test('a candidate who is not an approved member of the track is rejected', async () => {
  await pool.query(
    "INSERT INTO contributors (github_id, github_login, status) VALUES (1, 'boss', 'confirmed'), (1001, 'stranger', 'confirmed'), (2002, 'pending', 'draft'), (3003, 'rejected', 'confirmed')",
  )
  await syncTracks([trackSync({ slug: 'studio', name: 'Constructor Studio' })])
  const id = await trackId('studio')
  await pool.query(
    "INSERT INTO track_members (track_id, github_id, status) VALUES ($1, 2002, 'pending'), ($1, 3003, 'rejected')",
    [id],
  )

  await expect(nominateTrackLeader(id, '1001', '1')).rejects.toBeInstanceOf(CandidateNotMemberError)
  await expect(nominateTrackLeader(id, '2002', '1')).rejects.toBeInstanceOf(CandidateNotMemberError)
  await expect(nominateTrackLeader(id, '3003', '1')).rejects.toBeInstanceOf(CandidateNotMemberError)
})

test("the picker's search finds approved members — by name or login — and only them", async () => {
  await pool.query(
    `INSERT INTO contributors (github_id, github_login, name, status) VALUES
       (1, 'boss', 'The Boss', 'confirmed'),
       (1001, 'octocat', 'Octo Cat', 'confirmed'),
       (2002, 'grace', 'Grace Hopper', 'confirmed'),
       (3003, 'unconfirmed', 'Draft Person', 'draft')`,
  )
  await syncTracks([trackSync({ slug: 'studio', name: 'Constructor Studio' })])
  const id = await trackId('studio')
  await pool.query(
    `INSERT INTO track_members (track_id, github_id, status, role) VALUES
       ($1, 1001, 'approved', 'contributor'),
       ($1, 2002, 'approved', 'maintainer'),
       ($1, 3003, 'approved', 'contributor')`,
    [id],
  )
  await syncTracks([trackSync({ slug: 'insight', name: 'Constructor Insight' })])
  await pool.query("INSERT INTO track_members (track_id, github_id, status) SELECT id, 1, 'approved' FROM tracks WHERE slug = 'insight'")

  // 'oct' matches the member's name and login; the boss is a member of the
  // *other* track, the draft person isn't a confirmed contributor.
  const byName = await searchNominatableMembers(id, 'oct', { githubId: '1', isAdmin: false })
  expect(byName).toEqual([{ githubId: '1001', githubLogin: 'octocat', name: 'Octo Cat' }])

  const byLogin = await searchNominatableMembers(id, 'grace', { githubId: '1', isAdmin: false })
  expect(byLogin).toEqual([{ githubId: '2002', githubLogin: 'grace', name: 'Grace Hopper' }])

  const boss = await searchNominatableMembers(id, 'boss', { githubId: '1', isAdmin: false })
  expect(boss).toEqual([])

  expect(await searchNominatableMembers(id, 'oc', { githubId: '1', isAdmin: false })).toEqual([])
})

test('a locked Telegram handle is not matchable by another contributor, but is by its owner or an Admin', async () => {
  await pool.query(
    `INSERT INTO contributors (github_id, github_login, name, telegram_username, telegram_admins_only, status) VALUES
       (1, 'boss', 'The Boss', NULL, false, 'confirmed'),
       (1001, 'octocat', 'Octo Cat', 'secret-handle', true, 'confirmed')`,
  )
  await syncTracks([trackSync({ slug: 'studio', name: 'Constructor Studio' })])
  const id = await trackId('studio')
  await pool.query("INSERT INTO track_members (track_id, github_id, status) VALUES ($1, 1001, 'approved')", [id])

  await expect(searchNominatableMembers(id, 'secret-handle', { githubId: '1', isAdmin: false })).resolves.toEqual([])
  await expect(searchNominatableMembers(id, 'secret-handle', { githubId: '1001', isAdmin: false })).resolves.toHaveLength(1)
  await expect(searchNominatableMembers(id, 'secret-handle', { githubId: '1', isAdmin: true })).resolves.toHaveLength(1)
})

test("nominatedCandidatesByTrackId groups per track with vote counts, most votes first (IDEA-150's list)", async () => {
  await pool.query(
    `INSERT INTO contributors (github_id, github_login, name, status) VALUES
       (1, 'boss', 'The Boss', 'confirmed'),
       (2, 'peer', 'Peer Person', 'confirmed'),
       (3, 'third', 'Third Person', 'confirmed'),
       (1001, 'octocat', 'Octo Cat', 'confirmed'),
       (2002, 'grace', 'Grace Hopper', 'confirmed')`,
  )
  await syncTracks([trackSync({ slug: 'studio', name: 'Constructor Studio' })])
  const id = await trackId('studio')
  await pool.query(
    `INSERT INTO track_members (track_id, github_id, status) VALUES ($1, 1001, 'approved'), ($1, 2002, 'approved')`,
    [id],
  )

  await nominateTrackLeader(id, '1001', '1')
  await nominateTrackLeader(id, '1001', '2')
  await nominateTrackLeader(id, '2002', '3')

  const byTrack = await nominatedCandidatesByTrackId([id])
  expect(byTrack.get(id)!.map((candidate) => [candidate.githubLogin, candidate.votes])).toEqual([
    ['octocat', 2],
    ['grace', 1],
  ])
})

test('clearNominations removes every nominator’s row for the candidate, both on decline and on approve', async () => {
  await pool.query(
    `INSERT INTO contributors (github_id, github_login, status) VALUES
       (1, 'boss', 'confirmed'), (2, 'peer', 'confirmed'), (1001, 'octocat', 'confirmed')`,
  )
  await syncTracks([trackSync({ slug: 'studio', name: 'Constructor Studio' })])
  const id = await trackId('studio')
  await pool.query("INSERT INTO track_members (track_id, github_id, status) VALUES ($1, 1001, 'approved')", [id])

  await nominateTrackLeader(id, '1001', '1')
  await nominateTrackLeader(id, '1001', '2')

  await clearNominations(id, '1001')

  const { rows } = await pool.query('SELECT * FROM track_leader_nominations')
  expect(rows).toEqual([])
  expect((await nominatedCandidatesByTrackId([id])).get(id)).toEqual([])
})
