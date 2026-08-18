import { afterAll, beforeEach, expect, test } from 'vitest'
import { pool } from './db.ts'
import { COMMUNITY_SCOPE, listArtifactLinks, syncArtifactLinks, type ArtifactLinkSync } from './artifact-links.ts'

function link(overrides: Partial<ArtifactLinkSync> & Pick<ArtifactLinkSync, 'scope' | 'label' | 'url'>): ArtifactLinkSync {
  return { category: 'other', ...overrides }
}

beforeEach(async () => {
  await pool.query('TRUNCATE artifact_links, tracks, contributors CASCADE')
})

afterAll(async () => {
  await pool.end()
})

test('syncs a community-scope link', async () => {
  const { synced, rejected } = await syncArtifactLinks([
    link({ scope: COMMUNITY_SCOPE, category: 'policy', label: 'Code of Conduct', url: 'https://example.com/coc' }),
  ])

  expect(synced).toBe(1)
  expect(rejected).toBe(0)

  const links = await listArtifactLinks(COMMUNITY_SCOPE)
  expect(links).toHaveLength(1)
  expect(links[0]).toMatchObject({
    scope: COMMUNITY_SCOPE,
    category: 'policy',
    label: 'Code of Conduct',
    url: 'https://example.com/coc',
  })
})

test('syncs a track-scoped link once the track exists', async () => {
  await pool.query("INSERT INTO tracks (slug, name) VALUES ('studio', 'Constructor Studio')")

  const { synced, rejected } = await syncArtifactLinks([
    link({ scope: 'studio', category: 'roadmap', label: 'Studio roadmap', url: 'https://example.com/roadmap' }),
  ])

  expect(synced).toBe(1)
  expect(rejected).toBe(0)
  expect(await listArtifactLinks('studio')).toHaveLength(1)
})

test('rejects a link whose scope names neither "community" nor a real track, without touching the rest', async () => {
  await pool.query("INSERT INTO tracks (slug, name) VALUES ('studio', 'Constructor Studio')")

  const { synced, rejected } = await syncArtifactLinks([
    link({ scope: 'not-a-real-track', label: 'Orphaned', url: 'https://example.com/orphan' }),
    link({ scope: 'studio', label: 'Real one', url: 'https://example.com/real' }),
  ])

  expect(synced).toBe(1)
  expect(rejected).toBe(1)
  expect(await listArtifactLinks('studio')).toHaveLength(1)
  expect(await listArtifactLinks('not-a-real-track')).toHaveLength(0)
})

test('every sync fully replaces the table — a link missing from the new file disappears', async () => {
  await syncArtifactLinks([link({ scope: COMMUNITY_SCOPE, label: 'First', url: 'https://example.com/1' })])
  expect(await listArtifactLinks(COMMUNITY_SCOPE)).toHaveLength(1)

  await syncArtifactLinks([link({ scope: COMMUNITY_SCOPE, label: 'Second', url: 'https://example.com/2' })])
  const links = await listArtifactLinks(COMMUNITY_SCOPE)
  expect(links).toHaveLength(1)
  expect(links[0].label).toBe('Second')
})

test('an empty sync clears every existing link', async () => {
  await syncArtifactLinks([link({ scope: COMMUNITY_SCOPE, label: 'First', url: 'https://example.com/1' })])
  await syncArtifactLinks([])
  expect(await listArtifactLinks(COMMUNITY_SCOPE)).toEqual([])
})

test('listArtifactLinks returns links in the order they were given, not alphabetically', async () => {
  await syncArtifactLinks([
    link({ scope: COMMUNITY_SCOPE, label: 'Zebra', url: 'https://example.com/z' }),
    link({ scope: COMMUNITY_SCOPE, label: 'Apple', url: 'https://example.com/a' }),
    link({ scope: COMMUNITY_SCOPE, label: 'Mango', url: 'https://example.com/m' }),
  ])

  const links = await listArtifactLinks(COMMUNITY_SCOPE)
  expect(links.map((l) => l.label)).toEqual(['Zebra', 'Apple', 'Mango'])
})

test('listArtifactLinks only returns links for the requested scope', async () => {
  await pool.query("INSERT INTO tracks (slug, name) VALUES ('studio', 'Constructor Studio')")
  await syncArtifactLinks([
    link({ scope: COMMUNITY_SCOPE, label: 'Community link', url: 'https://example.com/community' }),
    link({ scope: 'studio', label: 'Studio link', url: 'https://example.com/studio' }),
  ])

  expect(await listArtifactLinks(COMMUNITY_SCOPE)).toHaveLength(1)
  expect(await listArtifactLinks('studio')).toHaveLength(1)
  expect((await listArtifactLinks('studio'))[0].label).toBe('Studio link')
})
