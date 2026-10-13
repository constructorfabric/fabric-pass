import { afterAll, beforeEach, expect, test, vi } from 'vitest'

const { fakeSession } = vi.hoisted(() => ({
  fakeSession: { github: { id: '1001', login: 'admin' } as { id: string; login: string } | undefined },
}))

vi.mock('@/lib/session', () => ({
  getSession: async () => fakeSession,
}))

// IDEA-157's GitHub side has its own tests (lib/lab-access.test.ts); here
// it's enough to see each action hand it the right change.
const { access } = vi.hoisted(() => ({ access: { calls: [] as unknown[][] } }))
vi.mock('@/lib/lab-access', () => ({
  grantLabAccess: async (contributor: { githubLogin: string }, lab: { slug: string }, role: string, previous: string | null) => {
    access.calls.push(['grant', contributor.githubLogin, lab.slug, role, previous])
  },
  revokeLabAccess: async (contributor: { githubLogin: string }, lab: { slug: string }, role: string) => {
    access.calls.push(['revoke', contributor.githubLogin, lab.slug, role])
  },
  syncLabRepositories: async (lab: { slug: string; repositories: { url: string }[]; roles: string[] }, before: { url: string }[]) => {
    access.calls.push(['sync', lab.slug, lab.repositories.map((r) => r.url), lab.roles, before.map((r) => r.url)])
  },
  revokeDeletedLabAccess: async (lab: { slug: string }, people: { contributor: { githubLogin: string }; role: string }[]) => {
    access.calls.push(['delete', lab.slug, people.map((person) => [person.contributor.githubLogin, person.role])])
  },
}))

const { pool } = await import('@/lib/db')
const { findLabBySlug } = await import('@/lib/labs')
const { createLabAction, deleteLabAction, removeLabPersonAction, searchLabCandidatesAction, setLabPersonAction, updateLabAction } =
  await import('./actions.ts')

const FORM = { name: 'Agentic Search', description: 'RAG experiments', repositories: [{ url: 'org/lab-x', description: '' }] }

beforeEach(async () => {
  fakeSession.github = { id: '1001', login: 'admin' }
  access.calls = []
  await pool.query('TRUNCATE lab_people, labs, admin_actions, tracks, contributors CASCADE')
  await pool.query(
    `INSERT INTO contributors (github_id, github_login, is_admin, status) VALUES
       ('1001', 'admin', true, 'confirmed'),
       ('1', 'ada', false, 'confirmed'),
       ('2', 'drafty', false, 'draft')`,
  )
})

afterAll(async () => {
  await pool.end()
})

async function auditActions(): Promise<{ action: string; target_github_id: string | null; details: Record<string, unknown> }[]> {
  const { rows } = await pool.query(
    'SELECT action, target_github_id::text, details FROM admin_actions ORDER BY created_at, action',
  )
  return rows
}

test('every Lab action refuses a non-admin', async () => {
  await pool.query("UPDATE contributors SET is_admin = false WHERE github_id = '1001'")

  expect(await createLabAction('lab', FORM)).toEqual({ ok: false, message: 'Not authorized.' })
  expect(await searchLabCandidatesAction('ada')).toEqual([])
})

test('every Lab action asks a signed-out caller to sign in', async () => {
  fakeSession.github = undefined

  expect(await createLabAction('lab', FORM)).toMatchObject({ ok: false, reauthRequired: true })
})

test('createLabAction creates the Lab, canonicalizes repositories and logs it', async () => {
  const result = await createLabAction('agentic-search', FORM)

  expect(result.ok).toBe(true)
  expect(result.lab).toMatchObject({
    slug: 'agentic-search',
    name: 'Agentic Search',
    repositories: [{ url: 'https://github.com/org/lab-x' }],
    people: [],
  })
  expect(await auditActions()).toEqual([
    { action: 'lab_create', target_github_id: null, details: { lab: 'agentic-search', labName: 'Agentic Search' } },
  ])
})

test('createLabAction refuses a malformed slug and a taken one', async () => {
  expect((await createLabAction('Bad Slug', FORM)).ok).toBe(false)

  await pool.query("INSERT INTO tracks (slug, name) VALUES ('studio', 'Studio')")
  const taken = await createLabAction('studio', FORM)
  expect(taken).toEqual({ ok: false, message: '"studio" is already used by a Lab or a track. Choose another slug.' })
})

test('updateLabAction saves the details and logs only the fields that changed', async () => {
  await createLabAction('lab', FORM)

  const result = await updateLabAction('lab', { ...FORM, name: 'Renamed' })

  expect(result.lab?.name).toBe('Renamed')
  const update = (await auditActions()).find((entry) => entry.action === 'lab_update')
  expect(update?.details).toEqual({ lab: 'lab', labName: 'Renamed', changed: ['name'] })

  await updateLabAction('lab', { ...FORM, name: 'Renamed' })
  expect((await auditActions()).filter((entry) => entry.action === 'lab_update')).toHaveLength(1)
})

test('updateLabAction reports a Lab that no longer exists', async () => {
  expect(await updateLabAction('gone', FORM)).toEqual({ ok: false, message: 'This Lab no longer exists.' })
})

test('setLabPersonAction adds a person, then switches their role, logging each', async () => {
  await createLabAction('lab', FORM)

  const added = await setLabPersonAction('lab', '1', 'maintainer')
  expect(added.lab?.people).toEqual([
    { githubId: '1', githubLogin: 'ada', name: null, role: 'maintainer', profileHash: expect.any(String) },
  ])

  const switched = await setLabPersonAction('lab', '1', 'leader')
  expect(switched.lab?.people.map((person) => person.role)).toEqual(['leader'])

  const people = (await auditActions()).filter((entry) => entry.action !== 'lab_create')
  expect(people).toEqual([
    { action: 'lab_add_person', target_github_id: '1', details: { lab: 'lab', labName: 'Agentic Search', role: 'maintainer' } },
    {
      action: 'lab_change_role',
      target_github_id: '1',
      details: { lab: 'lab', labName: 'Agentic Search', from: 'maintainer', to: 'leader' },
    },
  ])
})

test('setLabPersonAction refuses an unknown role, a non-confirmed contributor and a malformed id', async () => {
  await createLabAction('lab', FORM)

  expect(await setLabPersonAction('lab', '1', 'owner')).toEqual({ ok: false, message: 'Unknown Lab role.' })
  expect((await setLabPersonAction('lab', '2', 'leader')).ok).toBe(false)
  expect((await setLabPersonAction('lab', "1' OR 1=1", 'leader')).ok).toBe(false)
  expect((await findLabBySlug('lab'))?.people).toEqual([])
})

test('removeLabPersonAction removes the person and logs the role they held', async () => {
  await createLabAction('lab', FORM)
  await setLabPersonAction('lab', '1', 'leader')

  const result = await removeLabPersonAction('lab', '1')

  expect(result.lab?.people).toEqual([])
  expect((await auditActions()).at(-1)).toEqual({
    action: 'lab_remove_person',
    target_github_id: '1',
    details: { lab: 'lab', labName: 'Agentic Search', role: 'leader' },
  })
})

test('deleteLabAction deletes the Lab and the audit entry still names it', async () => {
  await createLabAction('lab', FORM)

  expect(await deleteLabAction('lab')).toEqual({ ok: true })
  expect(await findLabBySlug('lab')).toBeNull()
  expect((await auditActions()).at(-1)).toEqual({
    action: 'lab_delete',
    target_github_id: null,
    details: { lab: 'lab', labName: 'Agentic Search' },
  })
})

test('searchLabCandidatesAction returns confirmed contributors for an Admin', async () => {
  expect((await searchLabCandidatesAction('ad')).map((candidate) => candidate.githubLogin)).toEqual(['ada', 'admin'])
})

test('IDEA-157: adding, switching and removing a person hands each change to lab-access', async () => {
  await createLabAction('lab', FORM)

  await setLabPersonAction('lab', '1', 'maintainer')
  await setLabPersonAction('lab', '1', 'maintainer')
  await setLabPersonAction('lab', '1', 'leader')
  await removeLabPersonAction('lab', '1')
  await removeLabPersonAction('lab', '1')

  expect(access.calls).toEqual([
    ['grant', 'ada', 'lab', 'maintainer', null],
    ['grant', 'ada', 'lab', 'leader', 'maintainer'],
    ['revoke', 'ada', 'lab', 'leader'],
  ])
})

test('IDEA-157: editing the repositories syncs them with the roles held; other edits do not', async () => {
  await createLabAction('lab', FORM)
  await setLabPersonAction('lab', '1', 'leader')
  access.calls = []

  await updateLabAction('lab', { ...FORM, name: 'Renamed' })
  expect(access.calls).toEqual([])

  await updateLabAction('lab', { ...FORM, repositories: [{ url: 'org/lab-y', description: '' }] })
  expect(access.calls).toEqual([['sync', 'lab', ['https://github.com/org/lab-y'], ['leader'], ['https://github.com/org/lab-x']]])
})

test('IDEA-157: deleting a Lab revokes the access of everyone who was on it', async () => {
  await createLabAction('lab', FORM)
  await setLabPersonAction('lab', '1', 'leader')
  access.calls = []

  await deleteLabAction('lab')

  expect(access.calls).toEqual([['delete', 'lab', [['ada', 'leader']]]])
})
