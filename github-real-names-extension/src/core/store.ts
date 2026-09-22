/**
 * Thin wrapper over `browser.storage.local`.
 *
 * Storage is split into separate top-level keys (`STORAGE_KEYS`) rather than one
 * object — deliberately, so the content script can read only `idx` and `settings`,
 * without pulling out all layers' records on every GitHub page (see `readIdx`).
 */

import { t } from './i18n'
import { mergeIntoIndex } from './merge'
import {
  DEFAULT_PASS_META,
  DEFAULT_SETTINGS,
  MANUAL_SOURCE_ID,
  PASS_SOURCE_ID,
  SCHEMA_VERSION,
  STORAGE_KEYS,
  type DisplayFormat,
  type MergedIndex,
  type PassCache,
  type PassMeta,
  type PersistedState,
  type Settings,
  type Source,
  type StoredState,
} from './types'

/**
 * Valid `DisplayFormat` values, kept in sync with the type by hand — there is no way to
 * derive a runtime array from a union type. Used only by `sanitizeSettings` below.
 */
const VALID_DISPLAY_FORMATS: readonly DisplayFormat[] = ['parens', 'brackets', 'brackets-reversed']

/**
 * Falls back to `DEFAULT_SETTINGS.displayFormat` for any value that isn't one of the
 * current `DisplayFormat` members — in particular the dot-separator format that this
 * version removed, which an install from before this version may still have saved.
 * Without this, such a stored settings object would reach a `switch (f)` in
 * `format.ts`/`decorate.ts` that has no case for it at all. Called from both
 * `readSettings()` and `withDefaults()` so every path that produces a `Settings` object
 * goes through the same guard.
 */
function sanitizeSettings(settings: Settings): Settings {
  if (VALID_DISPLAY_FORMATS.includes(settings.displayFormat)) return settings
  return { ...settings, displayFormat: DEFAULT_SETTINGS.displayFormat }
}

/** One migration step: old partial state → next partial state. */
type MigrationStep = (state: Partial<PersistedState>) => Partial<PersistedState> | Promise<Partial<PersistedState>>

/**
 * Historical id of the old built-in corporate layer (fetched `contributors.yaml`
 * from a private repo). It only ever existed under schema version 1, and only the
 * 1→2 migration below needs to know it — do NOT re-export this, it's not a thing
 * anywhere else in the codebase anymore.
 */
const LEGACY_BUILTIN_SOURCE_ID = 'builtin-cf-internal'

/**
 * 1 → 2: replaces the old built-in layer with the (initially empty) `pass` layer.
 * Manual edits and every user-imported layer are left completely untouched — only
 * the legacy layer's id and slot in the priority order are dealt with.
 */
function migrateBuiltinToPass(state: Partial<PersistedState>): Partial<PersistedState> {
  const sources = state.sources ?? []
  const legacyIndex = sources.findIndex((s) => s.id === LEGACY_BUILTIN_SOURCE_ID)
  const withoutLegacy = sources.filter((s) => s.id !== LEGACY_BUILTIN_SOURCE_ID)
  // Insert the new layer at the position the old one occupied, so priority order
  // among the surviving layers doesn't shift. If there was no old layer, append it.
  const insertAt = legacyIndex === -1 ? withoutLegacy.length : legacyIndex
  const sourcesWithPass = [...withoutLegacy.slice(0, insertAt), createPassSource(), ...withoutLegacy.slice(insertAt)]

  const records = { ...(state.records ?? {}) }
  delete records[LEGACY_BUILTIN_SOURCE_ID]
  records[PASS_SOURCE_ID] = []

  // Rebuilt with `mergeIntoIndex` (pure), not `rebuildIndex` (writes to storage) —
  // the migration itself owns the single write at the end, via `initializeIfNeeded`.
  const idx = mergeIntoIndex(sourcesWithPass, records, state.settings ?? DEFAULT_SETTINGS)

  return {
    ...state,
    sources: sourcesWithPass,
    records,
    idx,
    passCache: {},
    passMeta: DEFAULT_PASS_META,
  }
}

/**
 * Chain of schema migrations. `MIGRATIONS[n]` moves the state from version `n + 1` to
 * version `n + 2` (i.e. `MIGRATIONS[0]` is 1 → 2) — the scaffolding exists so a future
 * version can be added here as a single element, instead of rewriting this whole file.
 */
const MIGRATIONS: readonly MigrationStep[] = [migrateBuiltinToPass]

/** The manual edits layer, created on first storage initialization. Empty, but not "unowned". */
function createManualSource(): Source {
  return {
    id: MANUAL_SOURCE_ID,
    kind: 'manual',
    label: t('sourcesManualDefaultLabel'),
    enabled: true,
    importedAt: new Date().toISOString(),
    rawText: '',
    stats: { total: 0, imported: 0, skipped: [] },
  }
}

/**
 * The Fabric Pass layer, created on first storage initialization. Empty until the
 * first successful resolve (phase 3) — its status doesn't live on the layer itself
 * (unlike the old built-in layer), see `PassMeta`. It can be disabled but not deleted.
 */
function createPassSource(): Source {
  return {
    id: PASS_SOURCE_ID,
    kind: 'pass',
    label: t('sourcesPassDefaultLabel'),
    enabled: true,
    importedAt: new Date().toISOString(),
    stats: { total: 0, imported: 0, skipped: [] },
  }
}

/** Fills in missing state fields with safe defaults, without overwriting anything. */
function withDefaults(state: Partial<StoredState>): StoredState {
  return {
    schemaVersion: state.schemaVersion ?? SCHEMA_VERSION,
    settings: sanitizeSettings(state.settings ?? DEFAULT_SETTINGS),
    sources: state.sources ?? [],
    records: state.records ?? {},
    idx: state.idx ?? {},
  }
}

/** Same as `withDefaults`, but for the full persisted shape — used only by `migrate`. */
function withPersistedDefaults(state: Partial<PersistedState>): PersistedState {
  return {
    ...withDefaults(state),
    passCache: state.passCache ?? {},
    passMeta: state.passMeta ?? DEFAULT_PASS_META,
  }
}

/**
 * Brings an arbitrary saved state up to the current schema version.
 *
 * Versions from the future (e.g. the state synced from a newer version of the
 * extension on another machine) are left untouched — just logged and returned as-is,
 * with missing fields filled in with defaults for the sake of the return type.
 */
export async function migrate(state: Partial<PersistedState>): Promise<PersistedState> {
  const fromVersion = state.schemaVersion ?? 0

  if (fromVersion > SCHEMA_VERSION) {
    console.warn(
      `[gh-name-ext] schemaVersion ${fromVersion} is newer than the supported ${SCHEMA_VERSION}; leaving state untouched`,
    )
    return withPersistedDefaults(state)
  }

  // MIGRATIONS[n] moves version (n+1) → (n+2) — see the array's docstring — so a
  // state at `fromVersion` needs MIGRATIONS starting at index `fromVersion - 1`. A
  // state with NO version at all (`fromVersion` defaulted to 0 above) is treated as
  // the oldest version there's ever been (1): it runs every migration, same as an
  // actual version-1 state — there's nothing older to distinguish it from.
  let migrated: Partial<PersistedState> = state
  for (const step of MIGRATIONS.slice(Math.max(fromVersion - 1, 0))) {
    migrated = await step(migrated)
  }

  return { ...withPersistedDefaults(migrated), schemaVersion: SCHEMA_VERSION }
}

/**
 * First-run initialization AND schema migration — called from `onInstalled` and
 * `onStartup` in background, not only at install time: an existing install whose
 * `schemaVersion` is behind `SCHEMA_VERSION` needs `migrate()` to actually run on
 * browser startup, or its storage would stay on the old schema forever.
 *
 * - `schemaVersion` absent → fresh install: writes the current-schema default state
 *   (default settings, empty `records`/`idx`, and the `manual`/`pass` layers).
 * - `schemaVersion` present and behind `SCHEMA_VERSION` → reads the full persisted
 *   state, runs `migrate()`, and writes the result back in one call.
 * - `schemaVersion` already current → does nothing.
 */
export async function initializeIfNeeded(): Promise<void> {
  const existing = await browser.storage.local.get(STORAGE_KEYS.schemaVersion)
  const existingVersion = existing[STORAGE_KEYS.schemaVersion] as number | undefined

  if (existingVersion === undefined) {
    const initial: PersistedState = {
      schemaVersion: SCHEMA_VERSION,
      settings: DEFAULT_SETTINGS,
      sources: [createManualSource(), createPassSource()],
      records: { [MANUAL_SOURCE_ID]: [], [PASS_SOURCE_ID]: [] },
      idx: {},
      passCache: {},
      passMeta: DEFAULT_PASS_META,
    }
    await browser.storage.local.set(initial)
    return
  }

  if (existingVersion < SCHEMA_VERSION) {
    const stored = await browser.storage.local.get(Object.values(STORAGE_KEYS))
    const migrated = await migrate(stored as Partial<PersistedState>)
    await browser.storage.local.set(migrated)
  }
}

/** The five `StoredState` keys — deliberately not all of `STORAGE_KEYS`, see `readState`. */
const STATE_KEYS = [
  STORAGE_KEYS.schemaVersion,
  STORAGE_KEYS.settings,
  STORAGE_KEYS.sources,
  STORAGE_KEYS.records,
  STORAGE_KEYS.idx,
]

/**
 * Reads the layer machinery's state — one key per field, but deliberately NOT
 * `passCache`/`passMeta`: this is called on every layer operation (`sources.ts`), and
 * the pass cache can grow to thousands of entries that nothing here needs.
 */
export async function readState(): Promise<StoredState> {
  const stored = await browser.storage.local.get(STATE_KEYS)
  return ensurePassSource(ensureManualSource(withDefaults(stored as Partial<StoredState>)))
}

/**
 * Self-healing for the `manual` layer: if it's absent from the read state (e.g.
 * `onInstalled` didn't fire because of browser environment quirks, and
 * `initializeIfNeeded` didn't get to write it to storage before the first read) —
 * adds an empty layer to the START of `sources`, without touching storage. Without
 * this, the popup and content script would silently be left with nowhere to save
 * manual edits.
 */
function ensureManualSource(state: StoredState): StoredState {
  if (state.sources.some((s) => s.id === MANUAL_SOURCE_ID)) return state
  return { ...state, sources: [createManualSource(), ...state.sources] }
}

/**
 * Self-healing for the `pass` layer, the same way and for the same reason as
 * `ensureManualSource` — but at the END of `sources` (lowest priority, see
 * `createPassSource`).
 */
function ensurePassSource(state: StoredState): StoredState {
  if (state.sources.some((s) => s.id === PASS_SOURCE_ID)) return state
  return { ...state, sources: [...state.sources, createPassSource()] }
}

/** Writes only the passed keys. The keys of `patch` are the keys of `STORAGE_KEYS`, one to one. */
export async function writeState(patch: Partial<StoredState>): Promise<void> {
  await browser.storage.local.set(patch)
}

/**
 * The only thing the content script should read: a single `storage.local.get('idx')`,
 * without the records of all layers. Deliberately doesn't reuse `readState`.
 */
export async function readIdx(): Promise<MergedIndex> {
  const stored = await browser.storage.local.get(STORAGE_KEYS.idx)
  return (stored[STORAGE_KEYS.idx] as MergedIndex | undefined) ?? {}
}

export async function readSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(STORAGE_KEYS.settings)
  return sanitizeSettings((stored[STORAGE_KEYS.settings] as Settings | undefined) ?? DEFAULT_SETTINGS)
}

/**
 * The pass cache and its meta are kept OUT of `readState`/`writeState` on purpose —
 * see the field comment on `PersistedState`. Only the pass resolver (background) and
 * the pass status UI should ever call these; the content script and the layer
 * machinery in `sources.ts` must not.
 */
export async function readPassCache(): Promise<PassCache> {
  const stored = await browser.storage.local.get(STORAGE_KEYS.passCache)
  return (stored[STORAGE_KEYS.passCache] as PassCache | undefined) ?? {}
}

export async function writePassCache(cache: PassCache): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.passCache]: cache })
}

/** Falls back to `DEFAULT_PASS_META` (`{ lastStatus: 'never' }`) when nothing was stored yet. */
export async function readPassMeta(): Promise<PassMeta> {
  const stored = await browser.storage.local.get(STORAGE_KEYS.passMeta)
  return (stored[STORAGE_KEYS.passMeta] as PassMeta | undefined) ?? DEFAULT_PASS_META
}

export async function writePassMeta(meta: PassMeta): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.passMeta]: meta })
}

/** Subscription to `storage.local` changes. Returns an unsubscribe function. */
export function onStateChanged(cb: (changedKeys: string[]) => void): () => void {
  const listener = (
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
    areaName: string,
  ) => {
    if (areaName !== 'local') return
    cb(Object.keys(changes))
  }
  browser.storage.onChanged.addListener(listener)
  return () => browser.storage.onChanged.removeListener(listener)
}
