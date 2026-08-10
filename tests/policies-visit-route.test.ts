import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { syncArtifactLinks } from '@/lib/artifact-links'
import { pool } from '@/lib/db'

// Same in-memory session double dev-login-route.test.ts and the auth-callback
// guard tests already use — the database is the real test one.
const { fakeSession } = vi.hoisted(() => ({
  fakeSession: {
    github: undefined as { id: string; login: string } | undefined,
    save: async () => {},
  },
}))

vi.mock('@/lib/session', () => ({
  getSession: async () => fakeSession,
}))

const { GET } = await import('@/app/policies/visit/route')

const POLICY_URL = 'https://example.com/code-of-conduct'
const VISION_URL = 'https://example.com/mission'

beforeEach(async () => {
  fakeSession.github = undefined
  await pool.query('TRUNCATE contributors CASCADE')
  await pool.query(
    `INSERT INTO contributors (github_id, github_login, name, status) VALUES ('583231', 'octocat', 'Ada Lovelace', 'confirmed')`,
  )
  await syncArtifactLinks([
    { scope: 'community', category: 'policy', label: 'Code of Conduct', url: POLICY_URL },
    { scope: 'community', category: 'vision', label: 'Mission Statement', url: VISION_URL },
  ])
})

afterEach(() => {
  vi.unstubAllEnvs()
})

afterAll(async () => {
  await pool.end()
})

function visitRequest(url: string) {
  return new NextRequest(`http://localhost:3000/policies/visit?${url}`)
}

async function clickedAt(): Promise<Date | null> {
  const { rows } = await pool.query<{ policy_link_clicked_at: Date | null }>(
    "SELECT policy_link_clicked_at FROM contributors WHERE github_id = '583231'",
  )
  return rows[0].policy_link_clicked_at
}

test('rejects a request with no url at all', async () => {
  const response = await GET(visitRequest(''))
  expect(response.status).toBe(400)
})

test('rejects a url that names no real policy link', async () => {
  const response = await GET(visitRequest('url=' + encodeURIComponent('https://evil.example/phishing')))
  expect(response.status).toBe(400)
})

// The security-critical case: this endpoint is otherwise an open redirect
// (any signed-in visitor could be handed a link to this app's own trusted
// domain that silently forwards them anywhere). A vision-category link is a
// real row in the same table — proving the category filter matters, not
// just "is this URL present somewhere in artifact_links at all".
test('rejects a real artifact link that is not a policy link', async () => {
  const response = await GET(visitRequest('url=' + encodeURIComponent(VISION_URL)))
  expect(response.status).toBe(400)
})

test('redirects to the real policy URL for a signed-out visitor, without recording a click', async () => {
  const response = await GET(visitRequest('url=' + encodeURIComponent(POLICY_URL)))

  expect(response.status).toBe(302)
  expect(response.headers.get('location')).toBe(POLICY_URL)
  expect(await clickedAt()).toBeNull()
})

test('redirects and records the click for a signed-in visitor', async () => {
  fakeSession.github = { id: '583231', login: 'octocat' }

  const response = await GET(visitRequest('url=' + encodeURIComponent(POLICY_URL)))

  expect(response.status).toBe(302)
  expect(response.headers.get('location')).toBe(POLICY_URL)
  expect(await clickedAt()).toBeInstanceOf(Date)
})

test('a second click just re-stamps the same signal, not an error', async () => {
  fakeSession.github = { id: '583231', login: 'octocat' }

  await GET(visitRequest('url=' + encodeURIComponent(POLICY_URL)))
  const first = await clickedAt()

  await GET(visitRequest('url=' + encodeURIComponent(POLICY_URL)))
  const second = await clickedAt()

  expect(second).toBeInstanceOf(Date)
  expect(second!.getTime()).toBeGreaterThanOrEqual(first!.getTime())
})
