import { afterAll, beforeEach, expect, test } from 'vitest'
import { listAdminActions, logAdminAction } from './audit-log.ts'
import { pool } from './db.ts'

beforeEach(async () => {
  await pool.query('TRUNCATE admin_actions, track_members, tracks, contributors CASCADE')
})

afterAll(async () => {
  await pool.end()
})

async function seedContributor(githubId: string, githubLogin: string): Promise<void> {
  await pool.query(
    `INSERT INTO contributors (github_id, github_login, name, email, status) VALUES ($1, $2, $2 || ' Name', $2 || '@example.com', 'confirmed')`,
    [githubId, githubLogin],
  )
}

test('logAdminAction records a confirm/block action with no track', async () => {
  await seedContributor('1', 'admin')
  await seedContributor('2', 'target')

  await logAdminAction({ actorGithubId: '1', action: 'confirm', targetGithubId: '2' })

  const actions = await listAdminActions()
  expect(actions).toHaveLength(1)
  expect(actions[0]).toMatchObject({
    actorGithubLogin: 'admin',
    action: 'confirm',
    targetGithubLogin: 'target',
    trackName: undefined,
  })
})

test('logAdminAction records an accept/reject action with a track', async () => {
  await seedContributor('1', 'trackadmin')
  await seedContributor('2', 'requester')
  const { rows } = await pool.query<{ id: string }>(`INSERT INTO tracks (slug, name) VALUES ('studio', 'Studio') RETURNING id`)

  await logAdminAction({ actorGithubId: '1', action: 'accept', targetGithubId: '2', trackId: rows[0].id })

  const actions = await listAdminActions()
  expect(actions).toHaveLength(1)
  expect(actions[0]).toMatchObject({
    actorGithubLogin: 'trackadmin',
    action: 'accept',
    targetGithubLogin: 'requester',
    trackName: 'Studio',
  })
})

test('listAdminActions orders newest first', async () => {
  await seedContributor('1', 'admin')
  await seedContributor('2', 'a')
  await seedContributor('3', 'b')

  await logAdminAction({ actorGithubId: '1', action: 'confirm', targetGithubId: '2' })
  await logAdminAction({ actorGithubId: '1', action: 'block', targetGithubId: '3' })

  const actions = await listAdminActions()
  expect(actions.map((a) => a.targetGithubLogin)).toEqual(['b', 'a'])
})

test('listAdminActions returns an empty list when nothing has happened yet', async () => {
  await seedContributor('1', 'admin')
  expect(await listAdminActions()).toEqual([])
})

test('logAdminAction never throws, even against a nonexistent actor', async () => {
  await expect(logAdminAction({ actorGithubId: '999', action: 'confirm', targetGithubId: '1' })).resolves.toBeUndefined()
})

test('logAdminAction records a system action with no actor', async () => {
  await seedContributor('1', 'requester')
  const { rows } = await pool.query<{ id: string }>(`INSERT INTO tracks (slug, name) VALUES ('governance', 'Governance') RETURNING id`)

  await logAdminAction({
    action: 'governance_auto_approve',
    targetGithubId: '1',
    trackId: rows[0].id,
    details: { reason: 'track_admin' },
  })

  const actions = await listAdminActions()
  expect(actions).toHaveLength(1)
  expect(actions[0]).toMatchObject({
    actorGithubId: undefined,
    actorGithubLogin: undefined,
    action: 'governance_auto_approve',
    targetGithubLogin: 'requester',
    trackName: 'Governance',
    details: { reason: 'track_admin' },
  })
})
