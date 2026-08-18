import { afterAll, beforeEach, expect, test } from 'vitest'
import { pool } from './db.ts'
import { listTracks, syncTracks, type TrackSync } from './tracks.ts'

function trackSync(overrides: Partial<TrackSync> & { slug: string; name: string }): TrackSync {
  return { repositories: [], leaders: [], adminGithubLogins: [], ...overrides }
}

beforeEach(async () => {
  // CASCADE: track_admins FK-references tracks; contributors is truncated
  // too since every leader/admin login below resolves to a real row in it.
  await pool.query('TRUNCATE tracks, contributors CASCADE')
})

afterAll(async () => {
  await pool.end()
})

test('syncs a new track by slug', async () => {
  const { synced, rejected } = await syncTracks([
    trackSync({ slug: 'studio', name: 'Constructor Studio', description: 'Structure and process organizer.' }),
  ])

  expect(synced).toEqual(['studio'])
  expect(rejected).toEqual([])

  const [track] = await listTracks()
  expect(track.slug).toBe('studio')
  expect(track.name).toBe('Constructor Studio')
  expect(track.description).toBe('Structure and process organizer.')
})

test('re-syncing the same slug updates the existing row rather than adding a second one', async () => {
  await syncTracks([trackSync({ slug: 'studio', name: 'Constructor Studio' })])
  await syncTracks([trackSync({ slug: 'studio', name: 'Constructor Studio (renamed)' })])

  const tracks = await listTracks()
  expect(tracks).toHaveLength(1)
  expect(tracks[0].name).toBe('Constructor Studio (renamed)')
})

test('stores repositories as given', async () => {
  await syncTracks([
    trackSync({
      slug: 'studio',
      name: 'Constructor Studio',
      repositories: [
        { url: 'https://github.com/constructorfabric/studio', description: 'The thing itself', issueTracker: 'https://github.com/constructorfabric/studio/issues' },
      ],
    }),
  ])

  const [track] = await listTracks()
  expect(track.repositories).toEqual([
    { url: 'https://github.com/constructorfabric/studio', description: 'The thing itself', issueTracker: 'https://github.com/constructorfabric/studio/issues' },
  ])
})

test('assigns a leader role to a real contributor, resolved by login', async () => {
  await pool.query("INSERT INTO contributors (github_id, github_login) VALUES (1001, 'octocat')")

  await syncTracks([
    trackSync({ slug: 'studio', name: 'Constructor Studio', leaders: [{ role: 'product_manager', githubLogin: 'octocat' }] }),
  ])

  const [track] = await listTracks()
  expect(track.leaders).toEqual([{ role: 'product_manager', githubId: '1001' }])
})

test('assigns up to 3 people to the same role', async () => {
  await pool.query(
    "INSERT INTO contributors (github_id, github_login) VALUES (1001, 'octocat'), (2002, 'grace'), (3003, 'ada')",
  )

  await syncTracks([
    trackSync({
      slug: 'studio',
      name: 'Constructor Studio',
      leaders: [
        { role: 'developer', githubLogin: 'octocat' },
        { role: 'developer', githubLogin: 'grace' },
        { role: 'developer', githubLogin: 'ada' },
      ],
    }),
  ])

  const [track] = await listTracks()
  expect(track.leaders.map((l) => l.githubId).sort()).toEqual(['1001', '2002', '3003'])
})

test('rejects a track with more than 3 people for the same role, without touching any other track', async () => {
  await pool.query(
    "INSERT INTO contributors (github_id, github_login) VALUES (1001, 'a'), (2002, 'b'), (3003, 'c'), (4004, 'd')",
  )

  const { synced, rejected } = await syncTracks([
    trackSync({
      slug: 'studio',
      name: 'Constructor Studio',
      leaders: [
        { role: 'developer', githubLogin: 'a' },
        { role: 'developer', githubLogin: 'b' },
        { role: 'developer', githubLogin: 'c' },
        { role: 'developer', githubLogin: 'd' },
      ],
    }),
    trackSync({ slug: 'insight', name: 'Constructor Insight' }),
  ])

  expect(rejected).toEqual(['studio'])
  expect(synced).toEqual(['insight'])
  expect(await listTracks()).toHaveLength(1)
})

test('rejects a track whose leader login is not a real contributor, without touching any other track', async () => {
  const { synced, rejected } = await syncTracks([
    trackSync({
      slug: 'studio',
      name: 'Constructor Studio',
      leaders: [{ role: 'product_manager', githubLogin: 'nobody-by-this-login' }],
    }),
    trackSync({ slug: 'insight', name: 'Constructor Insight' }),
  ])

  expect(rejected).toEqual(['studio'])
  expect(synced).toEqual(['insight'])
  expect(await listTracks()).toHaveLength(1)
})

test('re-syncing fully replaces a track leaders set rather than adding to it', async () => {
  await pool.query("INSERT INTO contributors (github_id, github_login) VALUES (1001, 'octocat'), (2002, 'grace')")

  await syncTracks([
    trackSync({ slug: 'studio', name: 'Constructor Studio', leaders: [{ role: 'architect', githubLogin: 'octocat' }] }),
  ])
  await syncTracks([
    trackSync({ slug: 'studio', name: 'Constructor Studio', leaders: [{ role: 'architect', githubLogin: 'grace' }] }),
  ])

  const [track] = await listTracks()
  expect(track.leaders).toEqual([{ role: 'architect', githubId: '2002' }])
})

test('assigns and fully replaces a track admins set on every sync, resolved by login', async () => {
  await pool.query("INSERT INTO contributors (github_id, github_login) VALUES (1001, 'octocat'), (2002, 'grace')")

  await syncTracks([trackSync({ slug: 'studio', name: 'Constructor Studio', adminGithubLogins: ['octocat'] })])
  let { rows } = await pool.query('SELECT github_id::text FROM track_admins')
  expect(rows.map((r) => r.github_id)).toEqual(['1001'])

  await syncTracks([trackSync({ slug: 'studio', name: 'Constructor Studio', adminGithubLogins: ['grace'] })])
  ;({ rows } = await pool.query('SELECT github_id::text FROM track_admins'))
  expect(rows.map((r) => r.github_id)).toEqual(['2002'])
})

test('rejects a track whose admin login is not a real contributor', async () => {
  const { rejected } = await syncTracks([
    trackSync({ slug: 'studio', name: 'Constructor Studio', adminGithubLogins: ['nobody-by-this-login'] }),
  ])

  expect(rejected).toEqual(['studio'])
  // The track itself still synced — only the admin assignment failed.
  expect(await listTracks()).toHaveLength(1)
})
