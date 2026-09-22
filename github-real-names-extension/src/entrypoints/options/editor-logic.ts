/**
 * Pure functions for the hand-written JSON editor (PLAN.md §5.5).
 *
 * Key idea: a file that a person writes by hand almost always has a couple of
 * broken records — import is never all-or-nothing. These functions parse the
 * text, determine its shape (A/B/C), and count valid records separately from
 * the listed problems — instead of rejecting the whole file.
 *
 * Writes nothing to storage and doesn't depend on React — can be run directly
 * in tests, without mocking `browser.storage`.
 */

import { canonicalField, FIELD_ALIASES, IGNORED_FIELDS, normalizeKey } from '../../core/field-aliases'
import { t } from '../../core/i18n'
import { classifyJsonShape, offsetToLineCol, parseJson } from '../../core/parsers/json'
import { buildRawRecord, isPlainRecord } from '../../core/parsers/record'
import { resolveRecords } from '../../core/resolve'
import { isFilteredByPreference } from '../../core/sources'
import type { Contributor, ImportStats, ParseError, RawRecord, Settings, SkippedRecord, Source } from '../../core/types'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** A — flat map, B — array of objects, C — wrapper `{ contributors: [...] }`. See PLAN.md §5.3. */
export type JsonShape = 'flat-map' | 'array' | 'wrapped'

export interface UnknownFieldWarning {
  /** Position of the record in the array (not `_index`, but the actual position — records aren't normalized yet). */
  index: number
  /** Field name exactly as written in the file. */
  field: string
  /** A similar canonical field name, if the Levenshtein distance is within the threshold. */
  suggestion?: string
}

export interface ValidationResult {
  /** `false` only for a structural problem with the whole file: syntax or an unrecognized shape. */
  ok: boolean
  shape?: JsonShape
  /** How many records were found in the file (shape recognized, including semantically broken ones). */
  recordCount: number
  /** `JSON.parse` error (with `line`/`column`) or a message about an unrecognized shape (no position). */
  syntaxError?: ParseError
  /** Semantic problems in specific records — a single record doesn't throw out the whole file. */
  recordIssues: SkippedRecord[]
  /** Unknown field names — a warning, not an error; the record is still imported. */
  unknownFields: UnknownFieldWarning[]
}

/**
 * A table row. Table view shows only four columns (PLAN.md §5.5), but the record's
 * other fields (`discord_username`, `status`, `_note`, etc.) aren't discarded — they
 * survive in `extra` and get merged back on the Table → JSON switch. Without this,
 * `JSON → Table → JSON` would silently lose everything that doesn't fit into the
 * four columns.
 */
export interface EditorRow {
  github_login: string
  name: string
  company: string
  email: string
  /** Everything else from the original record object, keys as-is, including `_note`. */
  extra: Record<string, unknown>
}

export interface EditorParseSuccess {
  ok: true
  shape: JsonShape
  records: Contributor[]
  stats: ImportStats
  unknownFields: UnknownFieldWarning[]
}

export interface EditorParseFailure {
  ok: false
  syntaxError: ParseError
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsing and validation
// ─────────────────────────────────────────────────────────────────────────────

/** Stats of an empty layer — no records, nothing imported, nothing skipped. */
const EMPTY_STATS: ImportStats = { total: 0, imported: 0, skipped: [] }

/**
 * Full parse of the editor text: shape, records (already run through
 * `resolveRecords` — it no longer applies preference filters like `showDraft`, so
 * the editor shows the file's entire content as-is), and unknown fields. Used both
 * by `validateJsonText` (for the preview) and by saving in EditorTab (so the preview
 * and the actual save never diverge).
 */
export function resolveEditorText(text: string): EditorParseSuccess | EditorParseFailure {
  // An empty layer is a normal starting state, not a broken file: a freshly installed
  // extension opens the editor with `rawText === ''`, and `JSON.parse('')` would throw
  // "Unexpected end of JSON input" — a red error before the person has typed anything.
  if (text.trim() === '') {
    return { ok: true, shape: 'array', records: [], stats: EMPTY_STATS, unknownFields: [] }
  }

  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (err) {
    return { ok: false, syntaxError: jsonSyntaxError(err, text) }
  }

  const classified = classifyShape(data)
  if (!classified) {
    return { ok: false, syntaxError: { message: t('errorUnknownJsonShape') } }
  }

  const { shape, list } = classified
  const unknownFields = shape === 'flat-map' ? [] : collectUnknownFields(list)
  const rawRecords = toRawRecords(list)
  const { records, stats } = resolveRecords(rawRecords)

  return { ok: true, shape, records, stats, unknownFields }
}

/** Preview for the UI: status line `42 records · 3 errors` and a list of issues, without actually writing to storage. */
export function validateJsonText(text: string): ValidationResult {
  const parsed = resolveEditorText(text)

  if (!parsed.ok) {
    return { ok: false, recordCount: 0, syntaxError: parsed.syntaxError, recordIssues: [], unknownFields: [] }
  }

  return {
    ok: true,
    shape: parsed.shape,
    recordCount: parsed.stats.total,
    recordIssues: parsed.stats.skipped,
    unknownFields: parsed.unknownFields,
  }
}

/**
 * Reuses the `JSON.parse` error parsing already implemented in `parsers/json.ts`
 * (offset → line/column from the V8 message), instead of reimplementing the same
 * logic.
 */
function jsonSyntaxError(err: unknown, text: string): ParseError {
  const reparsed = parseJson(text)
  const fromParser = reparsed.errors[0]
  if (fromParser) return fromParser

  const message = err instanceof Error ? err.message : String(err)
  return { message }
}

/**
 * Distinguishes shapes A/B/C. Reuses `classifyJsonShape` from `parsers/json.ts` —
 * the same classification (including telling a single record apart from a flat map,
 * code review Defect 2), so the editor and the parser never disagree on what counts
 * as which shape.
 */
function classifyShape(data: unknown): { shape: JsonShape; list: unknown[] } | undefined {
  return classifyJsonShape(data)
}

/** `RawRecord[]` for `resolveRecords`. Non-objects are passed through as-is — `resolveRecords` itself marks them `invalid_record`. */
function toRawRecords(list: unknown[]): RawRecord[] {
  return list.map((item, index) => {
    if (!isPlainRecord(item)) return item as unknown as RawRecord
    return buildRawRecord(item, index)
  })
}

/**
 * Unknown field names — the editor's added value on top of the parser.
 * `IGNORED_FIELDS` are known registry fields that we deliberately don't use — we
 * don't warn about them. Everything else is a likely typo, for which we try to
 * suggest a similar canonical name via `suggestField`.
 */
function collectUnknownFields(list: unknown[]): UnknownFieldWarning[] {
  const result: UnknownFieldWarning[] = []

  list.forEach((item, index) => {
    if (!isPlainRecord(item)) return

    for (const key of Object.keys(item)) {
      if (key.startsWith('_')) continue
      if (canonicalField(key)) continue
      if (IGNORED_FIELDS.has(normalizeKey(key))) continue

      result.push({ index, field: key, suggestion: suggestField(key) })
    }
  })

  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Similar field suggestion
// ─────────────────────────────────────────────────────────────────────────────

/** Levenshtein distance threshold beyond which a suggestion is considered useless. */
const SUGGESTION_MAX_DISTANCE = 3

/**
 * Finds the closest canonical field name by Levenshtein distance to the canonical
 * name itself and to all of its synonyms from `FIELD_ALIASES`. `"nmae"` → `"name"`.
 * Returns `undefined` if the closest match is farther than `SUGGESTION_MAX_DISTANCE`
 * edits.
 */
export function suggestField(unknown: string): string | undefined {
  const target = normalizeKey(unknown)
  let bestField: string | undefined
  let bestDistance = SUGGESTION_MAX_DISTANCE + 1

  for (const [canonical, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases as readonly string[]) {
      const distance = levenshtein(target, normalizeKey(alias))
      if (distance < bestDistance) {
        bestDistance = distance
        bestField = canonical
      }
    }
  }

  return bestDistance <= SUGGESTION_MAX_DISTANCE ? bestField : undefined
}

/** Standard iterative Levenshtein distance implementation, O(n·m) time, O(m) memory. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  let curr = new Array<number>(b.length + 1).fill(0)

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(
        (curr[j - 1] ?? Infinity) + 1,
        (prev[j] ?? Infinity) + 1,
        (prev[j - 1] ?? Infinity) + cost,
      )
    }
    ;[prev, curr] = [curr, prev]
  }

  return prev[b.length] ?? 0
}

// ─────────────────────────────────────────────────────────────────────────────
// Example skeleton
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A skeleton of two records in shape B with all optional fields and `_note` —
 * JSON has no comments, and our parser silently ignores fields starting with `_`,
 * which is exactly the way to leave notes right in the file.
 */
export function exampleSkeleton(): string {
  const skeleton = [
    {
      github_login: 'anatolyb',
      name: 'Anatoly Bobrov',
      company: 'Acronis',
      email: 'anatoly.bobrov@acronis.com',
      discord_username: 'anatolyb',
      telegram_username: '@anatolyb',
      is_agent: false,
      is_admin: false,
      status: 'confirmed',
      _note: t('editorExampleNoteOptional'),
    },
    {
      github_login: 'jdoe123',
      name: 'John Doe',
      _note: t('editorExampleNoteMinimal'),
    },
  ]
  return JSON.stringify(skeleton, null, 2)
}

// ─────────────────────────────────────────────────────────────────────────────
// Table view ⇄ JSON view
// ─────────────────────────────────────────────────────────────────────────────

/**
 * JSON text → table rows. Calling code must make sure the text is valid (otherwise
 * the button for switching to Table view is disabled) — just in case, this simply
 * returns an empty list here instead of throwing.
 */
export function jsonTextToRows(text: string): EditorRow[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return []
  }

  const classified = classifyShape(data)
  if (!classified) return []

  const rows: EditorRow[] = []
  for (const item of classified.list) {
    if (!isPlainRecord(item)) continue
    const record = buildRawRecord(item, rows.length)
    rows.push({
      github_login: record.github_login ?? '',
      name: record.name ?? '',
      company: record.company ?? '',
      email: record.email ?? '',
      extra: extractExtra(item),
    })
  }
  return rows
}

/** Keys that Table view shows as separate columns — they aren't duplicated in `extra`. */
const COLUMN_KEYS: ReadonlySet<string> = new Set(['github_login', 'name', 'company', 'email'])

/**
 * Everything that didn't fit into the four visible columns, with its own keys as-is,
 * so `_note` and synonyms of fields NOT related to the columns (`discord_username`,
 * `status`, ...) survive the conversion back to JSON.
 *
 * Synonyms of the four columns THEMSELVES (`fullName`/`real_name` → name, `login` →
 * github_login, `org` → company, `mail` → email) are dropped via `canonicalField()` —
 * otherwise the column's value would live in two places at once: in the table field
 * and in the stale synonym inside `extra`. Clearing a cell wouldn't clear anything
 * then — the old value would survive under the synonym and come back on the next
 * import (code review Defect 3).
 */
function extractExtra(item: Record<string, unknown>): Record<string, unknown> {
  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(item)) {
    const canonical = canonicalField(key)
    if (canonical !== undefined && COLUMN_KEYS.has(canonical)) continue
    extra[key] = value
  }
  return extra
}

/**
 * Table rows → JSON text in shape B. Empty (loginless) rows are discarded. `extra`
 * is merged into the object first, and the columns on top of it, so an edit made in
 * the table always wins over an identically-named value that was accidentally left
 * in `extra`.
 */
export function rowsToJsonText(rows: EditorRow[]): string {
  const records = rows
    .filter((row) => row.github_login.trim() !== '')
    .map((row) => {
      const record: Record<string, unknown> = { ...row.extra, github_login: row.github_login.trim() }
      if (row.name.trim() !== '') record.name = row.name.trim()
      if (row.company.trim() !== '') record.company = row.company.trim()
      if (row.email.trim() !== '') record.email = row.email.trim()
      return record
    })
  return JSON.stringify(records, null, 2)
}

// ─────────────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalized records → JSON text in shape B with all fields. The name is exported
 * as `raw_name` if it was preserved (the original spelling before Title Case) —
 * otherwise `display_name`, so that export → import doesn't lose what the person
 * actually entered.
 */
export function recordsToJsonText(records: Contributor[]): string {
  const list = records.map((r) => {
    const record: Record<string, unknown> = { github_login: r.github_login }
    if (r.github_id !== undefined) record.github_id = r.github_id
    record.name = r.raw_name ?? r.display_name
    if (r.company !== undefined) record.company = r.company
    if (r.email !== undefined) record.email = r.email
    if (r.discord_username !== undefined) record.discord_username = r.discord_username
    if (r.telegram_username !== undefined) record.telegram_username = r.telegram_username
    if (r.is_agent !== undefined) record.is_agent = r.is_agent
    if (r.is_admin !== undefined) record.is_admin = r.is_admin
    if (r.status !== undefined) record.status = r.status
    return record
  })
  return JSON.stringify(list, null, 2)
}

/**
 * "Download mapping as JSON" — shape B, all fields. Works with a single layer as
 * well as the whole merged set: the calling code (EditorTab) decides which
 * `Contributor[]` list to pass. This covers the scenario of a team without a
 * `contributors.yaml`: one person builds the list and exports it, the rest import
 * it without conversion (shape B is recognized by the parser as-is).
 */
export function exportMapping(records: Contributor[]): string {
  return recordsToJsonText(records)
}

/**
 * Merges all enabled layers into one list of records: the same traversal order
 * (from lowest priority to highest) and the same preference filter
 * (`isFilteredByPreference`) as `mergeIntoIndex` in `core/sources.ts` — so "Download
 * the whole merged set as JSON" gives exactly what actually made it into the index,
 * not bots and (when showing drafts is off) drafts that aren't in the index
 * (code review Defect 5).
 */
export function mergeAllRecords(
  sources: Source[],
  records: Record<string, Contributor[]>,
  settings: Settings,
): Contributor[] {
  const byLogin = new Map<string, Contributor>()
  for (let i = sources.length - 1; i >= 0; i--) {
    const source = sources[i]
    if (!source || !source.enabled) continue
    const sourceRecords = records[source.id]
    if (!sourceRecords) continue
    for (const record of sourceRecords) {
      if (isFilteredByPreference(record, settings)) continue
      byLogin.set(record.login_key, record)
    }
  }
  return [...byLogin.values()]
}

export { offsetToLineCol }
