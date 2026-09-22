/**
 * Normalizes raw records (T2) into displayable `Contributor`s (T3).
 *
 * The single entry point is `resolveRecords`. It handles three independent tasks:
 *   1. picking the name to display (field priority, Title Case, aliases);
 *   2. filtering out records that IRREPARABLY cannot be shown (no login, no
 *      name, name equals login, malformed record, duplicate);
 *   3. collecting import stats for the UI (`ImportStats`).
 *
 * PREFERENCE filters (`status: draft`, `is_agent`) are deliberately not included here —
 * they don't change whether a record ends up in `resolveRecords`'s result, and are
 * applied later, in `sources.ts#mergeIntoIndex`, where they can be toggled without
 * re-importing. `status` and `is_agent` are carried over into `Contributor` as-is —
 * merge reads them from there.
 *
 * The skip reason is fixed by `SKIP_REASON_PRECEDENCE` from `types.ts` — if a record
 * matches several reasons at once, the first one in that list wins. It's used here as
 * the single source of truth: the structural checks (`invalid_record`, `no_login`,
 * `duplicate_login`) are handled by preceding early `return`s, which already matches
 * their place in the list; the remaining ones (`no_name`, `name_equals_login`) are run
 * through the list itself.
 */

import type { Contributor, ImportStats, RawRecord, SkippedRecord } from './types'
import { SKIP_REASON_PRECEDENCE } from './types'

/** Priority order of name sources, highest wins. See GHnameExt.md, "display_name computation rules". */
const NAME_FIELDS = ['name', 'github_name', 'discord_name', 'telegram_name', 'linkedin_name'] as const

/** Max steps when resolving an `alias_of_github_id` chain, beyond which it's treated as a cycle. */
const MAX_ALIAS_CHAIN_STEPS = 5

/**
 * Picks the first non-empty name field by `NAME_FIELDS` priority.
 * Empty means `null`, `undefined`, or a string that's empty after trim. The value is
 * returned as-is, without trimming: trimming is only needed to check for emptiness.
 */
export function pickName(r: RawRecord): { value: string; field: string } | undefined {
  for (const field of NAME_FIELDS) {
    const value = r[field]
    if (typeof value === 'string' && value.trim() !== '') {
      return { value, field }
    }
  }
  return undefined
}

/** lowercase + removal of spaces, `.`, `_`, `-`. Used to compare a name against a login. */
export function normalizeForComparison(s: string): string {
  return s.toLowerCase().replace(/[\s._-]+/g, '')
}

/**
 * Title Case, but only if the string is entirely upper case
 * (`s === s.toUpperCase() && s !== s.toLowerCase()` — the second condition filters out
 * strings with no letters, where upper and lower case coincide). Otherwise the string
 * is returned as-is: `MikeY`, `bit4flip` are deliberate spellings, not "forgot to turn
 * off Caps Lock".
 *
 * Hyphens and apostrophes split the word into parts, each starting with a capital:
 * `JEAN-LUC` → `Jean-Luc`, `O'BRIEN` → `O'Brien`.
 */
export function toTitleCase(s: string): string {
  if (!(s === s.toUpperCase() && s !== s.toLowerCase())) {
    return s
  }
  return s.toLowerCase().replace(/[a-z]+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1))
}

/** `null`/`undefined`/a string empty after trim → `undefined`, otherwise the original string. */
function trimmedOrUndefined(v: string | null | undefined): string | undefined {
  if (typeof v !== 'string') return undefined
  const trimmed = v.trim()
  return trimmed === '' ? undefined : trimmed
}

/** `null` → `undefined`, everything else unchanged. For fields that are carried over "as-is". */
function nullToUndefined<T>(v: T | null | undefined): T | undefined {
  return v === null || v === undefined ? undefined : v
}

/** Structural check: a record must be an object (and not an array). */
function isRecordObject(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `SkippedRecord.index`: the record's `_index` if it's structurally valid, otherwise its position in the array. */
function safeIndex(entry: unknown, position: number): number {
  if (isRecordObject(entry) && typeof entry._index === 'number') return entry._index
  return position
}

/**
 * Walks the `alias_of_github_id` chain starting at `startId` and returns the first
 * record whose own pointer is empty (i.e. the "root" of the chain).
 * Returns `undefined` if the target is absent from the set, or the chain loops or
 * exceeds `MAX_ALIAS_CHAIN_STEPS` steps — in both cases the caller must fall back to
 * the record's own name rather than the name of some random node in the chain.
 */
function followAliasChain(startId: string, byGithubId: ReadonlyMap<string, RawRecord>): RawRecord | undefined {
  const visited = new Set<string>()
  let currentId: string | undefined = startId

  for (let step = 0; step < MAX_ALIAS_CHAIN_STEPS && currentId !== undefined; step++) {
    if (visited.has(currentId)) return undefined
    visited.add(currentId)

    const record = byGithubId.get(currentId)
    if (!record) return undefined

    const nextId = trimmedOrUndefined(record.alias_of_github_id)
    if (!nextId) return record

    currentId = nextId
  }
  return undefined
}

/**
 * Display name for a specific record, honoring aliases: if `alias_of_github_id`
 * resolves to a real record AND that target has some name at all — the target's name
 * wins, even if the record itself has its own. In any other case (no target, a cycle,
 * hitting the step limit, or the target was found but has no name) the record's own
 * name is used — the record itself may have one, and discarding it just because the
 * alias target is nameless would be wrong (code review Defect 3).
 */
function resolveDisplayNameForRecord(
  r: RawRecord,
  byGithubId: ReadonlyMap<string, RawRecord>,
): { value: string; field: string } | undefined {
  const aliasTarget = trimmedOrUndefined(r.alias_of_github_id)
  if (aliasTarget) {
    const resolved = followAliasChain(aliasTarget, byGithubId)
    const resolvedName = resolved && pickName(resolved)
    if (resolvedName) return resolvedName
  }
  return pickName(r)
}

export function resolveRecords(raw: RawRecord[]): { records: Contributor[]; stats: ImportStats } {
  // First pass: github_id → record index, needed to resolve aliases.
  // Records without a valid github_id don't make it into the index — there's no way
  // to reference them as an alias target anyway.
  const byGithubId = new Map<string, RawRecord>()
  for (const entry of raw) {
    if (!isRecordObject(entry)) continue
    const id = trimmedOrUndefined(entry.github_id)
    if (id && !byGithubId.has(id)) byGithubId.set(id, entry)
  }

  const records: Contributor[] = []
  const skipped: SkippedRecord[] = []
  const seenLogins = new Set<string>()

  raw.forEach((rawEntry, position) => {
    const index = safeIndex(rawEntry, position)

    if (!isRecordObject(rawEntry)) {
      skipped.push({ index, reason: 'invalid_record' })
      return
    }
    const entry = rawEntry

    const loginRaw = entry.github_login
    if (typeof loginRaw !== 'string' || loginRaw.trim() === '') {
      skipped.push({ index, reason: 'no_login' })
      return
    }
    const loginKey = loginRaw.trim().toLowerCase()

    // Only a login that was ACTUALLY imported already counts as a duplicate. A record
    // skipped for another reason (e.g. an empty one with no name) doesn't claim the
    // login: otherwise `{alice, name: null}` before `{alice, name: "Alice Smith"}`
    // would permanently eat the valid name, and such a pair is common in hand-written
    // files.
    if (seenLogins.has(loginKey)) {
      skipped.push({ index, login: loginRaw, reason: 'duplicate_login' })
      return
    }

    const picked = resolveDisplayNameForRecord(entry, byGithubId)
    const status = entry.status === 'confirmed' || entry.status === 'draft' ? entry.status : undefined
    const nameEqualsLogin = picked !== undefined && normalizeForComparison(picked.value) === normalizeForComparison(loginRaw)

    const reason = SKIP_REASON_PRECEDENCE.find((candidate) => {
      switch (candidate) {
        case 'no_name':
          return picked === undefined
        case 'name_equals_login':
          return nameEqualsLogin
        default:
          // invalid_record / no_login / duplicate_login are already handled above by early returns.
          return false
      }
    })
    if (reason) {
      skipped.push({ index, login: loginRaw, reason })
      return
    }

    // On this branch `picked` is guaranteed to be defined — otherwise `no_name` would have fired above.
    const rawNameValue = picked!.value
    const displayName = toTitleCase(rawNameValue)

    seenLogins.add(loginKey)

    const contributor: Contributor = {
      github_login: loginRaw.trim(),
      login_key: loginKey,
      github_id: nullToUndefined(entry.github_id),
      display_name: displayName,
      raw_name: displayName !== rawNameValue ? rawNameValue : undefined,
      company: nullToUndefined(entry.company),
      email: nullToUndefined(entry.email),
      discord_username: nullToUndefined(entry.discord_username),
      telegram_username: nullToUndefined(entry.telegram_username),
      is_agent: nullToUndefined(entry.is_agent),
      is_admin: nullToUndefined(entry.is_admin),
      status,
    }
    records.push(contributor)
  })

  const stats: ImportStats = {
    total: raw.length,
    imported: records.length,
    skipped,
  }
  return { records, stats }
}
