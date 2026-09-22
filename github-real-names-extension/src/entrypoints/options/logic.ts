/**
 * Pure functions for the options page, factored out from the components so they
 * can be tested without React Testing Library (the project doesn't have it).
 */

import { PASS_MAX_CACHE_AGE_MS } from '../../core/config'
import { formatName } from '../../core/format'
import { t, uiLocale, type MessageKey } from '../../core/i18n'
import { parseAny } from '../../core/parsers'
import { resolveRecords } from '../../core/resolve'
import type { Contributor, DisplayFormat, ImportStats, ParseError, PassMeta, Source, SkipReason, SourceKind } from '../../core/types'

/**
 * Example from the spec: anatolyb / Anatoly Bobrov. Built from `formatName` (not a
 * fixed string) so the settings preview can never drift from what actually gets
 * inserted into the page — that drift is exactly what caused the `brackets` defect.
 */
export const FORMAT_PREVIEW: Record<DisplayFormat, string> = {
  parens: formatName('anatolyb', 'Anatoly Bobrov', 'parens'),
  brackets: formatName('anatolyb', 'Anatoly Bobrov', 'brackets'),
  'brackets-reversed': formatName('anatolyb', 'Anatoly Bobrov', 'brackets-reversed'),
}

/** Human-readable explanations of skip reasons. We don't show the `SkipReason` codes to the user. */
const SKIP_REASON_KEYS: Record<SkipReason, MessageKey> = {
  no_name: 'skipReasonNoName',
  name_equals_login: 'skipReasonNameEqualsLogin',
  no_login: 'skipReasonNoLogin',
  draft: 'skipReasonDraft',
  agent: 'skipReasonAgent',
  invalid_record: 'skipReasonInvalidRecord',
  duplicate_login: 'skipReasonDuplicateLogin',
}

export function skipReasonLabel(reason: SkipReason): string {
  return t(SKIP_REASON_KEYS[reason])
}

/** JSON export of the layer's skipped records — so the person can fix them and re-import. */
export function buildSkippedExport(source: Source): string {
  const payload = {
    source: source.label,
    kind: source.kind,
    skipped: source.stats.skipped.map((s) => ({
      index: s.index,
      login: s.login,
      reason: s.reason,
      reasonLabel: skipReasonLabel(s.reason),
      detail: s.detail,
    })),
  }
  return JSON.stringify(payload, null, 2)
}

/** `line N, column M: message` for each error, joined with " / ". */
export function formatParseErrors(errors: ParseError[]): string {
  return errors
    .map((e) => {
      const pos =
        e.line !== undefined
          ? e.column !== undefined
            ? t('errorLineColumn', [String(e.line), String(e.column)])
            : t('errorLineOnly', String(e.line))
          : ''
      return `${pos}${e.message}`
    })
    .join(' / ')
}

/** Text summary of the import: how many records, how many skipped, parse errors with position. */
export function formatImportSummary(stats: ImportStats, errors: ParseError[]): string {
  const lines = [t('importSummaryTotal', String(stats.total)), t('importSummaryImported', String(stats.imported))]
  if (stats.skipped.length > 0) {
    lines.push(t('importSummarySkipped', String(stats.skipped.length)))
  }
  if (errors.length > 0) {
    lines.push(t('importSummaryErrors', [String(errors.length), formatParseErrors(errors)]))
  }
  return lines.join(' ')
}

/**
 * Human explanation of `PassMeta.lastStatus`, for the pass layer's status block on
 * the Sources tab — takes the place of the deleted `builtinSyncStatusLabel`. No
 * `default` branch: a future `PassStatus` member must fail the build here rather
 * than silently falling through to the wrong text.
 */
export function passStatusLabel(meta: Pick<PassMeta, 'lastStatus' | 'lastError'>): string {
  switch (meta.lastStatus) {
    case 'never':
      return t('passStatusNever')
    case 'ok':
      return t('passStatusOk')
    case 'unauthenticated':
      return t('passStatusUnauthenticated')
    case 'network-error':
      return t('passStatusNetworkError', meta.lastError ?? t('passStatusNetworkErrorDefault'))
    case 'expired':
      return t('passStatusExpired', String(Math.round(PASS_MAX_CACHE_AGE_MS / 86_400_000)))
  }
}

/** Human-readable import date, in the short format of the current UI locale. */
export function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(uiLocale(), { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

export interface ImportPipelineResult {
  records: Contributor[]
  stats: ImportStats
  errors: ParseError[]
  format: SourceKind
}

/**
 * Glues `parseAny` + `resolveRecords` together — exactly what's needed to import a
 * file in SourcesTab. Preference filters (`showDraft`, bots) aren't applied here —
 * they're decided later, at merge time, so all records that `resolveRecords` didn't
 * filter out as unfixable end up in storage.
 */
export function importPipeline(text: string, filename: string): ImportPipelineResult {
  const parsed = parseAny(text, filename)
  const { records, stats } = resolveRecords(parsed.records)
  return { records, stats, errors: parsed.errors, format: parsed.format }
}

/**
 * The import failed entirely: the shape wasn't recognized / the file wasn't parsed
 * at all — no records at all, and there are parse errors. A shared check for file
 * and URL import (code review Defect 2): doesn't allow replacing a working layer
 * with an empty list of records just because the new file/server response turned
 * out to be broken.
 */
export function importFailed(result: { records: Contributor[]; errors: ParseError[] }): boolean {
  return result.records.length === 0 && result.errors.length > 0
}

/**
 * The single point for downloading a file from the options page. The anchor must be
 * in the document at the moment of `.click()` — some browsers silently do nothing
 * otherwise. The object URL is revoked asynchronously, after the click has already
 * triggered the download, not synchronously right after it (code review Defect 4).
 */
export function downloadJson(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
