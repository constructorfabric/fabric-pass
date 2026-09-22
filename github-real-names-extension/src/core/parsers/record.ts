/**
 * Common logic for building a `RawRecord` from an arbitrary key-value object.
 *
 * Used by all three parsers (yaml/json/csv) — they only differ in how they extract
 * key-value pairs from the text. The record assembly itself (field names via
 * `canonicalField()`, value normalization) is the same.
 */

import { canonicalField } from '../field-aliases'
import type { RawRecord } from '../types'

/** `true` if the value is a plain object (not an array, not `null`). */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Builds a `RawRecord` from an object: maps field names through `canonicalField()`
 * and normalizes the values. Unknown fields are silently skipped — that's done by
 * `canonicalField()` itself.
 */
export function buildRawRecord(source: Record<string, unknown>, index: number): RawRecord {
  const record: RawRecord = { _index: index }

  for (const [key, value] of Object.entries(source)) {
    const field = canonicalField(key)
    if (!field) continue

    switch (field) {
      case 'github_id':
      case 'alias_of_github_id':
        record[field] = toIdString(value)
        break
      case 'is_agent':
      case 'is_admin':
        record[field] = toBooleanOrNull(value)
        break
      default:
        record[field] = toStringOrNull(value)
    }
  }

  return record
}

/** Strings get `.trim()`, an empty string after that → `null`. `undefined`/`null` are kept as-is. */
function toStringOrNull(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }
  // Number/boolean etc. — a rare case (hand-written JSON without quotes).
  return String(value)
}

/** `github_id` / `alias_of_github_id` — always a string, even if the source has a number. */
function toIdString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const str = String(value).trim()
  return str === '' ? null : str
}

/** `is_agent` / `is_admin` — boolean, but strings `"true"`/`"false"` are also accepted. */
function toBooleanOrNull(value: unknown): boolean | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
    if (normalized === '') return null
  }
  return null
}
