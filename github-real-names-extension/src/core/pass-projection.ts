/**
 * Projects the pass cache (`PassCache`, the source of truth) onto `records[PASS_SOURCE_ID]`
 * (a regular layer, consumed by the same "layer machinery" as any other source).
 *
 * A name is taken from the cache VERBATIM — deliberately NOT through `resolveRecords`.
 * Pass is the registry itself: `/api/names` only ever answers with a `confirmed` row
 * that has a non-empty name, so whatever pass says a person is called is exactly what
 * the extension shows. The normalization and the rejections in `resolve.ts` (Title
 * Case for ALL-CAPS, `name_equals_login`, ...) are hygiene for the untrusted,
 * hand-written files a user imports; reusing them here means the client second-guessing
 * its own source of truth, and it silently hid every `FirstnameLastname` account —
 * `Sanjeev SOLANKI` collapses onto the login `SanjeevSolanki` once whitespace is
 * stripped, so the name was thrown away as `name_equals_login` (IDEA-155). A pass name
 * that looks wrong is fixed in the pass record, where it belongs, not here.
 *
 * Consistency with pass beats consistency between layers: the same person may well
 * render differently depending on which layer wins, and when the pass layer is the
 * winner, pass's spelling is the right answer.
 */

import type { Contributor, ImportStats, PassCache } from './types'

/**
 * Builds the pass layer's records (and import stats, for the UI) from the cache.
 * Only positive entries (`name` non-null and non-empty after trim) become records —
 * negative cache entries exist purely to avoid re-asking pass, they have nothing to
 * show. That is the ONLY reason an entry is left out, and it isn't a rejection, so
 * `stats.skipped` is always empty and `total` counts the names the layer holds rather
 * than every login the cache remembers (a negative entry is a login pass never had a
 * name for, not a record that failed import).
 */
export function projectPassCache(cache: PassCache): { records: Contributor[]; stats: ImportStats } {
  const records: Contributor[] = []

  for (const loginKey of Object.keys(cache)) {
    const entry = cache[loginKey]
    if (!entry || entry.name === null || entry.name.trim() === '') continue

    records.push({ github_login: loginKey, login_key: loginKey, display_name: entry.name.trim() })
  }

  return { records, stats: { total: records.length, imported: records.length, skipped: [] } }
}
