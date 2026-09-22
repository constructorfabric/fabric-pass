/**
 * Formatting of the "login + real name" pair for display.
 *
 * `formatName` builds the FULL string per format — used in the settings preview
 * (Settings tab) and in tests. The content script (`decorate.ts`) doesn't insert the
 * full string for the two APPENDING formats (`parens`, `brackets`): the login is
 * already visible on the page in the original GitHub link, so only the ADDED part goes
 * into the DOM — see `formatSuffix`. `brackets-reversed` has no such shortcut: the name
 * has to sit BEFORE the login, so the login's own text node is rewritten in place with
 * the full string from `formatReplacement` — see decorate.ts for that insertion
 * strategy. That's why `AppendingFormat` exists: it's the subset of `DisplayFormat` for
 * which "only append a suffix" still makes sense.
 */

import type { DisplayFormat } from './types'

/**
 * parens:            anatolyb (Anatoly Bobrov)
 * brackets:          anatolyb [Anatoly Bobrov]
 * brackets-reversed: Anatoly Bobrov [anatolyb]
 */
export function formatName(login: string, name: string, f: DisplayFormat): string {
  switch (f) {
    case 'brackets':
      return `${login} [${name}]`
    case 'parens':
      return `${login} (${name})`
    case 'brackets-reversed':
      return formatReplacement(login, name)
  }
}

/** Formats that keep the login on the page and append a suffix after it. */
export type AppendingFormat = Exclude<DisplayFormat, 'brackets-reversed'>

/** Whether `f` is one of the formats that append a suffix rather than rewriting the login. */
export function isAppendingFormat(f: DisplayFormat): f is AppendingFormat {
  return f !== 'brackets-reversed'
}

/**
 * Returns only the part that needs to be APPENDED next to the login already visible on
 * the page — the login itself in GitHub's markup must not be touched (it's part of a
 * clickable link). The login is already there, so only the separator and the name are
 * added: ` [Anatoly Bobrov]` / ` (Anatoly Bobrov)`.
 *
 * Narrowed to `AppendingFormat`: `brackets-reversed` puts the name BEFORE the login, so
 * there is no "suffix" for it at all — passing it here would silently produce the wrong
 * output rather than fail to compile. Use `formatReplacement` for that format instead.
 */
export function formatSuffix(name: string, f: AppendingFormat): string {
  switch (f) {
    case 'parens':
      return ` (${name})`
    case 'brackets':
      return ` [${name}]`
  }
}

/**
 * The full text that REPLACES the login for `brackets-reversed`: `Anatoly Bobrov
 * [anatolyb]`. Unlike the appending formats, this format needs the name BEFORE the
 * login, which can't be expressed as a suffix — see decorate.ts for how this string
 * gets written into the page in place of the login's own text.
 */
export function formatReplacement(login: string, name: string): string {
  return `${name} [${login}]`
}
