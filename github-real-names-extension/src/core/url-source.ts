/**
 * Pure functions for the URL source (PLAN.md §1, T9).
 *
 * Writes nothing to storage, requests no permissions, and makes no network calls — the
 * network is handled by `background` (it has stable permissions), while these
 * functions only validate input, compute the origin for `permissions.request`, and
 * parse the response.
 */

import { t } from './i18n'

/** The format `pickFormatHint` can suggest — a subset of `SourceKind` from the file parsers. */
export type FormatHint = 'json' | 'yaml' | 'csv'

export interface UrlValidationResult {
  ok: boolean
  url?: URL
  error?: string
}

/** Only `http:`/`https:` — `file:`/`ftp:`/`javascript:` and the rest are rejected with a clear reason. */
export function validateUrl(input: string): UrlValidationResult {
  const trimmed = input.trim()
  if (trimmed === '') {
    return { ok: false, error: t('errorUrlEmpty') }
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { ok: false, error: t('errorUrlInvalid') }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: t('errorUrlUnsupportedProtocol', parsed.protocol) }
  }

  return { ok: true, url: parsed }
}

/**
 * Origin pattern for `browser.permissions.request({ origins: [...] })`. The origin
 * requested is for the SPECIFIC address, not the whole `optional_host_permissions` —
 * that broad pattern is only declared in the manifest, and is confirmed by the user
 * separately for each new host.
 */
export function originPattern(url: URL): string {
  return `${url.protocol}//${url.host}/*`
}

/** Last segment of the path (query and hash are ignored). Empty if there's no path. */
export function filenameFromUrl(url: URL): string {
  const segments = url.pathname.split('/').filter((segment) => segment !== '')
  return segments.length > 0 ? segments[segments.length - 1]! : ''
}

const CONTENT_TYPE_HINTS: Record<string, FormatHint> = {
  'application/json': 'json',
  'text/json': 'json',
  'application/yaml': 'yaml',
  'application/x-yaml': 'yaml',
  'text/yaml': 'yaml',
  'text/x-yaml': 'yaml',
  'text/csv': 'csv',
  'application/csv': 'csv',
}

/** Content-Type that tells us nothing about the format — the server sent it "just in case". */
const USELESS_CONTENT_TYPES = new Set(['text/plain', 'application/octet-stream'])

function hintFromExtension(url: URL): FormatHint | undefined {
  const ext = filenameFromUrl(url).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  if (ext === 'yaml' || ext === 'yml') return 'yaml'
  if (ext === 'json') return 'json'
  if (ext === 'csv') return 'csv'
  return undefined
}

/**
 * Determines the response format from the `Content-Type` header, and if that's
 * useless (`text/plain`, `application/octet-stream`) or absent/unknown — from the
 * extension in the URL path. `undefined` if neither helped: then `parseAny` figures
 * it out from the content itself.
 */
export function pickFormatHint(contentType: string | undefined, url: URL): FormatHint | undefined {
  const mime = contentType?.split(';')[0]?.trim().toLowerCase()
  if (mime && !USELESS_CONTENT_TYPES.has(mime)) {
    const hint = CONTENT_TYPE_HINTS[mime]
    if (hint) return hint
  }
  return hintFromExtension(url)
}

/** Synthetic filename for `parseAny(text, filename)`, built from the format hint. */
export function parseFilenameHint(contentType: string | undefined, url: URL): string | undefined {
  const hint = pickFormatHint(contentType, url)
  return hint ? `source.${hint}` : undefined
}

/** The object thrown by background's `fetchUrlSource` on an unsuccessful HTTP status. See `formatFetchError`. */
export interface HttpStatusErrorLike {
  httpStatus: number
  httpStatusText?: string
}

function isHttpStatusErrorLike(e: unknown): e is HttpStatusErrorLike {
  return typeof e === 'object' && e !== null && typeof (e as Record<string, unknown>).httpStatus === 'number'
}

/**
 * A user-friendly fetch error message: HTTP status, timeout (`AbortError`), network
 * error (`TypeError` from `fetch`), or whatever's left.
 */
export function formatFetchError(e: unknown): string {
  if (isHttpStatusErrorLike(e)) {
    const statusText = e.httpStatusText ? ` ${e.httpStatusText}` : ''
    return t('errorHttpStatus', [String(e.httpStatus), statusText])
  }
  if (e instanceof Error && e.name === 'AbortError') {
    return t('errorTimeout')
  }
  if (e instanceof TypeError) {
    return t('errorNetworkUnavailable', e.message)
  }
  if (e instanceof Error) {
    return e.message
  }
  return t('errorUnknownFetch')
}
