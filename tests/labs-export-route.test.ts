import { afterAll, beforeEach, expect, test } from 'vitest'
import { parse } from 'yaml'
import { GET as exportRoute } from '@/app/internal/labs/export/route'
import { createLab, setLabPerson } from '@/lib/labs'
import { pool } from '@/lib/db'

// tests/setup.ts has loaded .env.test, so this matches its LABS_EXPORT_SECRET.
const EXPORT_SECRET = 'test-labs-export-secret'

beforeEach(async () => {
  await pool.query('TRUNCATE lab_people, labs, contributors CASCADE')
})

afterAll(async () => {
  await pool.end()
})

test('refuses a request with no or the wrong secret', async () => {
  const noAuth = await exportRoute(new Request('http://localhost/internal/labs/export'))
  expect(noAuth.status).toBe(401)

  const wrongAuth = await exportRoute(
    new Request('http://localhost/internal/labs/export', { headers: { authorization: 'Bearer nope' } }),
  )
  expect(wrongAuth.status).toBe(401)
})

test('returns every Lab as YAML, with people listed by login under their role', async () => {
  await pool.query("INSERT INTO contributors (github_id, github_login, status) VALUES ('1', 'ada', 'confirmed'), ('2', 'grace', 'confirmed')")
  const lab = await createLab('agentic-search', {
    name: 'Agentic Search',
    description: 'RAG experiments',
    repositories: [{ url: 'https://github.com/constructorfabric/lab-x', description: 'Prototype' }, { url: 'https://github.com/constructorfabric/lab-y' }],
  })
  await setLabPerson(lab.id, '1', 'leader', '2')
  await setLabPerson(lab.id, '2', 'maintainer', '2')
  await createLab('empty', { name: 'Empty', repositories: [] })

  const response = await exportRoute(
    new Request('http://localhost/internal/labs/export', { headers: { authorization: `Bearer ${EXPORT_SECRET}` } }),
  )

  expect(response.status).toBe(200)
  expect(parse(await response.text())).toEqual({
    labs: [
      {
        slug: 'agentic-search',
        name: 'Agentic Search',
        description: 'RAG experiments',
        repositories: [
          { url: 'https://github.com/constructorfabric/lab-x', description: 'Prototype' },
          { url: 'https://github.com/constructorfabric/lab-y' },
        ],
        leaders: ['ada'],
        maintainers: ['grace'],
      },
      { slug: 'empty', name: 'Empty', repositories: [], leaders: [], maintainers: [] },
    ],
  })
})
