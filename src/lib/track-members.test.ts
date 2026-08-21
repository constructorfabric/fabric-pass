import { afterAll, beforeEach, expect, test } from 'vitest'
import { pool } from './db.ts'
import {
  anyMembershipSummary,
  decideJoinRequest,
  getMyMembership,
  listTrackMembership,
  NotApprovedError,
  NotPendingError,
  removeTrackMember,
  requestToJoinTrack,
  setTrackMemberRole,
} from './track-members.ts'

beforeEach(async () => {
  await pool.query('TRUNCATE track_members, tracks, contributors CASCADE')
})

afterAll(async () => {
  await pool.end()
})

async function seedTrack(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO tracks (slug, name) VALUES ('studio', 'Studio') RETURNING id`,
  )
  return rows[0].id
}

async function seedContributor(githubId: string, githubLogin: string): Promise<void> {
  await pool.query(
    `INSERT INTO contributors (github_id, github_login, name, email, status)
     VALUES ($1, $2, $3, $2 || '@example.com', 'confirmed')`,
    [githubId, githubLogin, `${githubLogin} Name`],
  )
}

test('requestToJoinTrack inserts a fresh pending row', async () => {
  const trackId = await seedTrack()
  await seedContributor('1', 'ada')

  await requestToJoinTrack(trackId, '1')

  const membership = await getMyMembership(trackId, '1')
  expect(membership?.status).toBe('pending')
  expect(membership?.decidedAt).toBeUndefined()
})

test('requestToJoinTrack is a no-op for an already-pending row', async () => {
  const trackId = await seedTrack()
  await seedContributor('1', 'ada')
  await requestToJoinTrack(trackId, '1')
  const first = await getMyMembership(trackId, '1')

  await requestToJoinTrack(trackId, '1')
  const second = await getMyMembership(trackId, '1')

  expect(second?.requestedAt).toEqual(first?.requestedAt)
})

test('requestToJoinTrack is a no-op for an already-approved row', async () => {
  const trackId = await seedTrack()
  await seedContributor('1', 'ada')
  await seedContributor('2', 'admin')
  await requestToJoinTrack(trackId, '1')
  await decideJoinRequest(trackId, '1', 'approved', '2')

  await requestToJoinTrack(trackId, '1')

  const membership = await getMyMembership(trackId, '1')
  expect(membership?.status).toBe('approved')
})

test('requestToJoinTrack resets a rejected row back to pending', async () => {
  const trackId = await seedTrack()
  await seedContributor('1', 'ada')
  await seedContributor('2', 'admin')
  await requestToJoinTrack(trackId, '1')
  await decideJoinRequest(trackId, '1', 'rejected', '2')

  await requestToJoinTrack(trackId, '1')

  const membership = await getMyMembership(trackId, '1')
  expect(membership?.status).toBe('pending')
  expect(membership?.decidedAt).toBeUndefined()
  expect(membership?.decidedByGithubId).toBeUndefined()
})

test('requestToJoinTrack resets a removed row back to pending', async () => {
  const trackId = await seedTrack()
  await seedContributor('1', 'ada')
  await seedContributor('2', 'admin')
  await requestToJoinTrack(trackId, '1')
  await decideJoinRequest(trackId, '1', 'approved', '2')
  await removeTrackMember(trackId, '1', '2')

  await requestToJoinTrack(trackId, '1')

  const membership = await getMyMembership(trackId, '1')
  expect(membership?.status).toBe('pending')
  expect(membership?.decidedAt).toBeUndefined()
  expect(membership?.decidedByGithubId).toBeUndefined()
})

test('getMyMembership returns null when the contributor never requested', async () => {
  const trackId = await seedTrack()
  await seedContributor('1', 'ada')

  expect(await getMyMembership(trackId, '1')).toBeNull()
})

test('decideJoinRequest approves a pending request and stamps the decider', async () => {
  const trackId = await seedTrack()
  await seedContributor('1', 'ada')
  await seedContributor('2', 'admin')
  await requestToJoinTrack(trackId, '1')

  await decideJoinRequest(trackId, '1', 'approved', '2')

  const membership = await getMyMembership(trackId, '1')
  expect(membership?.status).toBe('approved')
  expect(membership?.decidedByGithubId).toBe('2')
  expect(membership?.decidedAt).toBeInstanceOf(Date)
})

test('decideJoinRequest rejects a pending request', async () => {
  const trackId = await seedTrack()
  await seedContributor('1', 'ada')
  await seedContributor('2', 'admin')
  await requestToJoinTrack(trackId, '1')

  await decideJoinRequest(trackId, '1', 'rejected', '2')

  const membership = await getMyMembership(trackId, '1')
  expect(membership?.status).toBe('rejected')
})

test('decideJoinRequest throws for a row that is not pending, and does not touch it', async () => {
  const trackId = await seedTrack()
  await seedContributor('1', 'ada')
  await seedContributor('2', 'admin')
  await requestToJoinTrack(trackId, '1')
  await decideJoinRequest(trackId, '1', 'approved', '2')

  await expect(decideJoinRequest(trackId, '1', 'rejected', '2')).rejects.toThrow(NotPendingError)

  const membership = await getMyMembership(trackId, '1')
  expect(membership?.status).toBe('approved')
})

test('decideJoinRequest throws for a row that never requested at all', async () => {
  const trackId = await seedTrack()
  await seedContributor('1', 'ada')
  await seedContributor('2', 'admin')

  await expect(decideJoinRequest(trackId, '1', 'approved', '2')).rejects.toThrow(NotPendingError)
})

test('removeTrackMember sets an approved row to removed and stamps the decider', async () => {
  const trackId = await seedTrack()
  await seedContributor('1', 'ada')
  await seedContributor('2', 'admin')
  await requestToJoinTrack(trackId, '1')
  await decideJoinRequest(trackId, '1', 'approved', '2')

  await removeTrackMember(trackId, '1', '2')

  const membership = await getMyMembership(trackId, '1')
  expect(membership?.status).toBe('removed')
  expect(membership?.decidedByGithubId).toBe('2')
  expect(membership?.decidedAt).toBeInstanceOf(Date)
})

test('removeTrackMember throws for a row that is not approved, and does not touch it', async () => {
  const trackId = await seedTrack()
  await seedContributor('1', 'ada')
  await seedContributor('2', 'admin')
  await requestToJoinTrack(trackId, '1')

  await expect(removeTrackMember(trackId, '1', '2')).rejects.toThrow(NotApprovedError)

  const membership = await getMyMembership(trackId, '1')
  expect(membership?.status).toBe('pending')
})

test('removeTrackMember throws for a row that never requested at all', async () => {
  const trackId = await seedTrack()
  await seedContributor('1', 'ada')
  await seedContributor('2', 'admin')

  await expect(removeTrackMember(trackId, '1', '2')).rejects.toThrow(NotApprovedError)
})

test('an approved member defaults to the contributor role', async () => {
  const trackId = await seedTrack()
  await seedContributor('1', 'ada')
  await seedContributor('2', 'admin')
  await requestToJoinTrack(trackId, '1')
  await decideJoinRequest(trackId, '1', 'approved', '2')

  const membership = await getMyMembership(trackId, '1')
  expect(membership?.role).toBe('contributor')
})

test('setTrackMemberRole promotes an approved member to maintainer', async () => {
  const trackId = await seedTrack()
  await seedContributor('1', 'ada')
  await seedContributor('2', 'admin')
  await requestToJoinTrack(trackId, '1')
  await decideJoinRequest(trackId, '1', 'approved', '2')

  await setTrackMemberRole(trackId, '1', 'maintainer')

  const membership = await getMyMembership(trackId, '1')
  expect(membership?.role).toBe('maintainer')
})

test('setTrackMemberRole demotes a maintainer back to contributor', async () => {
  const trackId = await seedTrack()
  await seedContributor('1', 'ada')
  await seedContributor('2', 'admin')
  await requestToJoinTrack(trackId, '1')
  await decideJoinRequest(trackId, '1', 'approved', '2')
  await setTrackMemberRole(trackId, '1', 'maintainer')

  await setTrackMemberRole(trackId, '1', 'contributor')

  const membership = await getMyMembership(trackId, '1')
  expect(membership?.role).toBe('contributor')
})

test('setTrackMemberRole is a harmless no-op, not an error, when the role is already what was asked for', async () => {
  const trackId = await seedTrack()
  await seedContributor('1', 'ada')
  await seedContributor('2', 'admin')
  await requestToJoinTrack(trackId, '1')
  await decideJoinRequest(trackId, '1', 'approved', '2')

  await expect(setTrackMemberRole(trackId, '1', 'contributor')).resolves.toBeUndefined()
})

test('setTrackMemberRole throws for a row that is not approved', async () => {
  const trackId = await seedTrack()
  await seedContributor('1', 'ada')
  await seedContributor('2', 'admin')
  await requestToJoinTrack(trackId, '1')

  await expect(setTrackMemberRole(trackId, '1', 'maintainer')).rejects.toThrow(NotApprovedError)
})

test('removeTrackMember resets a maintainer back to the contributor role', async () => {
  const trackId = await seedTrack()
  await seedContributor('1', 'ada')
  await seedContributor('2', 'admin')
  await requestToJoinTrack(trackId, '1')
  await decideJoinRequest(trackId, '1', 'approved', '2')
  await setTrackMemberRole(trackId, '1', 'maintainer')

  await removeTrackMember(trackId, '1', '2')
  await requestToJoinTrack(trackId, '1')
  await decideJoinRequest(trackId, '1', 'approved', '2')

  // Re-approved after being removed — starts back at contributor, not
  // silently still a maintainer from before.
  const membership = await getMyMembership(trackId, '1')
  expect(membership?.role).toBe('contributor')
})

test('listTrackMembership returns every row for a track, with contributor login/name joined in', async () => {
  const trackId = await seedTrack()
  await seedContributor('1', 'ada')
  await seedContributor('2', 'grace')
  await seedContributor('3', 'admin')
  await requestToJoinTrack(trackId, '1')
  await requestToJoinTrack(trackId, '2')
  await decideJoinRequest(trackId, '2', 'approved', '3')

  const members = await listTrackMembership(trackId)

  expect(members).toHaveLength(2)
  const byLogin = Object.fromEntries(members.map((m) => [m.githubLogin, m]))
  expect(byLogin.ada.status).toBe('pending')
  expect(byLogin.ada.name).toBe('ada Name')
  expect(byLogin.grace.status).toBe('approved')
})

test('listTrackMembership scopes strictly to the given track', async () => {
  const trackId = await seedTrack()
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO tracks (slug, name) VALUES ('insight', 'Insight') RETURNING id`,
  )
  const otherTrackId = rows[0].id
  await seedContributor('1', 'ada')
  await requestToJoinTrack(trackId, '1')
  await requestToJoinTrack(otherTrackId, '1')

  const members = await listTrackMembership(trackId)

  expect(members).toHaveLength(1)
  expect(members[0].trackId).toBe(trackId)
})

test('anyMembershipSummary reports none when the contributor has never requested anywhere', async () => {
  await seedContributor('1', 'ada')
  expect(await anyMembershipSummary('1')).toBe('none')
})

test('anyMembershipSummary reports pending while a request is awaiting review', async () => {
  const trackId = await seedTrack()
  await seedContributor('1', 'ada')
  await requestToJoinTrack(trackId, '1')

  expect(await anyMembershipSummary('1')).toBe('pending')
})

test('anyMembershipSummary reports approved once any track has accepted the contributor', async () => {
  const trackId = await seedTrack()
  await seedContributor('1', 'ada')
  await seedContributor('2', 'admin')
  await requestToJoinTrack(trackId, '1')
  await decideJoinRequest(trackId, '1', 'approved', '2')

  expect(await anyMembershipSummary('1')).toBe('approved')
})

test('anyMembershipSummary prefers approved over a pending request on a different track', async () => {
  const trackId = await seedTrack()
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO tracks (slug, name) VALUES ('insight', 'Insight') RETURNING id`,
  )
  const otherTrackId = rows[0].id
  await seedContributor('1', 'ada')
  await seedContributor('2', 'admin')
  await requestToJoinTrack(trackId, '1')
  await decideJoinRequest(trackId, '1', 'approved', '2')
  await requestToJoinTrack(otherTrackId, '1')

  expect(await anyMembershipSummary('1')).toBe('approved')
})

test('anyMembershipSummary reports none for a rejected-only history, not stuck', async () => {
  const trackId = await seedTrack()
  await seedContributor('1', 'ada')
  await seedContributor('2', 'admin')
  await requestToJoinTrack(trackId, '1')
  await decideJoinRequest(trackId, '1', 'rejected', '2')

  expect(await anyMembershipSummary('1')).toBe('none')
})

test('anyMembershipSummary reports none for a removed-only history, not stuck on approved', async () => {
  const trackId = await seedTrack()
  await seedContributor('1', 'ada')
  await seedContributor('2', 'admin')
  await requestToJoinTrack(trackId, '1')
  await decideJoinRequest(trackId, '1', 'approved', '2')
  await removeTrackMember(trackId, '1', '2')

  expect(await anyMembershipSummary('1')).toBe('none')
})
