import { afterAll, beforeEach, expect, test } from 'vitest'
import { pool } from './db.ts'
import { getTrackPageTemplate, renderTrackPage, syncTrackPageTemplate } from './track-page-template.ts'

beforeEach(async () => {
  await pool.query('TRUNCATE track_page_template')
})

afterAll(async () => {
  await pool.end()
})

test('getTrackPageTemplate returns null before anything has ever synced', async () => {
  expect(await getTrackPageTemplate()).toBeNull()
})

test('syncTrackPageTemplate stores the content, readable back by getTrackPageTemplate', async () => {
  await syncTrackPageTemplate('# {{name}}\n\n{{description}}\n')
  expect(await getTrackPageTemplate()).toBe('# {{name}}\n\n{{description}}\n')
})

test('re-syncing replaces the one row rather than adding a second', async () => {
  await syncTrackPageTemplate('first version')
  await syncTrackPageTemplate('second version')

  expect(await getTrackPageTemplate()).toBe('second version')
  const { rows } = await pool.query('SELECT count(*)::int AS count FROM track_page_template')
  expect(rows[0].count).toBe(1)
})

test('renderTrackPage substitutes flat fields and renders markdown to HTML', () => {
  const html = renderTrackPage('## {{name}}\n\n{{description}}\n', {
    name: 'Studio',
    description: 'Structure and process organizer.',
    leaders: [],
    repositories: [],
    artifactLinks: [],
  })

  expect(html).toContain('<h2>Studio</h2>')
  expect(html).toContain('<p>Structure and process organizer.</p>')
})

test('renderTrackPage renders leaders as a bulleted list with their role', () => {
  const html = renderTrackPage('{{leaders}}', {
    name: 'Studio',
    leaders: [
      { role: 'Product Manager', name: 'Ada Lovelace' },
      { role: 'Architect', name: 'Grace Hopper' },
    ],
    repositories: [],
    artifactLinks: [],
  })

  expect(html).toContain('<strong>Product Manager:</strong> Ada Lovelace')
  expect(html).toContain('<strong>Architect:</strong> Grace Hopper')
})

test('renderTrackPage links a leader with a profileUrl to their public profile', () => {
  const html = renderTrackPage('{{leaders}}', {
    name: 'Studio',
    leaders: [{ role: 'Product Manager', name: '@octocat', profileUrl: '/contributors/abc123' }],
    repositories: [],
    artifactLinks: [],
  })

  expect(html).toContain('<strong>Product Manager:</strong>')
  expect(html).toContain('href="/contributors/abc123"')
  expect(html).toContain('@octocat')
})

test('renderTrackPage falls back to a plain message when a list is empty', () => {
  const html = renderTrackPage('{{leaders}}\n\n{{repositories}}\n\n{{artifact_links}}', {
    name: 'Studio',
    leaders: [],
    repositories: [],
    artifactLinks: [],
  })

  expect(html).toContain('No leaders assigned yet')
  expect(html).toContain('No repositories listed yet')
  expect(html).toContain('No links yet')
})

test('renderTrackPage renders repositories with a description as the link text, and links out to the issue tracker separately', () => {
  const html = renderTrackPage('{{repositories}}', {
    name: 'Studio',
    leaders: [],
    repositories: [
      {
        url: 'https://github.com/constructorfabric/studio',
        description: 'Main repository',
        issueTracker: 'https://github.com/constructorfabric/studio/issues',
      },
    ],
    artifactLinks: [],
  })

  expect(html).toContain('href="https://github.com/constructorfabric/studio"')
  expect(html).toContain('Main repository')
  expect(html).toContain('href="https://github.com/constructorfabric/studio/issues"')
})

test('renderTrackPage renders a repository with no description using its URL as the link text', () => {
  const html = renderTrackPage('{{repositories}}', {
    name: 'Studio',
    leaders: [],
    repositories: [{ url: 'https://github.com/constructorfabric/studio' }],
    artifactLinks: [],
  })

  expect(html).toContain('href="https://github.com/constructorfabric/studio"')
})

test('renderTrackPage groups artifact links into one subsection per category', () => {
  const html = renderTrackPage('{{artifact_links}}', {
    name: 'Studio',
    leaders: [],
    repositories: [],
    artifactLinks: [
      {
        id: '1',
        scope: 'studio',
        category: 'roadmap',
        label: 'Studio roadmap',
        url: 'https://example.com/roadmap',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: '2',
        scope: 'studio',
        category: 'vision',
        label: 'Studio vision',
        url: 'https://example.com/vision',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  })

  expect(html).toContain('<h3>Vision</h3>')
  expect(html).toContain('<h3>Roadmap</h3>')
  expect(html).toContain('href="https://example.com/roadmap"')
  expect(html).toContain('Studio roadmap')
  expect(html).toContain('href="https://example.com/vision"')
  expect(html).toContain('Studio vision')
  // Vision precedes Roadmap — ARTIFACT_LINK_CATEGORIES' fixed order, not
  // the order the links were passed in.
  expect(html.indexOf('<h3>Vision</h3>')).toBeLessThan(html.indexOf('<h3>Roadmap</h3>'))
})

test('renderTrackPage only shows a subsection for a category that actually has a link', () => {
  const html = renderTrackPage('{{artifact_links}}', {
    name: 'Studio',
    leaders: [],
    repositories: [],
    artifactLinks: [
      {
        id: '1',
        scope: 'studio',
        category: 'guide',
        label: 'Studio docs',
        url: 'https://example.com/docs',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  })

  expect(html).toContain('<h3>Documentation</h3>')
  expect(html).not.toContain('<h3>Vision</h3>')
  expect(html).not.toContain('<h3>Roadmap</h3>')
})

test('renderTrackPage never lets an unescaped value break out of the markdown structure', () => {
  const html = renderTrackPage('# {{name}}', {
    name: '<script>alert(1)</script>',
    leaders: [],
    repositories: [],
    artifactLinks: [],
  })

  expect(html).not.toContain('<script>')
})
