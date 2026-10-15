import { afterAll, beforeEach, expect, test } from 'vitest'
import { pool } from './db.ts'
import {
  createLab,
  deleteLab,
  findLabBySlug,
  isLabCandidate,
  LabSlugTakenError,
  listLabs,
  removeLabPerson,
  searchLabCandidates,
  setLabPerson,
  updateLab,
} from './labs.ts'

beforeEach(async () => {
  await pool.query('TRUNCATE lab_people, labs, tracks, contributors CASCADE')
  await pool.query(
    `INSERT INTO contributors (github_id, github_login, name, status) VALUES
       ('1', 'ada', 'Ada Lovelace', 'confirmed'),
       ('2', 'grace', 'Grace Hopper', 'confirmed'),
       ('3', 'drafty', NULL, 'draft'),
       ('9', 'admin', NULL, 'confirmed')`,
  )
})

afterAll(async () => {
  await pool.end()
})

const REPO = { url: 'https://github.com/constructorfabric/lab-x', description: 'Prototype' }

test('createLab stores the Lab and findLabBySlug reads it back with no people', async () => {
  await createLab('agentic-search', { name: 'Agentic Search', description: 'RAG experiments', repositories: [REPO] })

  const lab = await findLabBySlug('agentic-search')
  expect(lab).toMatchObject({
    slug: 'agentic-search',
    name: 'Agentic Search',
    description: 'RAG experiments',
    repositories: [REPO],
    people: [],
  })
  expect(await findLabBySlug('nope')).toBeNull()
})

test("createLab refuses a slug already used by another Lab or by a track", async () => {
  await createLab('agentic-search', { name: 'A', repositories: [] })
  await expect(createLab('agentic-search', { name: 'B', repositories: [] })).rejects.toBeInstanceOf(LabSlugTakenError)

  await pool.query("INSERT INTO tracks (slug, name) VALUES ('studio', 'Studio')")
  await expect(createLab('studio', { name: 'Studio Lab', repositories: [] })).rejects.toBeInstanceOf(LabSlugTakenError)
})

test('the database itself rejects a malformed slug', async () => {
  await expect(createLab('Bad Slug', { name: 'A', repositories: [] })).rejects.toThrow()
})

test('updateLab rewrites everything but the slug and returns the Lab as it was', async () => {
  const created = await createLab('lab', { name: 'Old', description: 'old', repositories: [REPO] })

  const before = await updateLab(created.id, { name: 'New', repositories: [] })

  expect(before).toMatchObject({ name: 'Old', description: 'old', repositories: [REPO] })
  expect(await findLabBySlug('lab')).toMatchObject({ slug: 'lab', name: 'New', description: undefined, repositories: [] })
  expect(await updateLab('00000000-0000-0000-0000-000000000000', { name: 'X', repositories: [] })).toBeNull()
})

test('setLabPerson adds, switches and reports the previous role; one row per person', async () => {
  const lab = await createLab('lab', { name: 'Lab', repositories: [] })

  expect(await setLabPerson(lab.id, '1', 'maintainer', '9')).toBeNull()
  expect(await setLabPerson(lab.id, '1', 'maintainer', '9')).toBe('maintainer')
  expect(await setLabPerson(lab.id, '1', 'leader', '9')).toBe('maintainer')
  await setLabPerson(lab.id, '2', 'maintainer', '9')

  const found = await findLabBySlug('lab')
  expect(found?.people.map((person) => [person.githubLogin, person.role, person.name])).toEqual([
    ['ada', 'leader', 'Ada Lovelace'],
    ['grace', 'maintainer', 'Grace Hopper'],
  ])
})

test('removeLabPerson returns the removed role, or null when they were not on the Lab', async () => {
  const lab = await createLab('lab', { name: 'Lab', repositories: [] })
  await setLabPerson(lab.id, '1', 'leader', '9')

  expect(await removeLabPerson(lab.id, '1')).toBe('leader')
  expect(await removeLabPerson(lab.id, '1')).toBeNull()
  expect((await findLabBySlug('lab'))?.people).toEqual([])
})

test('deleteLab removes the Lab and its people, and returns them', async () => {
  const lab = await createLab('lab', { name: 'Lab', repositories: [] })
  await setLabPerson(lab.id, '1', 'leader', '9')

  const deleted = await deleteLab(lab.id)

  expect(deleted?.people.map((person) => person.githubLogin)).toEqual(['ada'])
  expect(await findLabBySlug('lab')).toBeNull()
  const { rows } = await pool.query('SELECT 1 FROM lab_people')
  expect(rows).toEqual([])
})

test('listLabs orders by name and attaches each Lab its own people', async () => {
  const zeta = await createLab('zeta', { name: 'Zeta', repositories: [] })
  await createLab('alpha', { name: 'alpha', repositories: [] })
  await setLabPerson(zeta.id, '2', 'leader', '9')

  const labs = await listLabs()

  expect(labs.map((lab) => [lab.slug, lab.people.map((person) => person.githubLogin)])).toEqual([
    ['alpha', []],
    ['zeta', ['grace']],
  ])
})

test('searchLabCandidates finds confirmed contributors by login or name only', async () => {
  expect((await searchLabCandidates('ada')).map((candidate) => candidate.githubLogin)).toEqual(['ada'])
  expect((await searchLabCandidates('hopper')).map((candidate) => candidate.githubLogin)).toEqual(['grace'])
  expect(await searchLabCandidates('drafty')).toEqual([])
  expect(await searchLabCandidates('a')).toEqual([])
})

test('isLabCandidate admits confirmed contributors only', async () => {
  expect(await isLabCandidate('1')).toBe(true)
  expect(await isLabCandidate('3')).toBe(false)
  expect(await isLabCandidate('404')).toBe(false)
})
