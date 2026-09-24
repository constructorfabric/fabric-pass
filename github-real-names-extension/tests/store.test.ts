import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PASS_META,
  DEFAULT_SETTINGS,
  MANUAL_SOURCE_ID,
  PASS_SOURCE_ID,
  SCHEMA_VERSION,
  type Contributor,
  type PersistedState,
  type Settings,
  type Source,
  type StoredState,
} from '../src/core/types'
import { createMockStorage } from './helpers/mock-storage'

let mock: ReturnType<typeof createMockStorage>

function contributor(login: string, name: string): Contributor {
  return { github_login: login, login_key: login.toLowerCase(), display_name: name }
}

beforeEach(() => {
  mock = createMockStorage()
  vi.stubGlobal('browser', mock)
})

describe('initializeIfNeeded', () => {
  it('creates the manual layer and default settings on empty storage', async () => {
    const { initializeIfNeeded } = await import('../src/core/store')
    await initializeIfNeeded()

    const dump = mock._dump() as Partial<PersistedState>
    expect(dump.schemaVersion).toBe(SCHEMA_VERSION)
    expect(dump.settings).toEqual(DEFAULT_SETTINGS)
    expect(dump.sources).toHaveLength(2)
    expect(dump.sources?.[0]).toMatchObject({
      id: MANUAL_SOURCE_ID,
      kind: 'manual',
      enabled: true,
      rawText: '',
      stats: { total: 0, imported: 0, skipped: [] },
    })
    expect(dump.sources?.[1]).toMatchObject({
      id: PASS_SOURCE_ID,
      kind: 'pass',
      enabled: true,
      stats: { total: 0, imported: 0, skipped: [] },
    })
    expect(dump.records).toEqual({ [MANUAL_SOURCE_ID]: [], [PASS_SOURCE_ID]: [] })
    expect(dump.idx).toEqual({})
    expect(dump.passCache).toEqual({})
    expect(dump.passMeta).toEqual(DEFAULT_PASS_META)
  })

  it('does nothing on a second call', async () => {
    const { initializeIfNeeded } = await import('../src/core/store')
    await initializeIfNeeded()
    const afterFirst = mock._dump()

    await initializeIfNeeded()
    const afterSecond = mock._dump()

    expect(afterSecond).toEqual(afterFirst)
  })

  it('migrates an existing schema-1 state and writes the migrated schema-2 state back (regression guard: migrate() must actually run)', async () => {
    const legacyBuiltinSource = {
      id: 'builtin-cf-internal',
      kind: 'builtin',
      label: 'Built-in source (cf-internal)',
      enabled: true,
      importedAt: '2024-01-01T00:00:00.000Z',
      stats: { total: 1, imported: 1, skipped: [] },
    } as unknown as Source
    const manualSource: Source = {
      id: MANUAL_SOURCE_ID,
      kind: 'manual',
      label: 'Manual edits',
      enabled: true,
      importedAt: '2024-01-01T00:00:00.000Z',
      rawText: '',
      stats: { total: 0, imported: 0, skipped: [] },
    }

    await mock.storage.local.set({
      schemaVersion: 1,
      settings: DEFAULT_SETTINGS,
      sources: [manualSource, legacyBuiltinSource],
      records: { [MANUAL_SOURCE_ID]: [], 'builtin-cf-internal': [contributor('bob', 'Bob From Builtin')] },
      idx: { bob: ['Bob From Builtin', 'builtin-cf-internal'] },
    })

    const { initializeIfNeeded } = await import('../src/core/store')
    await initializeIfNeeded()

    const dump = mock._dump() as Partial<PersistedState>
    expect(dump.schemaVersion).toBe(SCHEMA_VERSION)
    expect(dump.sources?.some((s) => s.id === 'builtin-cf-internal')).toBe(false)
    expect(dump.sources?.some((s) => s.id === PASS_SOURCE_ID)).toBe(true)
    expect(dump.records?.['builtin-cf-internal']).toBeUndefined()
    expect(dump.passCache).toEqual({})
    expect(dump.passMeta).toEqual(DEFAULT_PASS_META)
  })

  it('does nothing (no storage write) when already at the current schema version', async () => {
    const { initializeIfNeeded } = await import('../src/core/store')
    await initializeIfNeeded()
    mock.storage.local.set.mockClear()

    await initializeIfNeeded()

    expect(mock.storage.local.set).not.toHaveBeenCalled()
  })
})

describe('readState / writeState', () => {
  it('round-trips a patch through writeState/readState', async () => {
    const { initializeIfNeeded, readState, writeState } = await import('../src/core/store')
    await initializeIfNeeded()

    await writeState({ settings: { ...DEFAULT_SETTINGS, showDraft: true } })
    const state = await readState()

    expect(state.settings.showDraft).toBe(true)
  })

  it('self-heals the missing manual and pass layers on empty storage (code review defect 1)', async () => {
    const { readState } = await import('../src/core/store')

    const state = await readState()

    expect(state.sources).toHaveLength(2)
    expect(state.sources[0]).toMatchObject({ id: MANUAL_SOURCE_ID, kind: 'manual', enabled: true })
    expect(state.sources[1]).toMatchObject({ id: PASS_SOURCE_ID, kind: 'pass', enabled: true })
  })

  it('prepends the manual layer and appends the pass layer when both are missing, without losing existing layers', async () => {
    const { writeState, readState } = await import('../src/core/store')
    const otherSource: StoredState['sources'][number] = {
      id: 'yaml-1',
      kind: 'yaml',
      label: 'contributors.yaml',
      enabled: true,
      importedAt: '2024-01-01T00:00:00.000Z',
      stats: { total: 0, imported: 0, skipped: [] },
    }
    await writeState({ schemaVersion: SCHEMA_VERSION, sources: [otherSource] })

    const state = await readState()

    expect(state.sources).toHaveLength(3)
    expect(state.sources[0]).toMatchObject({ id: MANUAL_SOURCE_ID })
    expect(state.sources[1]).toEqual(otherSource)
    expect(state.sources[2]).toMatchObject({ id: PASS_SOURCE_ID })
  })

  it('does not write the self-healed manual layer to storage', async () => {
    const { readState } = await import('../src/core/store')
    await readState()

    const dump = mock._dump() as Partial<StoredState>
    expect(dump.sources).toBeUndefined()
  })
})

describe('readIdx', () => {
  it('reads exactly one key and does not touch records', async () => {
    const { initializeIfNeeded, readIdx } = await import('../src/core/store')
    await initializeIfNeeded()
    mock.storage.local.get.mockClear()

    const idx = await readIdx()

    expect(idx).toEqual({})
    expect(mock.storage.local.get).toHaveBeenCalledTimes(1)
    expect(mock.storage.local.get).toHaveBeenCalledWith('idx')
  })
})

describe('readSettings', () => {
  it('returns defaults when nothing was stored yet', async () => {
    const { readSettings } = await import('../src/core/store')
    const settings = await readSettings()
    expect(settings).toEqual(DEFAULT_SETTINGS)
  })

  it('a stored displayFormat: "dot" (removed in this version) falls back to the default ("parens")', async () => {
    const { readSettings } = await import('../src/core/store')
    await mock.storage.local.set({
      settings: { ...DEFAULT_SETTINGS, displayFormat: 'dot' } as unknown as Settings,
    })

    const settings = await readSettings()

    expect(settings.displayFormat).toBe('parens')
  })
})

describe('readPassCache / writePassCache / readPassMeta / writePassMeta', () => {
  it('round-trips the pass cache and falls back to an empty object', async () => {
    const { readPassCache, writePassCache } = await import('../src/core/store')

    expect(await readPassCache()).toEqual({})

    await writePassCache({ alice: { name: 'Alice Smith', fetchedAt: '2026-01-01T00:00:00.000Z' } })
    expect(await readPassCache()).toEqual({ alice: { name: 'Alice Smith', fetchedAt: '2026-01-01T00:00:00.000Z' } })
  })

  it('round-trips the pass meta and falls back to DEFAULT_PASS_META', async () => {
    const { readPassMeta, writePassMeta } = await import('../src/core/store')

    expect(await readPassMeta()).toEqual(DEFAULT_PASS_META)

    await writePassMeta({ lastStatus: 'ok', lastAuthOkAt: '2026-01-01T00:00:00.000Z' })
    expect(await readPassMeta()).toEqual({ lastStatus: 'ok', lastAuthOkAt: '2026-01-01T00:00:00.000Z' })
  })

  it('readState does not read the pass cache keys', async () => {
    const { initializeIfNeeded, writePassCache, readState } = await import('../src/core/store')
    await initializeIfNeeded()
    await writePassCache({ alice: { name: 'Alice Smith', fetchedAt: '2026-01-01T00:00:00.000Z' } })
    mock.storage.local.get.mockClear()

    await readState()

    const readKeys = mock.storage.local.get.mock.calls.flatMap((call) => call[0] as string[])
    expect(readKeys).not.toContain('passCache')
    expect(readKeys).not.toContain('passMeta')
  })
})

describe('onStateChanged', () => {
  it('notifies with the changed keys and can be unsubscribed', async () => {
    const { initializeIfNeeded, writeState, onStateChanged } = await import('../src/core/store')
    await initializeIfNeeded()

    const cb = vi.fn()
    const unsubscribe = onStateChanged(cb)

    await writeState({ idx: { alice: ['Alice', MANUAL_SOURCE_ID] } })
    expect(cb).toHaveBeenCalledWith(['idx'])

    unsubscribe()
    cb.mockClear()
    await writeState({ idx: {} })
    expect(cb).not.toHaveBeenCalled()
  })
})

describe('migrate', () => {
  it('assigns the current schema version to a state without one (treated as version 0, so the 1→2 migration also runs)', async () => {
    const { migrate } = await import('../src/core/store')
    const input: Partial<PersistedState> = {
      settings: DEFAULT_SETTINGS,
      sources: [],
      records: { foo: [] },
      idx: {},
    }

    const migrated = await migrate(input)

    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION)
    expect(migrated.records.foo).toEqual([])
    expect(migrated.records[PASS_SOURCE_ID]).toEqual([])
    expect(migrated.settings).toEqual(DEFAULT_SETTINGS)
    expect(migrated.passCache).toEqual({})
    expect(migrated.passMeta).toEqual(DEFAULT_PASS_META)
  })

  it('does not clobber a state from a future schema version', async () => {
    const { migrate } = await import('../src/core/store')
    const futureState: Partial<PersistedState> = {
      schemaVersion: SCHEMA_VERSION + 1,
      settings: DEFAULT_SETTINGS,
      sources: [],
      records: { foo: [{ github_login: 'x', login_key: 'x', display_name: 'X' }] },
      idx: {},
    }

    const result = await migrate(futureState)

    expect(result.schemaVersion).toBe(SCHEMA_VERSION + 1)
    expect(result.records).toEqual(futureState.records)
  })

  it('1→2: drops the legacy built-in layer and its records, inserts an empty pass layer in its old slot, and leaves manual edits and an imported layer (and their idx entries) untouched', async () => {
    const { migrate } = await import('../src/core/store')

    const manualSource: Source = {
      id: MANUAL_SOURCE_ID,
      kind: 'manual',
      label: 'Manual edits',
      enabled: true,
      importedAt: '2024-01-01T00:00:00.000Z',
      rawText: '',
      stats: { total: 1, imported: 1, skipped: [] },
    }
    const legacyBuiltinSource = {
      id: 'builtin-cf-internal',
      kind: 'builtin',
      label: 'Built-in source (cf-internal)',
      enabled: true,
      importedAt: '2024-01-01T00:00:00.000Z',
      stats: { total: 1, imported: 1, skipped: [] },
    } as unknown as Source
    const importedSource: Source = {
      id: 'yaml-1',
      kind: 'yaml',
      label: 'contributors.yaml',
      enabled: true,
      importedAt: '2024-01-01T00:00:00.000Z',
      stats: { total: 1, imported: 1, skipped: [] },
    }

    const input: Partial<PersistedState> = {
      schemaVersion: 1,
      settings: DEFAULT_SETTINGS,
      sources: [manualSource, legacyBuiltinSource, importedSource],
      records: {
        [MANUAL_SOURCE_ID]: [contributor('alice', 'Alice Manual')],
        'builtin-cf-internal': [contributor('bob', 'Bob From Builtin')],
        [importedSource.id]: [contributor('carol', 'Carol From Import')],
      },
      idx: {
        alice: ['Alice Manual', MANUAL_SOURCE_ID],
        bob: ['Bob From Builtin', 'builtin-cf-internal'],
        carol: ['Carol From Import', importedSource.id],
      },
    }

    const migrated = await migrate(input)

    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION)
    // The pass layer replaces the legacy layer's slot — priority order is preserved.
    expect(migrated.sources.map((s) => s.id)).toEqual([MANUAL_SOURCE_ID, PASS_SOURCE_ID, importedSource.id])
    expect(migrated.sources[1]).toMatchObject({ id: PASS_SOURCE_ID, kind: 'pass', enabled: true })

    expect(migrated.records['builtin-cf-internal']).toBeUndefined()
    expect(migrated.records[PASS_SOURCE_ID]).toEqual([])
    expect(migrated.records[MANUAL_SOURCE_ID]).toEqual([contributor('alice', 'Alice Manual')])
    expect(migrated.records[importedSource.id]).toEqual([contributor('carol', 'Carol From Import')])

    expect(migrated.idx.alice).toEqual(['Alice Manual', MANUAL_SOURCE_ID])
    expect(migrated.idx.carol).toEqual(['Carol From Import', importedSource.id])
    expect(migrated.idx.bob).toBeUndefined()

    expect(migrated.passCache).toEqual({})
    expect(migrated.passMeta).toEqual(DEFAULT_PASS_META)
  })

  it('1→2: appends the pass layer at the end when there was no legacy built-in layer to replace', async () => {
    const { migrate } = await import('../src/core/store')

    const manualSource: Source = {
      id: MANUAL_SOURCE_ID,
      kind: 'manual',
      label: 'Manual edits',
      enabled: true,
      importedAt: '2024-01-01T00:00:00.000Z',
      rawText: '',
      stats: { total: 0, imported: 0, skipped: [] },
    }

    const migrated = await migrate({
      schemaVersion: 1,
      settings: DEFAULT_SETTINGS,
      sources: [manualSource],
      records: { [MANUAL_SOURCE_ID]: [] },
      idx: {},
    })

    expect(migrated.sources.map((s) => s.id)).toEqual([MANUAL_SOURCE_ID, PASS_SOURCE_ID])
  })

  it('2→3: re-projects the pass layer from the cache, restoring a name the old projection dropped (IDEA-155)', async () => {
    const { migrate } = await import('../src/core/store')

    const passSource: Source = {
      id: PASS_SOURCE_ID,
      kind: 'pass',
      label: 'Fabric Pass',
      enabled: true,
      importedAt: '2024-01-01T00:00:00.000Z',
      stats: { total: 1, imported: 0, skipped: [{ index: 0, login: 'sanjeevsolanki', reason: 'name_equals_login' }] },
    }
    const passCache = { sanjeevsolanki: { name: 'Sanjeev SOLANKI', fetchedAt: '2026-01-01T00:00:00.000Z' } }

    const migrated = await migrate({
      schemaVersion: 2,
      settings: DEFAULT_SETTINGS,
      sources: [passSource],
      records: { [PASS_SOURCE_ID]: [] },
      idx: {},
      passCache,
    })

    expect(migrated.records[PASS_SOURCE_ID]).toEqual([contributor('sanjeevsolanki', 'Sanjeev SOLANKI')])
    expect(migrated.idx.sanjeevsolanki).toEqual(['Sanjeev SOLANKI', PASS_SOURCE_ID])
    expect(migrated.sources[0]?.stats).toEqual({ total: 1, imported: 1, skipped: [] })
    // Nothing is re-fetched: the names were in the cache all along, only the projection was wrong.
    expect(migrated.passCache).toEqual(passCache)
  })

  it('2→3: a state with no pass layer is left alone', async () => {
    const { migrate } = await import('../src/core/store')
    const manualSource: Source = {
      id: MANUAL_SOURCE_ID,
      kind: 'manual',
      label: 'Manual edits',
      enabled: true,
      importedAt: '2024-01-01T00:00:00.000Z',
      rawText: '',
      stats: { total: 0, imported: 0, skipped: [] },
    }

    const migrated = await migrate({
      schemaVersion: 2,
      settings: DEFAULT_SETTINGS,
      sources: [manualSource],
      records: { [MANUAL_SOURCE_ID]: [contributor('alice', 'Alice Manual')] },
      idx: { alice: ['Alice Manual', MANUAL_SOURCE_ID] },
    })

    expect(migrated.sources.map((s) => s.id)).toEqual([MANUAL_SOURCE_ID])
    expect(migrated.records[PASS_SOURCE_ID]).toBeUndefined()
    expect(migrated.idx.alice).toEqual(['Alice Manual', MANUAL_SOURCE_ID])
  })
})
