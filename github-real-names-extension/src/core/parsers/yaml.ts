/**
 * Parser for `contributors.yaml` and hand-written YAML.
 *
 * Accepts: `{ contributors: [...] }` (the registry's standard shape) and a bare array
 * of records at the top level. Doesn't normalize names or filter out records — that's
 * handled by `resolve.ts`.
 */

import { parseDocument } from 'yaml'
import { t } from '../i18n'
import type { ParseError, ParseResult, RawRecord } from '../types'
import { buildRawRecord, isPlainRecord } from './record'

export function parseYaml(text: string): ParseResult {
  const doc = parseDocument(text)

  if (doc.errors.length > 0) {
    const errors: ParseError[] = doc.errors.map((err) => {
      const pos = err.linePos?.[0]
      return { line: pos?.line, column: pos?.col, message: err.message }
    })
    return { records: [], errors, format: 'yaml' }
  }

  const data: unknown = doc.toJS()
  const list = extractList(data)
  if (!list) {
    return {
      records: [],
      errors: [{ message: t('errorUnknownYamlShape') }],
      format: 'yaml',
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

  return { records, errors, format: 'yaml' }
}

function extractList(data: unknown): unknown[] | undefined {
  if (Array.isArray(data)) return data
  if (isPlainRecord(data) && Array.isArray(data.contributors)) {
    return data.contributors
  }
  return undefined
}
