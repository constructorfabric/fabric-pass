/** Auto-detects the file format and dispatches to the right parser. */

import { t } from '../i18n'
import type { ParseResult, SourceKind } from '../types'
import { parseCsv } from './csv'
import { parseJson } from './json'
import { parseYaml } from './yaml'

/** A top-level key like `contributors:`, `github_login:`, etc. */
const YAML_TOP_LEVEL_KEY = /^[A-Za-z_][\w.-]*:(\s|$)/

/**
 * Determines the format by the file name extension, and if there isn't one (or it's
 * unknown) — from the content.
 */
export function detectFormat(text: string, filename?: string): SourceKind {
  return detectFormatDetailed(text, filename).format
}

/** Like {@link detectFormat}, but also reports whether the file extension made the call. */
function detectFormatDetailed(
  text: string,
  filename: string | undefined,
): { format: SourceKind; byExtension: boolean } {
  const byExtension = detectByExtension(filename)
  if (byExtension) return { format: byExtension, byExtension: true }

  const firstChar = text.trimStart()[0]
  if (firstChar === '{' || firstChar === '[') return { format: 'json', byExtension: false }

  const line = firstNonEmptyLine(text)
  if (line.startsWith('- ') || YAML_TOP_LEVEL_KEY.test(line)) {
    return { format: 'yaml', byExtension: false }
  }

  if (line.includes(',') && !line.includes('{')) return { format: 'csv', byExtension: false }

  return { format: 'json', byExtension: false }
}

function firstNonEmptyLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed !== '') return trimmed
  }
  return ''
}

function detectByExtension(filename: string | undefined): SourceKind | undefined {
  const ext = filename?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  if (ext === 'yaml' || ext === 'yml') return 'yaml'
  if (ext === 'json') return 'json'
  if (ext === 'csv') return 'csv'
  return undefined
}

/**
 * Parses text, auto-detecting the format.
 *
 * Content-based heuristics are unreliable (a human writes the file by hand), so for
 * json/yaml determined BY CONTENT (not by file extension) there's a fallback: if the
 * chosen format yields empty `records` and non-empty `errors`, we try the other
 * format in the json/yaml pair — if it parses, its result is returned. If the file
 * extension unambiguously indicated the format, we don't try to guess — an explicit
 * error is more useful than a silent format swap. The fallback doesn't extend to csv.
 */
export function parseAny(text: string, filename?: string): ParseResult {
  const { format, byExtension } = detectFormatDetailed(text, filename)
  const primary = parseByFormat(format, text)

  if (byExtension || format === 'csv') return primary
  if (primary.records.length > 0 || primary.errors.length === 0) return primary

  const fallbackFormat = format === 'json' ? 'yaml' : format === 'yaml' ? 'json' : undefined
  if (!fallbackFormat) return primary

  const fallback = parseByFormat(fallbackFormat, text)
  return fallback.records.length > 0 ? fallback : primary
}

function parseByFormat(format: SourceKind, text: string): ParseResult {
  switch (format) {
    case 'yaml':
      return parseYaml(text)
    case 'json':
      return parseJson(text)
    case 'csv':
      return parseCsv(text)
    default:
      return {
        records: [],
        errors: [{ message: t('errorUnsupportedFormat', format) }],
        format,
      }
  }
}
