import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest'
import { pool } from '@/lib/db'

// Same in-memory session double policies-visit-route.test.ts and
// dev-login-route.test.ts already use — the database is the real test one.
const { fakeSession } = vi.hoisted(() => ({
  fakeSession: {
    github: undefined as { id: string; login: string } | undefined,
    save: async () => {},
  },
}))

vi.mock('@/lib/session', () => ({
  getSession: async () => fakeSession,
}))

const { GET: namesRoute, MAX_LOGINS_PER_REQUEST } = await import('@/app/api/names/route')

beforeEach(async () => {
  fakeSession.github = undefined
  await pool.query('TRUNCATE contributors CASCADE')
})

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(async () => {
  await pool.end()
})

function namesRequest(logins?: string): Request {
  const url = logins === undefined ? 'http://localhost/api/names' : `http://localhost/api/names?logins=${encodeURIComponent(logins)}`
  return new Request(url)
}

test('401s with no session at all', async () => {
  const response = await namesRoute(namesRequest('octocat'))
  expect(response.status).toBe(401)
})

test("401s when the session's github id has no contributor row", async () => {
  fakeSession.github = { id: '9999', login: 'ghost' }

  const response = await namesRoute(namesRequest('octocat'))

  expect(response.status).toBe(401)
})

test('400s when logins is missing entirely', async () => {
  await pool.query("INSERT INTO contributors (github_id, github_login, status) VALUES ('1001', 'octocat', 'confirmed')")
  fakeSession.github = { id: '1001', login: 'octocat' }

  const response = await namesRoute(namesRequest())

  expect(response.status).toBe(400)
})

test('400s when logins is empty after cleanup', async () => {
  await pool.query("INSERT INTO contributors (github_id, github_login, status) VALUES ('1001', 'octocat', 'confirmed')")
  fakeSession.github = { id: '1001', login: 'octocat' }

  const response = await namesRoute(namesRequest(',,'))

  expect(response.status).toBe(400)
})

test('400s for more than the maximum logins, without querying for names', async () => {
  await pool.query("INSERT INTO contributors (github_id, github_login, status) VALUES ('1001', 'octocat', 'confirmed')")
  fakeSession.github = { id: '1001', login: 'octocat' }
  const tooMany = Array.from({ length: MAX_LOGINS_PER_REQUEST + 1 }, (_, i) => `user${i}`).join(',')
  const querySpy = vi.spyOn(pool, 'query')

  const response = await namesRoute(namesRequest(tooMany))

  expect(response.status).toBe(400)
  // The auth check itself (findByGithubId) is the only query issued — the
  // 400 short-circuits before listNamesByLogins ever runs.
  expect(querySpy).toHaveBeenCalledTimes(1)
  expect(querySpy.mock.calls[0][0]).toContain('FROM contributors WHERE github_id')
})

test('accepts exactly the maximum number of logins', async () => {
  await pool.query("INSERT INTO contributors (github_id, github_login, status) VALUES ('1001', 'octocat', 'confirmed')")
  fakeSession.github = { id: '1001', login: 'octocat' }
  const maxLogins = Array.from({ length: MAX_LOGINS_PER_REQUEST }, (_, i) => `user${i}`).join(',')

  const response = await namesRoute(namesRequest(maxLogins))

  expect(response.status).toBe(200)
})

test('normalizes mixed case and duplicate logins to one lowercased entry each', async () => {
  await pool.query(
    "INSERT INTO contributors (github_id, github_login, name, status) VALUES ('1001', 'octocat', 'Ada Lovelace', 'confirmed')",
  )
  fakeSession.github = { id: '1001', login: 'octocat' }

  const response = await namesRoute(namesRequest('OctoCat, octocat, OCTOCAT'))
  const body = await response.json()

  expect(response.status).toBe(200)
  expect(body.names).toEqual({ octocat: 'Ada Lovelace' })
  expect(body.unknown).toEqual([])
})

test('resolves a known login and reports an unknown one', async () => {
  await pool.query(
    "INSERT INTO contributors (github_id, github_login, name, status) VALUES ('1001', 'octocat', 'Ada Lovelace', 'confirmed')",
  )
  fakeSession.github = { id: '1001', login: 'octocat' }

  const response = await namesRoute(namesRequest('octocat,nobody-here'))
  const body = await response.json()

  expect(response.status).toBe(200)
  expect(body.names).toEqual({ octocat: 'Ada Lovelace' })
  expect(body.unknown).toEqual(['nobody-here'])
})

test('a non-confirmed contributor and one with an empty name both land in unknown', async () => {
  await pool.query(
    `INSERT INTO contributors (github_id, github_login, name, status) VALUES
       ('1001', 'octocat', 'Ada Lovelace', 'confirmed'),
       ('2002', 'draft-user', 'Grace Hopper', 'draft'),
       ('3003', 'nameless-user', '', 'confirmed')`,
  )
  fakeSession.github = { id: '1001', login: 'octocat' }

  const response = await namesRoute(namesRequest('octocat,draft-user,nameless-user'))
  const body = await response.json()

  expect(response.status).toBe(200)
  expect(body.names).toEqual({ octocat: 'Ada Lovelace' })
  expect(body.unknown.sort()).toEqual(['draft-user', 'nameless-user'])
})

test('carries Cache-Control: no-store on a successful response', async () => {
  await pool.query(
    "INSERT INTO contributors (github_id, github_login, name, status) VALUES ('1001', 'octocat', 'Ada Lovelace', 'confirmed')",
  )
  fakeSession.github = { id: '1001', login: 'octocat' }

  const response = await namesRoute(namesRequest('octocat'))

  expect(response.headers.get('Cache-Control')).toBe('no-store')
})

test('carries Cache-Control: no-store on a 401', async () => {
  const response = await namesRoute(namesRequest('octocat'))

  expect(response.headers.get('Cache-Control')).toBe('no-store')
})
