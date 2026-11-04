import { expect, test } from 'vitest'
import { parseArtifactLinksYaml } from './artifact-links-registry.ts'

test('parses a full artifact link row', () => {
  const { links, invalidRowCount } = parseArtifactLinksYaml(`
artifact_links:
  - scope: community
    category: policy
    label: Code of Conduct
    url: https://github.com/constructorfabric/governance/blob/main/CODE_OF_CONDUCT.md
`)

  expect(invalidRowCount).toBe(0)
  expect(links).toEqual([
    {
      scope: 'community',
      category: 'policy',
      label: 'Code of Conduct',
      url: 'https://github.com/constructorfabric/governance/blob/main/CODE_OF_CONDUCT.md',
    },
  ])
})

test('drops a row missing scope, category, label, or url rather than throwing', () => {
  const { links, invalidRowCount } = parseArtifactLinksYaml(`
artifact_links:
  - category: policy
    label: No scope here
    url: https://example.com/1
  - scope: community
    label: No category here
    url: https://example.com/2
  - scope: community
    category: policy
    url: https://example.com/3
  - scope: community
    category: policy
    label: No url here
  - scope: community
    category: policy
    label: Valid row
    url: https://example.com/5
`)

  expect(invalidRowCount).toBe(4)
  expect(links).toEqual([
    { scope: 'community', category: 'policy', label: 'Valid row', url: 'https://example.com/5' },
  ])
})

test('drops a row whose category is outside the known set', () => {
  const { links, invalidRowCount } = parseArtifactLinksYaml(
    'artifact_links:\n  - scope: community\n    category: not-a-real-category\n    label: Bad category\n    url: https://example.com\n',
  )
  expect(invalidRowCount).toBe(1)
  expect(links).toEqual([])
})

test('an empty or missing artifact_links list parses to no links, not an error', () => {
  const empty = { links: [], invalidRowCount: 0, events: [], invalidEventCount: 0 }
  expect(parseArtifactLinksYaml('artifact_links: []\n')).toEqual(empty)
  expect(parseArtifactLinksYaml('{}\n')).toEqual(empty)
})

test('IDEA-165 — parses an event, quoted or bare dates alike, recordings in file order', () => {
  const { events, invalidEventCount } = parseArtifactLinksYaml(`
events:
  - title: "Workshop #2"
    starts_on: 2026-10-16
    ends_on: "2026-10-21"
    place: Sofia
    agenda_url: https://example.com/agenda
    recordings:
      - label: 16 Oct
        url: https://example.com/rec/1?pwd=abc
      - label: 17 Oct · Part 1
        url: https://example.com/rec/2
`)

  expect(invalidEventCount).toBe(0)
  expect(events).toEqual([
    {
      title: 'Workshop #2',
      startsOn: '2026-10-16',
      endsOn: '2026-10-21',
      place: 'Sofia',
      agendaUrl: 'https://example.com/agenda',
      recordings: [
        { label: '16 Oct', url: 'https://example.com/rec/1?pwd=abc' },
        { label: '17 Oct · Part 1', url: 'https://example.com/rec/2' },
      ],
    },
  ])
})

test('IDEA-165 — place, agenda and recordings are optional', () => {
  const { events } = parseArtifactLinksYaml('events:\n  - title: Meetup\n    starts_on: 2026-12-01\n    ends_on: 2026-12-01\n')
  expect(events).toEqual([{ title: 'Meetup', startsOn: '2026-12-01', endsOn: '2026-12-01', recordings: [] }])
})

test('IDEA-165 — drops a whole event with any bad field, keeping the rest and the links', () => {
  const { links, events, invalidEventCount } = parseArtifactLinksYaml(`
artifact_links:
  - scope: community
    category: policy
    label: Still synced
    url: https://example.com/policy
events:
  - starts_on: 2026-10-16
    ends_on: 2026-10-21
  - title: Impossible day
    starts_on: 2026-02-30
    ends_on: 2026-03-01
  - title: Ends before it starts
    starts_on: 2026-10-21
    ends_on: 2026-10-16
  - title: Script agenda
    starts_on: 2026-10-16
    ends_on: 2026-10-16
    agenda_url: javascript:alert(1)
  - title: Recording without url
    starts_on: 2026-10-16
    ends_on: 2026-10-16
    recordings:
      - label: 16 Oct
  - title: Good one
    starts_on: 2026-10-16
    ends_on: 2026-10-16
`)

  expect(links).toHaveLength(1)
  expect(invalidEventCount).toBe(5)
  expect(events.map((event) => event.title)).toEqual(['Good one'])
})
