/**
 * Projects the pass cache (`PassCache`, the source of truth) onto `records[PASS_SOURCE_ID]`
 * (a regular layer, consumed by the same "layer machinery" as any other source).
 *
 * Names are run through `resolveRecords` rather than turned into `Contributor`s by
 * hand: a name from pass must get exactly the same normalization (Title Case for
 * ALL-CAPS) and the same rejections (`name_equals_login`) as a name from any imported
 * file — otherwise the same person would render differently depending on which layer
 * happens to win, purely because of where their name came from.
 */

import { resolveRecords } from './resolve'
import type { Contributor, ImportStats, PassCache, RawRecord } from './types'

/**
 * Builds the pass layer's records (and import stats, for the UI) from the cache.
 * Only positive entries (`name` non-null and non-empty after trim) become records —
 * negative cache entries exist purely to avoid re-asking pass, they have nothing to
 * show. Order follows `Object.keys(cache)`; `_index` is the position in that order,
 * used only for diagnostics (it isn't a stable id).
 */
export function projectPassCache(cache: PassCache): { records: Contributor[]; stats: ImportStats } {
  const raw: RawRecord[] = []
  let index = 0

  for (const loginKey of Object.keys(cache)) {
    const entry = cache[loginKey]
    if (!entry) continue
    if (entry.name === null || entry.name.trim() === '') continue

    raw.push({ github_login: loginKey, name: entry.name, _index: index })
    index++
  }

  return resolveRecords(raw)
}
