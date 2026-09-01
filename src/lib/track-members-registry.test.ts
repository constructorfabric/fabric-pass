import { expect, test } from 'vitest'
import { toTrackMembersYaml } from './track-members-registry.ts'

test('renders every membership as a YAML row', () => {
  const yaml = toTrackMembersYaml([
    {
      trackSlug: 'studio',
      githubLogin: 'octocat',
      role: 'maintainer',
      decidedAt: new Date('2026-08-01T12:00:00.000Z'),
      capacityRatio: 0.5,
    },
  ])

  expect(yaml).toContain('track: studio')
  expect(yaml).toContain('github_login: octocat')
  expect(yaml).toContain('role: maintainer')
  expect(yaml).toContain('decided_at: 2026-08-01T12:00:00.000Z')
  expect(yaml).toContain('capacity: 0.5')
})

test('a config-assigned admin with no decided_at renders as null, not omitted', () => {
  const yaml = toTrackMembersYaml([{ trackSlug: 'governance', githubLogin: 'octocat', role: 'contributor', capacityRatio: 1 }])

  expect(yaml).toContain('decided_at: null')
})

test('the default capacity (1) renders explicitly, not omitted', () => {
  const yaml = toTrackMembersYaml([{ trackSlug: 'governance', githubLogin: 'octocat', role: 'contributor', capacityRatio: 1 }])

  expect(yaml).toContain('capacity: 1')
})

test('an empty list renders as an empty track_members array', () => {
  expect(toTrackMembersYaml([])).toBe('track_members: []\n')
})
