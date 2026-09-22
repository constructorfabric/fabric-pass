/**
 * A custom CSV parser (no external libraries). The delimiter is a comma; `;` is not
 * auto-detected. Supports double-quoted fields (commas, line breaks, `""` as an
 * escaped quote inside them) and both line-ending styles.
 *
 * Doesn't normalize names or filter out records — that's handled by `resolve.ts`.
 */

import { t } from '../i18n'
import type { ParseError, ParseResult, RawRecord } from '../types'
import { buildRawRecord } from './record'

export function parseCsv(text: string): ParseResult {
  const { rows, rowLines } = tokenize(text)
  dropTrailingBlankRows(rows, rowLines)

  const header = rows[0]
  if (!header) {
    return {
      records: [],
      errors: [{ message: t('errorCsvEmptyFile') }],
      format: 'csv',
    }
  }

  const records: RawRecord[] = []
  const errors: ParseError[] = []

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue
    const line = rowLines[i]
    const index = i - 1

    if (row.length !== header.length) {
      errors.push({
        line,
        message: t('errorCsvFieldCountMismatch', [String(line ?? '?'), String(header.length), String(row.length)]),
      })
    }

    const raw: Record<string, unknown> = {}
    header.forEach((key, colIdx) => {
      raw[key] = row[colIdx] ?? ''
    })
    records.push(buildRawRecord(raw, index))
  }

  return { records, errors, format: 'csv' }
}

interface Tokenized {
  rows: string[][]
  /** 1-based file line number where each `rows` entry starts. */
  rowLines: number[]
}

function tokenize(text: string): Tokenized {
  const rows: string[][] = []
  const rowLines: number[] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let line = 1
  let rowStartLine = 1
  let i = 0
  const n = text.length

  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    rows.push(row)
    rowLines.push(rowStartLine)
    row = []
  }

  while (i < n) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      if (ch === '\n') line++
      field += ch
      i++
      continue
    }

    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ',') {
      endField()
      i++
      continue
    }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      endRow()
      line++
      rowStartLine = line
      i++
      continue
    }

    field += ch
    i++
  }

  if (field !== '' || row.length > 0) {
    endRow()
  }

  return { rows, rowLines }
}

/** Blank lines at the end of the file aren't records, so they're ignored. */
function dropTrailingBlankRows(rows: string[][], rowLines: number[]): void {
  // rows.length > 1, not > 0: the header row must not be touched, even a degenerate one.
  while (rows.length > 1) {
    const last = rows[rows.length - 1]
    if (!last || !isBlankRow(last)) break
    rows.pop()
    rowLines.pop()
  }
}

function isBlankRow(row: string[]): boolean {
  return row.every((cell) => cell.trim() === '')
}
