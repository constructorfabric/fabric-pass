import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const { fakeEnv } = vi.hoisted(() => ({ fakeEnv: { GITHUB_ORG_TOKEN: 'test-token' as string | undefined } }))

vi.mock('@/lib/env', () => ({ env: fakeEnv }))

const { DISCOVERY_TTL_MS, discoverTrackRepositories, mergeTrackRepositories, resolveTrackRepositories } = await import('./track-repositories.ts')

const ORG_URL = 'https://github.com/constructorfabric'

function repo(name: string, overrides: Record<string, unknown> = {}) {
  return { name, html_url: `${ORG_URL}/${name}`, description: null, archived: false, private: false, ...overrides }
}

function properties(name: string, track: string | null) {
  return { repository_name: name, properties: [{ property_name: 'Track', value: track }] }
}

/** Answers GitHub's two listing endpoints from fixtures, counting calls. */
function stubGitHub(repos: unknown[], propertyRows: unknown[]) {
  const fetchMock = vi.fn(async (url: string) =>
    url.includes('/properties/values') ? Response.json(propertyRows) : Response.json(repos),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

let orgCounter = 0
/** A fresh organization name per test — discovery results are cached per organization. */
function freshOrg() {
  orgCounter += 1
  return `org-${orgCounter}`
}

beforeEach(() => {
  fakeEnv.GITHUB_ORG_TOKEN = 'test-token'
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('mergeTrackRepositories adds a tagged repository the file does not list', () => {
  const merged = mergeTrackRepositories(
    'Gears FrontX',
    [{ url: `${ORG_URL}/gears-frontx`, description: 'The kit' }],
    [{ url: `${ORG_URL}/frontx-showcase`, track: 'Gears FrontX' }],
  )

  expect(merged).toEqual([
    { url: `${ORG_URL}/gears-frontx`, description: 'The kit' },
    { url: `${ORG_URL}/frontx-showcase`, description: undefined },
  ])
})

test('mergeTrackRepositories keeps a listed repository exactly as the file has it', () => {
  const listed = [{ url: `${ORG_URL}/gears-frontx`, description: 'From the file', issueTracker: 'https://example.com/issues' }]

  const merged = mergeTrackRepositories('Gears FrontX', listed, [
    { url: `${ORG_URL}/gears-frontx`, description: 'From GitHub', track: 'Gears FrontX' },
  ])

  expect(merged).toEqual(listed)
})

test('mergeTrackRepositories treats the same repository written differently as one', () => {
  const merged = mergeTrackRepositories(
    'Studio',
    [{ url: `${ORG_URL}/Kitsoki/` }],
    [{ url: `${ORG_URL}/kitsoki`, track: 'Studio' }],
  )

  expect(merged).toHaveLength(1)
})

test('mergeTrackRepositories ignores repositories tagged for another track', () => {
  const merged = mergeTrackRepositories('Studio', [], [{ url: `${ORG_URL}/gears-rust`, track: 'Gears Rust' }])

  expect(merged).toEqual([])
})

test('mergeTrackRepositories matches the track name regardless of case and surrounding spaces', () => {
  const merged = mergeTrackRepositories('Gears FrontX', [], [{ url: `${ORG_URL}/frontx-showcase`, track: ' gears frontx ' }])

  expect(merged.map((r) => r.url)).toEqual([`${ORG_URL}/frontx-showcase`])
})

test('mergeTrackRepositories puts listed rows first and sorts the added ones by name', () => {
  const merged = mergeTrackRepositories(
    'Studio',
    [{ url: `${ORG_URL}/zeta` }, { url: `${ORG_URL}/alpha` }],
    [
      { url: `${ORG_URL}/cyber-wiki`, track: 'Studio' },
      { url: `${ORG_URL}/Kitsoki`, track: 'Studio' },
      { url: `${ORG_URL}/cyber-codegen`, track: 'Studio' },
    ],
  )

  expect(merged.map((r) => r.url.split('/').pop())).toEqual(['zeta', 'alpha', 'cyber-codegen', 'cyber-wiki', 'Kitsoki'])
})

test('discoverTrackRepositories keeps only public, non-archived repositories with a Track value', async () => {
  stubGitHub(
    [
      repo('frontx-showcase', { description: 'Showcase app' }),
      repo('private-one', { private: true }),
      repo('old-one', { archived: true }),
      repo('untagged'),
      repo('blank-tag'),
    ],
    [
      properties('frontx-showcase', 'Gears FrontX'),
      properties('private-one', 'Studio'),
      properties('old-one', 'Studio'),
      properties('untagged', null),
      properties('blank-tag', ''),
    ],
  )

  const discovered = await discoverTrackRepositories(freshOrg())

  expect(discovered).toEqual([{ url: `${ORG_URL}/frontx-showcase`, description: 'Showcase app', track: 'Gears FrontX' }])
})

test('discoverTrackRepositories reuses one result within the TTL and refetches after it', async () => {
  vi.useFakeTimers()
  const fetchMock = stubGitHub([repo('frontx-showcase')], [properties('frontx-showcase', 'Gears FrontX')])
  const org = freshOrg()

  await discoverTrackRepositories(org)
  await discoverTrackRepositories(org)
  expect(fetchMock).toHaveBeenCalledTimes(2) // repos + property values, once

  vi.advanceTimersByTime(DISCOVERY_TTL_MS + 1)
  await discoverTrackRepositories(org)
  expect(fetchMock).toHaveBeenCalledTimes(4)
})

test('discoverTrackRepositories shares one fetch between concurrent callers', async () => {
  const fetchMock = stubGitHub([repo('frontx-showcase')], [properties('frontx-showcase', 'Gears FrontX')])
  const org = freshOrg()

  await Promise.all([discoverTrackRepositories(org), discoverTrackRepositories(org)])

  expect(fetchMock).toHaveBeenCalledTimes(2)
})

test('discoverTrackRepositories does not cache an empty result, so a failed call is retried', async () => {
  const org = freshOrg()
  vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 403 })))
  await expect(discoverTrackRepositories(org)).resolves.toEqual([])

  const fetchMock = stubGitHub([repo('frontx-showcase')], [properties('frontx-showcase', 'Gears FrontX')])
  const discovered = await discoverTrackRepositories(org)

  expect(discovered).toHaveLength(1)
  expect(fetchMock).toHaveBeenCalled()
})

test('resolveTrackRepositories returns the file list untouched without a GitHub organization', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  const listed = [{ url: `${ORG_URL}/gears-frontx` }]

  await expect(resolveTrackRepositories({ name: 'Gears FrontX', repositories: listed }, undefined)).resolves.toBe(listed)
  expect(fetchMock).not.toHaveBeenCalled()
})

test('resolveTrackRepositories falls back to the file list when GitHub is unreachable', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })))
  const listed = [{ url: `${ORG_URL}/gears-frontx` }]

  await expect(resolveTrackRepositories({ name: 'Gears FrontX', repositories: listed }, freshOrg())).resolves.toEqual(listed)
})

test('resolveTrackRepositories adds frontx-showcase to the Gears FrontX track', async () => {
  stubGitHub(
    [repo('gears-frontx'), repo('gears-frontx-templates'), repo('frontx-showcase'), repo('studio-web')],
    [
      properties('gears-frontx', 'Gears FrontX'),
      properties('gears-frontx-templates', 'Gears FrontX'),
      properties('frontx-showcase', 'Gears FrontX'),
      properties('studio-web', 'Studio'),
    ],
  )

  const resolved = await resolveTrackRepositories(
    {
      name: 'Gears FrontX',
      repositories: [
        { url: `${ORG_URL}/gears-frontx`, description: 'Cyber Ware FrontX' },
        { url: `${ORG_URL}/gears-frontx-templates` },
      ],
    },
    freshOrg(),
  )

  expect(resolved.map((r) => r.url)).toEqual([
    `${ORG_URL}/gears-frontx`,
    `${ORG_URL}/gears-frontx-templates`,
    `${ORG_URL}/frontx-showcase`,
  ])
  expect(resolved[0]?.description).toBe('Cyber Ware FrontX')
})
