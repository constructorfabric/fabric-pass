/**
 * Layered model of sources and merging into `idx`.
 *
 * The problem it solves: a user may simultaneously have an imported
 * `contributors.yaml`-shaped file, their own hand-written JSON, the lazily-filled
 * Fabric Pass layer, and targeted manual edits. Re-importing/re-resolving a layer
 * shouldn't silently overwrite manual work — hence layers with priority and an
 * undeletable `manual` layer, which by default comes first (highest priority).
 *
 * `mergeIntoIndex`/`isFilteredByPreference` themselves live in `./merge` (pure, no
 * storage access — see that file's docstring for why) and are re-exported here so
 * existing importers of `sources.ts` keep working unchanged.
 */

import { isFilteredByPreference, mergeIntoIndex } from './merge'
import { readState, writeState } from './store'
import {
  MANUAL_SOURCE_ID,
  PASS_SOURCE_ID,
  type ConflictExplanation,
  type Contributor,
  type MergedIndex,
  type Source,
  type SourceKind,
} from './types'

export { isFilteredByPreference, mergeIntoIndex } from './merge'

export async function listSources(): Promise<Source[]> {
  const state = await readState()
  return state.sources
}

/**
 * Creates a new layer (without an `id`) or replaces an existing one entirely, by
 * metadata and records.
 *
 * A replacement keeps the layer's position in `sources` — priority doesn't shift under
 * the user's feet. A new layer is added at the END of the array (lowest priority): a
 * silent import shouldn't outrank already configured layers; reordering it is up to
 * the user.
 */
export async function upsertSource(
  source: Omit<Source, 'id'> & { id?: string },
  records: Contributor[],
): Promise<Source> {
  const state = await readState()
  const id = source.id ?? crypto.randomUUID()
  const resolved: Source = { ...source, id }

  const existingIndex = state.sources.findIndex((s) => s.id === id)
  const sources =
    existingIndex === -1
      ? [...state.sources, resolved]
      : state.sources.map((s, i) => (i === existingIndex ? resolved : s))

  const newRecords = { ...state.records, [id]: records }

  await writeState({ sources, records: newRecords })
  await rebuildIndex()
  return resolved
}

/**
 * The `manual` and `pass` layers are undeletable — this is the core of the
 * requirement that "re-importing/resolving doesn't overwrite manual edits" and "the
 * Fabric Pass layer is always present, it can only be turned off".
 */
export async function removeSource(id: string): Promise<void> {
  if (id === MANUAL_SOURCE_ID) {
    throw new Error('The manual layer cannot be deleted — it can only be disabled or reordered.')
  }
  if (id === PASS_SOURCE_ID) {
    throw new Error('The Fabric Pass layer cannot be deleted — it can only be disabled or reordered.')
  }

  const state = await readState()
  const sources = state.sources.filter((s) => s.id !== id)
  const records = { ...state.records }
  delete records[id]

  await writeState({ sources, records })
  await rebuildIndex()
}

export async function setEnabled(id: string, enabled: boolean): Promise<void> {
  const state = await readState()
  const sources = state.sources.map((s) => (s.id === id ? { ...s, enabled } : s))
  await writeState({ sources })
  await rebuildIndex()
}

/**
 * Reorders the layers. `orderedIds` must contain exactly the same set of ids that
 * already exist — a layer can't be added or dropped this way, so a mismatch is an
 * error, not a cue to guess what's missing.
 */
export async function reorder(orderedIds: string[]): Promise<void> {
  const state = await readState()

  const currentIds = new Set(state.sources.map((s) => s.id))
  const sameSet =
    orderedIds.length === state.sources.length &&
    orderedIds.every((id) => currentIds.has(id)) &&
    new Set(orderedIds).size === currentIds.size

  if (!sameSet) {
    throw new Error('reorder: the id list must contain exactly the existing layers, with none added or dropped.')
  }

  const byId = new Map(state.sources.map((s) => [s.id, s]))
  const sources = orderedIds.map((id) => byId.get(id) as Source)

  await writeState({ sources })
  await rebuildIndex()
}

export async function getRecords(sourceId: string): Promise<Contributor[]> {
  const state = await readState()
  return state.records[sourceId] ?? []
}

/**
 * Rebuilds `idx` from the current state and saves it. Called after any change to the
 * layers, and also directly from `SettingsTab` when `showDraft` changes — without
 * this, the toggle couldn't take effect on already imported layers.
 */
export async function rebuildIndex(): Promise<MergedIndex> {
  const state = await readState()
  const idx = mergeIntoIndex(state.sources, state.records, state.settings)
  await writeState({ idx })
  return idx
}

/**
 * Helper for the UI: looks for a layer with the same `label` and `kind`, so it can
 * offer to "update the existing layer" instead of creating a duplicate. `upsertSource`
 * itself doesn't guess anything — the decision to reuse an id is made by the caller.
 */
export function findExistingSource(sources: Source[], label: string, kind: SourceKind): Source | undefined {
  return sources.find((s) => s.label === label && s.kind === kind)
}

/**
 * Conflict inspector: for a login, shows which layer won, what the losing enabled
 * layers offered (in priority order), what's in the disabled layers, and what was
 * filtered out by the preference filter (`isFilteredByPreference`) — the same rules
 * that `mergeIntoIndex` applies, otherwise the displayed "winner" could diverge from
 * what's actually in `idx` (code review Defect 4).
 */
export async function explain(login: string): Promise<ConflictExplanation> {
  const loginKey = login.toLowerCase()
  const state = await readState()

  const result: ConflictExplanation = { login_key: loginKey, losers: [], disabled: [], filteredByPreference: [] }

  for (const source of state.sources) {
    const sourceRecords = state.records[source.id]
    if (!sourceRecords) continue

    const contributor = sourceRecords.find((r) => r.login_key === loginKey)
    if (!contributor) continue

    const entry = { sourceId: source.id, sourceLabel: source.label, contributor }

    if (!source.enabled) {
      result.disabled.push(entry)
    } else if (isFilteredByPreference(contributor, state.settings)) {
      result.filteredByPreference.push(entry)
    } else if (!result.winner) {
      result.winner = entry
    } else {
      result.losers.push(entry)
    }
  }

  return result
}
