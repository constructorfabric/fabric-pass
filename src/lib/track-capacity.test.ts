import { afterAll, beforeEach, expect, test } from 'vitest'
import { pool } from './db.ts'
import { InvalidCapacityError, getCurrentCapacity, getFabricWideCapacity, listCurrentCapacities, setCapacity } from './track-capacity.ts'

beforeEach(async () => {
  await pool.query('TRUNCATE track_member_capacity, track_members, tracks, contributors CASCADE')
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

async function seedContributor(githubId = '1001'): Promise<string> {
  await pool.query("INSERT INTO contributors (github_id, github_login) VALUES ($1, 'octocat')", [githubId])
  return githubId
}

test('getCurrentCapacity defaults to 1 (100%) when never set', async () => {
  const trackId = await seedTrack()
  const githubId = await seedContributor()

  expect(await getCurrentCapacity(trackId, githubId)).toBe(1)
})

test('setCapacity stores the ratio, readable back by getCurrentCapacity', async () => {
  const trackId = await seedTrack()
  const githubId = await seedContributor()

  await setCapacity(trackId, githubId, 0.5)

  expect(await getCurrentCapacity(trackId, githubId)).toBe(0.5)
})

test('0 and 1 are both valid, inclusive edges', async () => {
  const trackId = await seedTrack()
  const githubId = await seedContributor()

  await setCapacity(trackId, githubId, 0)
  expect(await getCurrentCapacity(trackId, githubId)).toBe(0)

  await setCapacity(trackId, githubId, 1)
  expect(await getCurrentCapacity(trackId, githubId)).toBe(1)
})

test('rejects a ratio outside 0-1', async () => {
  const trackId = await seedTrack()
  const githubId = await seedContributor()

  await expect(setCapacity(trackId, githubId, 1.5)).rejects.toThrow(InvalidCapacityError)
  await expect(setCapacity(trackId, githubId, -0.1)).rejects.toThrow(InvalidCapacityError)
})

test('re-setting closes the previous row and leaves exactly one current row', async () => {
  const trackId = await seedTrack()
  const githubId = await seedContributor()

  await setCapacity(trackId, githubId, 0.5)
  await setCapacity(trackId, githubId, 0.25)

  expect(await getCurrentCapacity(trackId, githubId)).toBe(0.25)
  const { rows } = await pool.query('SELECT count(*)::int AS count FROM track_member_capacity WHERE effective_until IS NULL')
  expect(rows[0].count).toBe(1)
  const { rows: allRows } = await pool.query('SELECT count(*)::int AS count FROM track_member_capacity')
  expect(allRows[0].count).toBe(2)
})

test('a change keeps the full history, not just the current value', async () => {
  const trackId = await seedTrack()
  const githubId = await seedContributor()

  await setCapacity(trackId, githubId, 0.75)
  await setCapacity(trackId, githubId, 0.5)

  const { rows } = await pool.query(
    'SELECT ratio::float AS ratio, effective_until IS NULL AS current FROM track_member_capacity ORDER BY effective_from',
  )
  expect(rows).toEqual([
    { ratio: 0.75, current: false },
    { ratio: 0.5, current: true },
  ])
})

test('listCurrentCapacities returns every current ratio for a track, keyed by github_id', async () => {
  const trackId = await seedTrack()
  await seedContributor('1001')
  await pool.query("INSERT INTO contributors (github_id, github_login) VALUES ('2002', 'grace')")
  await setCapacity(trackId, '1001', 0.5)

  const capacities = await listCurrentCapacities(trackId)

  expect(capacities.get('1001')).toBe(0.5)
  expect(capacities.has('2002')).toBe(false)
})

test('a capacity set on one track never affects another track for the same contributor', async () => {
  const studioId = await seedTrack('studio')
  const insightId = await seedTrack('insight')
  const githubId = await seedContributor()

  await setCapacity(studioId, githubId, 0.25)

  expect(await getCurrentCapacity(studioId, githubId)).toBe(0.25)
  expect(await getCurrentCapacity(insightId, githubId)).toBe(1)
})

test('getFabricWideCapacity sums current capacity across every approved track', async () => {
  const studioId = await seedTrack('studio')
  const insightId = await seedTrack('insight')
  const githubId = await seedContributor()
  await pool.query("INSERT INTO track_members (track_id, github_id, status) VALUES ($1, $2, 'approved')", [studioId, githubId])
  await pool.query("INSERT INTO track_members (track_id, github_id, status) VALUES ($1, $2, 'approved')", [insightId, githubId])
  await setCapacity(studioId, githubId, 0.5)
  // insightId left at the default (1) — never explicitly set.

  expect(await getFabricWideCapacity(githubId)).toBe(1.5)
})

test('getFabricWideCapacity ignores a track the contributor only has a pending request on', async () => {
  const trackId = await seedTrack()
  const githubId = await seedContributor()
  await pool.query("INSERT INTO track_members (track_id, github_id, status) VALUES ($1, $2, 'pending')", [trackId, githubId])

  expect(await getFabricWideCapacity(githubId)).toBe(0)
})
