import { expect, test } from 'vitest'
import {
  dedupeRepositories,
  isValidLabSlug,
  MAX_LAB_REPOSITORIES,
  normalizeLabInput,
  parseRepositoryUrl,
  slugifyLabName,
} from './lab-input.ts'

test('isValidLabSlug accepts lowercase words joined by single hyphens', () => {
  expect(isValidLabSlug('agentic-search')).toBe(true)
  expect(isValidLabSlug('lab2')).toBe(true)
  expect(isValidLabSlug('Agentic')).toBe(false)
  expect(isValidLabSlug('agentic--search')).toBe(false)
  expect(isValidLabSlug('-agentic')).toBe(false)
  expect(isValidLabSlug('agentic_search')).toBe(false)
  expect(isValidLabSlug('')).toBe(false)
})

test('slugifyLabName turns a display name into a valid slug', () => {
  expect(slugifyLabName('Agentic Search (v2)')).toBe('agentic-search-v2')
  expect(slugifyLabName('  RAG -- experiments ')).toBe('rag-experiments')
  expect(isValidLabSlug(slugifyLabName('Agentic Search (v2)'))).toBe(true)
})

test('parseRepositoryUrl accepts the forms an Admin pastes and canonicalizes them', () => {
  const expected = { url: 'https://github.com/constructorfabric/lab-x', owner: 'constructorfabric', name: 'lab-x' }
  expect(parseRepositoryUrl('https://github.com/constructorfabric/lab-x')).toEqual(expected)
  expect(parseRepositoryUrl('http://www.github.com/constructorfabric/lab-x/')).toEqual(expected)
  expect(parseRepositoryUrl('github.com/constructorfabric/lab-x.git')).toEqual(expected)
  expect(parseRepositoryUrl(' constructorfabric/lab-x ')).toEqual(expected)
})

test('parseRepositoryUrl rejects anything that is not exactly one repository', () => {
  expect(parseRepositoryUrl('https://github.com/constructorfabric')).toBeNull()
  expect(parseRepositoryUrl('https://github.com/constructorfabric/lab-x/tree/main')).toBeNull()
  expect(parseRepositoryUrl('https://gitlab.com/constructorfabric/lab-x')).toBeNull()
  expect(parseRepositoryUrl('lab-x')).toBeNull()
  expect(parseRepositoryUrl('')).toBeNull()
})

test('dedupeRepositories keeps the first entry for a repository, case-insensitively', () => {
  expect(
    dedupeRepositories([
      { url: 'https://github.com/org/Lab', description: 'first' },
      { url: 'https://github.com/org/lab', description: 'second' },
      { url: 'https://github.com/org/other' },
    ]),
  ).toEqual([{ url: 'https://github.com/org/Lab', description: 'first' }, { url: 'https://github.com/org/other' }])
})

test('normalizeLabInput trims, canonicalizes repositories and drops blank rows', () => {
  expect(
    normalizeLabInput({
      name: '  Agentic Search ',
      description: '  ',
      repositories: [
        { url: 'constructorfabric/lab-x', description: ' Prototype ' },
        { url: '', description: '' },
      ],
    }),
  ).toEqual({
    ok: true,
    input: {
      name: 'Agentic Search',
      repositories: [{ url: 'https://github.com/constructorfabric/lab-x', description: 'Prototype' }],
    },
  })
})

test('normalizeLabInput refuses a missing name or a row that is not a repository', () => {
  expect(normalizeLabInput({ name: ' ', description: '', repositories: [] })).toEqual({
    ok: false,
    message: 'A Lab needs a name.',
  })
  const result = normalizeLabInput({ name: 'Lab', description: '', repositories: [{ url: 'not a repo', description: '' }] })
  expect(result.ok).toBe(false)
  expect(!result.ok && result.message).toContain('"not a repo" is not a GitHub repository')
})

test('normalizeLabInput refuses malformed input instead of trusting its shape', () => {
  expect(normalizeLabInput(null).ok).toBe(false)
  expect(normalizeLabInput({ name: 'Lab', repositories: 'x' }).ok).toBe(false)
  expect(normalizeLabInput({ name: 'Lab', repositories: [42] }).ok).toBe(false)
})

test('normalizeLabInput caps the number of repositories', () => {
  const repositories = Array.from({ length: MAX_LAB_REPOSITORIES + 1 }, (_, i) => ({ url: `org/repo-${i}`, description: '' }))
  expect(normalizeLabInput({ name: 'Lab', description: '', repositories }).ok).toBe(false)
})
