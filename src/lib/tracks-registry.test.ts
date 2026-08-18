import { expect, test } from 'vitest'
import { parseTracksYaml } from './tracks-registry.ts'

test('parses a full track row', () => {
  const { tracks, invalidRowCount } = parseTracksYaml(`
tracks:
  - slug: studio
    name: Constructor Studio
    description: Structure and process organizer.
    repositories:
      - url: https://github.com/constructorfabric/studio
        description: The thing itself
        issue_tracker: https://github.com/constructorfabric/studio/issues
    leaders:
      product_manager: [octocat]
      architect: [monalisa]
    admins:
      - octocat
      - hubot
`)

  expect(invalidRowCount).toBe(0)
  expect(tracks).toEqual([
    {
      slug: 'studio',
      name: 'Constructor Studio',
      description: 'Structure and process organizer.',
      repositories: [
        {
          url: 'https://github.com/constructorfabric/studio',
          description: 'The thing itself',
          issueTracker: 'https://github.com/constructorfabric/studio/issues',
        },
      ],
      leaders: [
        { role: 'product_manager', githubLogin: 'octocat' },
        { role: 'architect', githubLogin: 'monalisa' },
      ],
      adminGithubLogins: ['octocat', 'hubot'],
    },
  ])
})

test('parses up to 3 logins per leader role', () => {
  const { tracks } = parseTracksYaml(`
tracks:
  - slug: gears
    name: Gears
    leaders:
      developer: [octocat, monalisa, hubot]
`)

  expect(tracks[0].leaders).toEqual([
    { role: 'developer', githubLogin: 'octocat' },
    { role: 'developer', githubLogin: 'monalisa' },
    { role: 'developer', githubLogin: 'hubot' },
  ])
})

test('a bare-minimum row defaults to no repositories, no leaders, no admins', () => {
  const { tracks } = parseTracksYaml('tracks:\n  - slug: studio\n    name: Constructor Studio\n')
  expect(tracks).toEqual([
    {
      slug: 'studio',
      name: 'Constructor Studio',
      description: undefined,
      repositories: [],
      leaders: [],
      adminGithubLogins: [],
    },
  ])
})

test('drops a row missing slug or name rather than throwing', () => {
  const { tracks, invalidRowCount } = parseTracksYaml(
    'tracks:\n  - name: No slug here\n  - slug: no-name\n  - slug: studio\n    name: Constructor Studio\n',
  )
  expect(invalidRowCount).toBe(2)
  expect(tracks).toEqual([expect.objectContaining({ slug: 'studio' })])
})

test('an empty or missing tracks list parses to no tracks, not an error', () => {
  expect(parseTracksYaml('tracks: []\n')).toEqual({ tracks: [], invalidRowCount: 0 })
  expect(parseTracksYaml('{}\n')).toEqual({ tracks: [], invalidRowCount: 0 })
})
