/**
 * Parser for hand-written JSON. Auto-detects the shape, no format parameter — §5.3 PLAN.md:
 *
 *   A. flat map            { "login": "Name", ... }         — all values are strings
 *   B. array of objects    [ { "github_login": "x", ... } ]
 *   C. wrapper             { "contributors": [ ... ] }      — shape B inside
 *
 * Doesn't normalize names or filter out records — that's handled by `resolve.ts`.
 */

import { canonicalField } from '../field-aliases'
import { t } from '../i18n'
import type { ParseError, ParseResult, RawRecord } from '../types'
import { buildRawRecord, isPlainRecord } from './record'

/** A — flat map, B — array of objects (including a single record), C — `contributors` wrapper. */
export type JsonShape = 'flat-map' | 'array' | 'wrapped'

export function parseJson(text: string): ParseResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (err) {
    return { records: [], errors: [syntaxErrorToParseError(err, text)], format: 'json' }
  }

  const classified = classifyJsonShape(data)
  const list = classified?.list
  if (!list) {
    return {
      records: [],
      errors: [{ message: t('errorUnknownJsonShape') }],
      format: 'json',
    }
  }

  const records: RawRecord[] = []
  const errors: ParseError[] = []

  list.forEach((item, index) => {
    if (!isPlainRecord(item)) {
      errors.push({ message: t('errorRecordExpectedObject', String(index)) })
      return
    }
    records.push(buildRawRecord(item, index))
  })

  return { records, errors, format: 'json' }
}

/**
 * Distinguishes shapes A/B/C. Returns `undefined` if the structure doesn't fit any of them.
 *
 * Exported — reused by the hand-written JSON editor (T7), so the file's shape isn't
 * determined differently in two places.
 */
export function classifyJsonShape(data: unknown): { shape: JsonShape; list: unknown[] } | undefined {
  if (Array.isArray(data)) {
    // B. array of objects
    return { shape: 'array', list: data }
  }

  if (isPlainRecord(data)) {
    if (Array.isArray(data.contributors)) {
      // C. wrapper — the same shape B inside `contributors`
      return { shape: 'wrapped', list: data.contributors }
    }

    if (looksLikeSingleRecord(data)) {
      // A single record with no wrapper: `{"github_login":"alice","name":"Alice Smith"}`.
      // Formally passes the "all values are strings" check, but this isn't a flat map
      // of login → name, it's a single record written as an object. Treated as shape B
      // with one element, rather than as an error or as two junk key-value pairs.
      return { shape: 'array', list: [data] }
    }

    const values = Object.values(data)
    if (values.every((v) => typeof v === 'string')) {
      // A. flat map login -> name
      return { shape: 'flat-map', list: Object.entries(data).map(([login, name]) => ({ github_login: login, name })) }
    }
  }

  return undefined
}

/**
 * A sign that an object is a single record rather than a flat map of login → name:
 * among its keys there's at least one recognized by `canonicalField()` as a canonical
 * record field (`name`, `github_login`, ...). A flat map consists of GitHub logins —
 * a login coinciding with a field name like `name` is a degenerate case and can be
 * disregarded.
 */
function looksLikeSingleRecord(data: Record<string, unknown>): boolean {
  return Object.keys(data).some((key) => canonicalField(key) !== undefined)
}

/**
 * 1-based line/column from a character offset in the text.
 * Exported — used by the UI to show JSON syntax errors.
 */
export function offsetToLineCol(text: string, offset: number): { line: number; column: number } {
  let line = 1
  let column = 1
  const end = Math.min(offset, text.length)
  for (let i = 0; i < end; i++) {
    if (text[i] === '\n') {
      line++
      column = 1
    } else {
      column++
    }
  }
  return { line, column }
}

function syntaxErrorToParseError(err: unknown, text: string): ParseError {
  const message = err instanceof Error ? err.message : String(err)
  const offset = extractOffset(message, text)
  if (offset === undefined) {
    return { message }
  }
  const { line, column } = offsetToLineCol(text, offset)
  return { line, column, message }
}

/**
 * Extracts the error offset from a `JSON.parse` message. Two known V8 formats:
 *
 * 1. `... at position 7 (line 1 column 8)` — there's an explicit offset, just parse the number.
 * 2. `Unexpected token 'X', "...text fragment..." is not valid JSON` — no offset,
 *    but there's a quoted fragment of the source text around the error; we look for
 *    this fragment in the original text and take the position of the offending
 *    character within it.
 *
 * If neither format is recognized, returns `undefined`; in that case the caller must
 * return an error without `line`/`column`, but with the original message.
 */
function extractOffset(message: string, text: string): number | undefined {
  const positionMatch = /position (\d+)/.exec(message)
  if (positionMatch) {
    return Number(positionMatch[1])
  }

  return extractOffsetFromQuotedContext(message, text)
}

function extractOffsetFromQuotedContext(message: string, text: string): number | undefined {
  const tokenMatch = /Unexpected token '(.)'/.exec(message)
  if (!tokenMatch) return undefined
  const badChar = tokenMatch[1]
  if (badChar === undefined) return undefined

  const suffixMarker = 'is not valid JSON'
  const suffixIdx = message.lastIndexOf(suffixMarker)
  if (suffixIdx === -1) return undefined

  let before = message.slice(0, suffixIdx).trimEnd()
  const suffixTruncated = before.endsWith('...')
  if (suffixTruncated) before = before.slice(0, -3).trimEnd()
  if (!before.endsWith('"')) return undefined
  before = before.slice(0, -1)

  const openIdx = before.indexOf('"')
  if (openIdx === -1) return undefined
  const prefix = before.slice(0, openIdx).trimEnd()
  const prefixTruncated = prefix.endsWith('...')
  const context = before.slice(openIdx + 1)

  let start: number
  if (!prefixTruncated) {
    start = 0
  } else if (!suffixTruncated) {
    start = text.length - context.length
  } else {
    start = text.indexOf(context)
  }
  if (start < 0) return undefined

  const relIdx = context.lastIndexOf(badChar)
  return relIdx === -1 ? start + context.length : start + relIdx
}
