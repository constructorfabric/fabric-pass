import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, MANUAL_SOURCE_ID, PASS_SOURCE_ID, type Contributor, type Source } from '../src/core/types'
import { createMockStorage } from './helpers/mock-storage'

function contributor(login: string, name: string, extra: Partial<Contributor> = {}): Contributor {
  return { github_login: login, login_key: login.toLowerCase(), display_name: name, ...extra }
}

function sourceMeta(overrides: Partial<Omit<Source, 'id'>> & { id?: string }): Omit<Source, 'id'> & { id?: string } {
  return {
    kind: 'json',
    label: 'test-source',
    enabled: true,
    importedAt: '2024-01-01T00:00:00.000Z',
    stats: { total: 0, imported: 0, skipped: [] },
    ...overrides,
  }
}

let mock: ReturnType<typeof createMockStorage>

beforeEach(async () => {
  mock = createMockStorage()
  vi.stubGlobal('browser', mock)
  const { initializeIfNeeded } = await import('../src/core/store')
  await initializeIfNeeded()
})

describe('removeSource', () => {
  it('refuses to remove the manual layer', async () => {
    const { removeSource, listSources } = await import('../src/core/sources')

    await expect(removeSource(MANUAL_SOURCE_ID)).rejects.toThrow()
    const sources = await listSources()
    expect(sources.some((s) => s.id === MANUAL_SOURCE_ID)).toBe(true)
  })

  it('refuses to remove the pass layer', async () => {
    const { removeSource, listSources } = await import('../src/core/sources')

    await expect(removeSource(PASS_SOURCE_ID)).rejects.toThrow()
    const sources = await listSources()
    expect(sources.some((s) => s.id === PASS_SOURCE_ID)).toBe(true)
  })
})

describe('re-importing a layer never clobbers manual edits', () => {
  it('manual wins by priority, and re-importing the same yaml layer leaves manual untouched', async () => {
    const { upsertSource, getRecords } = await import('../src/core/sources')
    const { readState } = await import('../src/core/store')

    await upsertSource(
      sourceMeta({ id: MANUAL_SOURCE_ID, kind: 'manual', label: 'Manual edits' }),
      [contributor('alice', 'Alice Manual')],
    )

    const yamlSource = await upsertSource(
      sourceMeta({ kind: 'yaml', label: 'contributors.yaml' }),
      [contributor('alice', 'Alice From Registry')],
    )

    let state = await readState()
    expect(state.idx.alice).toEqual(['Alice Manual', MANUAL_SOURCE_ID])

    // Re-import the same yaml layer (same id) — manual must survive untouched.
    await upsertSource(
      sourceMeta({ id: yamlSource.id, kind: 'yaml', label: 'contributors.yaml' }),
      [contributor('alice', 'Alice From Registry')],
    )

    state = await readState()
    expect(state.idx.alice).toEqual(['Alice Manual', MANUAL_SOURCE_ID])
    expect(await getRecords(MANUAL_SOURCE_ID)).toEqual([contributor('alice', 'Alice Manual')])
  })
})

describe('upsertSource', () => {
  it('replaces an existing layer in place instead of duplicating it', async () => {
    const { upsertSource, listSources } = await import('../src/core/sources')

    const created = await upsertSource(sourceMeta({ kind: 'json', label: 'a.json' }), [
      contributor('bob', 'Bob One'),
    ])
    const beforeSources = await listSources()
    const positionBefore = beforeSources.findIndex((s) => s.id === created.id)

    await upsertSource(sourceMeta({ id: created.id, kind: 'json', label: 'a.json' }), [
      contributor('bob', 'Bob Two'),
    ])
    const afterSources = await listSources()
    const positionAfter = afterSources.findIndex((s) => s.id === created.id)

    expect(afterSources).toHaveLength(beforeSources.length)
    expect(positionAfter).toBe(positionBefore)
  })

  it('appends a layer without an id to the end of the order', async () => {
    const { upsertSource, listSources } = await import('../src/core/sources')

    const before = await listSources()
    const created = await upsertSource(sourceMeta({ kind: 'csv', label: 'mapping.csv' }), [
      contributor('carol', 'Carol'),
    ])

    const after = await listSources()
    expect(after).toHaveLength(before.length + 1)
    expect(after[after.length - 1]?.id).toBe(created.id)
  })
})

describe('setEnabled', () => {
  it('removes a disabled layer from idx but keeps its records', async () => {
    const { upsertSource, setEnabled, getRecords } = await import('../src/core/sources')
    const { readState } = await import('../src/core/store')

    const source = await upsertSource(sourceMeta({ kind: 'json', label: 'dan.json' }), [
      contributor('dan', 'Dan'),
    ])
    expect((await readState()).idx.dan).toBeDefined()

    await setEnabled(source.id, false)

    expect((await readState()).idx.dan).toBeUndefined()
    expect(await getRecords(source.id)).toEqual([contributor('dan', 'Dan')])
  })
})

describe('reorder', () => {
  it('changes the winner when priority order changes', async () => {
    const { upsertSource, reorder, listSources } = await import('../src/core/sources')
    const { readState } = await import('../src/core/store')

    const yamlSource = await upsertSource(sourceMeta({ kind: 'yaml', label: 'contributors.yaml' }), [
      contributor('erin', 'Erin From Yaml'),
    ])
    await upsertSource(
      sourceMeta({ id: MANUAL_SOURCE_ID, kind: 'manual', label: 'Manual edits' }),
      [contributor('erin', 'Erin Manual')],
    )

    expect((await readState()).idx.erin).toEqual(['Erin Manual', MANUAL_SOURCE_ID])

    const ids = (await listSources()).map((s) => s.id)
    const reordered = [...ids.filter((id) => id !== MANUAL_SOURCE_ID), MANUAL_SOURCE_ID]
    await reorder(reordered)

    expect((await readState()).idx.erin).toEqual(['Erin From Yaml', yamlSource.id])
  })

  it('throws when the id set does not match the current layers', async () => {
    const { reorder, listSources } = await import('../src/core/sources')
    const ids = (await listSources()).map((s) => s.id)

    await expect(reorder([...ids, 'not-a-real-id'])).rejects.toThrow()
    await expect(reorder(ids.slice(0, -1))).rejects.toThrow()
  })
})

describe('explain', () => {
  it('is case-insensitive and reports winner/losers/disabled', async () => {
    const { upsertSource, setEnabled, explain } = await import('../src/core/sources')

    const yamlSource = await upsertSource(sourceMeta({ kind: 'yaml', label: 'contributors.yaml' }), [
      contributor('frank', 'Frank From Yaml'),
    ])
    const jsonSource = await upsertSource(sourceMeta({ kind: 'json', label: 'frank.json' }), [
      contributor('frank', 'Frank From Json'),
    ])
    await upsertSource(
      sourceMeta({ id: MANUAL_SOURCE_ID, kind: 'manual', label: 'Manual edits' }),
      [contributor('frank', 'Frank Manual')],
    )
    await setEnabled(jsonSource.id, false)

    const explanation = await explain('FRANK')

    expect(explanation.login_key).toBe('frank')
    expect(explanation.winner?.sourceId).toBe(MANUAL_SOURCE_ID)
    expect(explanation.winner?.contributor.display_name).toBe('Frank Manual')
    expect(explanation.losers).toEqual([
      { sourceId: yamlSource.id, sourceLabel: 'contributors.yaml', contributor: contributor('frank', 'Frank From Yaml') },
    ])
    expect(explanation.disabled).toEqual([
      { sourceId: jsonSource.id, sourceLabel: 'frank.json', contributor: contributor('frank', 'Frank From Json') },
    ])
  })

  it('a layer with is_agent cannot be the winner, even if it has higher priority (code review defect 4)', async () => {
    const { upsertSource, explain } = await import('../src/core/sources')

    const dependabotSource = await upsertSource(sourceMeta({ kind: 'json', label: 'dependabot' }), [
      contributor('bot-account', 'dependabot[bot]', { is_agent: true }),
    ])
    const yamlSource = await upsertSource(sourceMeta({ kind: 'yaml', label: 'contributors.yaml' }), [
      contributor('bot-account', 'Real Human Name'),
    ])

    const explanation = await explain('bot-account')

    expect(explanation.winner?.sourceId).toBe(yamlSource.id)
    expect(explanation.winner?.contributor.display_name).toBe('Real Human Name')
    expect(explanation.filteredByPreference).toEqual([
      {
        sourceId: dependabotSource.id,
        sourceLabel: 'dependabot',
        contributor: contributor('bot-account', 'dependabot[bot]', { is_agent: true }),
      },
    ])
    expect(explanation.losers).toEqual([])
  })
})

describe('mergeIntoIndex performance', () => {
  it('merges 10 000 + 100 records in under 300ms', async () => {
    const { mergeIntoIndex } = await import('../src/core/sources')

    const bulk: Contributor[] = Array.from({ length: 10_000 }, (_, i) =>
      contributor(`user${i}`, `User ${i}`),
    )
    const manual: Contributor[] = Array.from({ length: 100 }, (_, i) =>
      contributor(`manual${i}`, `Manual ${i}`),
    )

    const sources: Source[] = [
      { ...sourceMeta({ kind: 'manual', label: 'Manual edits' }), id: MANUAL_SOURCE_ID } as Source,
      { ...sourceMeta({ kind: 'yaml', label: 'contributors.yaml' }), id: 'bulk' } as Source,
    ]
    const records = { [MANUAL_SOURCE_ID]: manual, bulk }

    const start = performance.now()
    const idx = mergeIntoIndex(sources, records, DEFAULT_SETTINGS)
    const elapsed = performance.now() - start

    expect(Object.keys(idx)).toHaveLength(10_100)
    expect(elapsed).toBeLessThan(300)
  })
})

describe('mergeIntoIndex — preference filters (T12)', () => {
  it('is_agent: true never ends up in idx, regardless of settings', async () => {
    const { mergeIntoIndex } = await import('../src/core/sources')
    const sources: Source[] = [{ ...sourceMeta({ kind: 'yaml', label: 'bots.yaml' }), id: 'bots' } as Source]
    const records = { bots: [contributor('botuser', 'Some Bot', { is_agent: true })] }

    expect(mergeIntoIndex(sources, records, { ...DEFAULT_SETTINGS, showDraft: false }).botuser).toBeUndefined()
    expect(mergeIntoIndex(sources, records, { ...DEFAULT_SETTINGS, showDraft: true }).botuser).toBeUndefined()
  })

  it('status: draft obeys settings.showDraft', async () => {
    const { mergeIntoIndex } = await import('../src/core/sources')
    const sources: Source[] = [{ ...sourceMeta({ kind: 'yaml', label: 'contributors.yaml' }), id: 'yaml' } as Source]
    const records = { yaml: [contributor('draftuser', 'Draft Person', { status: 'draft' })] }

    expect(mergeIntoIndex(sources, records, { ...DEFAULT_SETTINGS, showDraft: false }).draftuser).toBeUndefined()
    expect(mergeIntoIndex(sources, records, { ...DEFAULT_SETTINGS, showDraft: true }).draftuser).toEqual([
      'Draft Person',
      'yaml',
    ])
  })
})

describe('rebuildIndex — showDraft toggles without reimporting the layer (T12)', () => {
  it('a record with status: draft appears and disappears from idx via rebuildIndex() alone', async () => {
    const { upsertSource, rebuildIndex } = await import('../src/core/sources')
    const { readState, writeState } = await import('../src/core/store')

    await upsertSource(
      sourceMeta({ kind: 'yaml', label: 'contributors.yaml' }),
      [contributor('draftuser', 'Draft Person', { status: 'draft' })],
    )

    let state = await readState()
    expect(state.settings.showDraft).toBe(false)
    expect(state.idx.draftuser).toBeUndefined()

    await writeState({ settings: { ...state.settings, showDraft: true } })
    await rebuildIndex()
    state = await readState()
    expect(state.idx.draftuser).toBeDefined()

    await writeState({ settings: { ...state.settings, showDraft: false } })
    await rebuildIndex()
    state = await readState()
    expect(state.idx.draftuser).toBeUndefined()
  })
})
