/**
 * Pure functions for the popup, factored out from the component for testability
 * without React Testing Library (the project doesn't have it — see `options/logic.ts`,
 * `editor-logic.ts`).
 */

import type { CollectLoginsResponse } from '../../core/messages'
import type { Contributor, MergedIndex, PassStatus, Source } from '../../core/types'
import { recordsToJsonText } from '../options/editor-logic'

/** The popup only works on `https://github.com/*` — on other pages it has nothing to show. */
export function isGithubUrl(url?: string): boolean {
  if (!url) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return parsed.protocol === 'https:' && parsed.hostname === 'github.com'
}

/**
 * Which of the two "nothing to show" screens to display when the content script did not
 * answer the `collect-logins` probe.
 *
 * `url` is `undefined` whenever the extension has no host permission for the tab, so an
 * unknown URL is NOT evidence of being on GitHub: there the honest guess is "you're not
 * on a GitHub page". A URL that *is* known to be GitHub means the script simply isn't
 * injected yet — the page was open before the install or the last reload.
 */
export function statusForSilentContentScript(url?: string): 'not-github' | 'no-content-script' {
  return isGithubUrl(url) ? 'no-content-script' : 'not-github'
}

/**
 * PLAN-PASS.md §6 risk 3: a fresh install with an unsigned-in pass and no manual/url
 * layers shows zero names for everyone, which reads as a broken extension rather than
 * "you're not signed in". The hint is worth showing only if there's actually someone
 * unnamed on the page — a fully named page has nothing to explain.
 */
export function shouldShowPassSignedOutHint(passStatus: PassStatus | undefined, unnamedCount: number): boolean {
  if (unnamedCount === 0) return false
  return passStatus === 'never' || passStatus === 'unauthenticated'
}

export interface SplitLoginsResult {
  /** Logins for which `idx` already provides a display name. */
  named: Array<{ login: string; loginKey: string; displayName: string }>
  /** Logins without a name — exactly the ones that need to be shown with an input field. */
  unnamed: Array<{ login: string; loginKey: string }>
}

/** Splits the page's logins into "named" and "unnamed" based on the current merged index. */
export function splitLogins(response: CollectLoginsResponse, idx: MergedIndex): SplitLoginsResult {
  const named: SplitLoginsResult['named'] = []
  const unnamed: SplitLoginsResult['unnamed'] = []

  for (const entry of response.logins) {
    const indexed = idx[entry.loginKey]
    if (indexed) {
      named.push({ login: entry.login, loginKey: entry.loginKey, displayName: indexed[0] })
    } else {
      unnamed.push({ login: entry.login, loginKey: entry.loginKey })
    }
  }

  return { named, unnamed }
}

/** Builds a `manual` layer record from the popup form: login as on the page, name — the entered text. */
export function buildManualContributor(login: string, name: string): Contributor {
  const trimmedLogin = login.trim()
  return {
    github_login: trimmedLogin,
    login_key: trimmedLogin.toLowerCase(),
    display_name: name.trim(),
  }
}

/**
 * Adds a record to the list or replaces an existing one by `login_key`, without
 * creating duplicates. The order of the other records and the position of the
 * replaced record are preserved.
 */
export function upsertIntoRecords(records: Contributor[], contributor: Contributor): Contributor[] {
  const index = records.findIndex((r) => r.login_key === contributor.login_key)
  if (index === -1) return [...records, contributor]
  return records.map((r, i) => (i === index ? contributor : r))
}

/**
 * Updates the `manual` layer entirely and consistently with `records`: `rawText` is
 * rebuilt from the records (`recordsToJsonText` — the same function the editor's
 * export uses, so the popup and `EditorTab` never disagree on the format), `stats`
 * is recalculated (records from the popup are always valid, otherwise we wouldn't
 * have saved them — `skipped` is empty), and `importedAt` is updated to the current
 * moment.
 *
 * Without this, `EditorTab.loadLayer` (which treats `rawText` as the single source
 * of truth) would keep showing the old text without the records added via the
 * popup, and the next save from the editor would silently erase them.
 */
export function buildUpdatedManualSource(source: Source, records: Contributor[]): Source {
  return {
    ...source,
    rawText: recordsToJsonText(records),
    stats: { total: records.length, imported: records.length, skipped: [] },
    importedAt: new Date().toISOString(),
  }
}
