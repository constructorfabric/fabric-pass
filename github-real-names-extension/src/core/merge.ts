/**
 * Pure merge of layers into `idx`. Split out of `sources.ts` so it can be imported
 * from `store.ts` too, without creating a cycle: the schema migration (in `store.ts`)
 * needs to rebuild `idx` after dropping a layer, but `sources.ts` itself imports
 * `store.ts` for `readState`/`writeState`. `merge.ts` imports ONLY from `./types` —
 * no storage access — so both `sources.ts` and `store.ts` can depend on it safely.
 */

import type { Contributor, MergedIndex, Settings, Source } from './types'

/**
 * PREFERENCE filters: drafts and bots. Unlike the skip reasons in `resolve.ts` (no
 * login, no name, etc.), these are decisions that depend on `Settings` and are
 * reversible — the user can turn on showing drafts at any time without re-importing.
 * That's why they're checked here rather than in `resolve.ts`: `mergeIntoIndex` is
 * already rebuilt on every settings change anyway.
 */
export function isFilteredByPreference(record: Contributor, settings: Settings): boolean {
  if (record.is_agent === true) return true
  if (record.status === 'draft' && !settings.showDraft) return true
  return false
}

/**
 * Pure merge of layers into a flat index. Goes from LOWEST priority to highest (i.e.
 * from the end of `sources`), so the record left in `idx` is the one from the
 * highest-priority layer ("last writer wins"). Disabled layers are skipped entirely,
 * as are records filtered out by `isFilteredByPreference`.
 */
export function mergeIntoIndex(
  sources: Source[],
  records: Record<string, Contributor[]>,
  settings: Settings,
): MergedIndex {
  const idx: MergedIndex = {}

  for (let i = sources.length - 1; i >= 0; i--) {
    const source = sources[i]
    if (!source || !source.enabled) continue

    const sourceRecords = records[source.id]
    if (!sourceRecords) continue

    for (const record of sourceRecords) {
      if (isFilteredByPreference(record, settings)) continue
      idx[record.login_key] = [record.display_name, source.id]
    }
  }

  return idx
}
