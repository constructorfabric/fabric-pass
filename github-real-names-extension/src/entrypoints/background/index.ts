/**
 * Background is the only place in the extension that makes network requests.
 *
 * Reason: `optional_host_permissions` is granted to the stable background context,
 * not the options page — the service worker doesn't reload the tab and doesn't lose
 * the permission between user clicks. This is also where the response size and
 * timeout are limited so that a hung internal endpoint doesn't hang the extension
 * (PLAN.md §1, T9). The URL source (T9) and the Fabric Pass resolver (`pass.ts`) both
 * live here for that reason, and share the same timeout — see `./limits`.
 */

import { defineBackground } from 'wxt/utils/define-background'
import { t } from '../../core/i18n'
import { initializeIfNeeded } from '../../core/store'
import {
  isClearPassCacheRequest,
  isFetchUrlSourceRequest,
  isPassStatusRequest,
  isResolveLoginsRequest,
  type FetchUrlSourceResponse,
} from '../../core/messages'
import { formatFetchError, type HttpStatusErrorLike } from '../../core/url-source'
import { FETCH_TIMEOUT_MS, MAX_RESPONSE_BYTES } from './limits'
import { clearPassCache, readPassStatus, resolveLogins, sweepExpired } from './pass'

// Re-exported so existing importers (e.g. tests/url-source.test.ts) keep working
// unchanged after the move to ./limits.
export { MAX_RESPONSE_BYTES, FETCH_TIMEOUT_MS } from './limits'

/** Alarm that periodically evicts an aged-out pass cache — see the registration below for why it exists. */
export const PASS_SWEEP_ALARM = 'ghname:pass-sweep'

function tooLargeMessage(): string {
  const limitMb = MAX_RESPONSE_BYTES / (1024 * 1024)
  return t('errorResponseTooLarge', String(limitMb))
}

function tooLargeResponse(): FetchUrlSourceResponse {
  return { ok: false, error: tooLargeMessage() }
}

/**
 * Fetches the source text from a URL. Never throws — all outcomes, including network
 * and HTTP errors, are returned as `FetchUrlSourceResponse` with `ok: false`.
 */
export async function fetchUrlSource(url: string): Promise<FetchUrlSourceResponse> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(url, { signal: controller.signal })

    if (!response.ok) {
      const httpError: HttpStatusErrorLike = { httpStatus: response.status, httpStatusText: response.statusText }
      throw httpError
    }

    const contentLengthHeader = response.headers.get('content-length')
    if (contentLengthHeader !== null) {
      const declaredLength = Number(contentLengthHeader)
      if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
        return tooLargeResponse()
      }
    }

    const text = await response.text()
    if (text.length > MAX_RESPONSE_BYTES) {
      return tooLargeResponse()
    }

    return { ok: true, text, contentType: response.headers.get('content-type') ?? undefined }
  } catch (e) {
    return { ok: false, error: formatFetchError(e) }
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Initializes storage and then sweeps the pass cache for age — in that order,
 * sequenced explicitly, so the sweep never races `initializeIfNeeded` (e.g. reads a
 * pre-migration `passCache`/`passMeta` shape). Deliberately does NOT resolve any
 * logins here: on startup there's nothing to resolve yet, only once a page reports some.
 */
async function initializeAndSweep(): Promise<void> {
  await initializeIfNeeded()
  await sweepExpired()
}

export default defineBackground(() => {
  // Puts the default settings and the `manual`/`pass` layers into storage right at
  // install time, not just materializing them in memory on the first read — otherwise
  // the first save from the popup could race with a state read where the layers don't
  // exist yet.
  browser.runtime.onInstalled.addListener(() => {
    void initializeAndSweep()
  })

  // Runs on every browser startup too — not just at install: an existing install
  // whose schema is behind the current version needs `initializeIfNeeded` (and the
  // migration inside it) to actually run here, or storage would stay on the old
  // schema until the next install.
  browser.runtime.onStartup.addListener(() => {
    void initializeAndSweep()
  })

  // `resolveLogins` already sweeps before every call, but a tab that never asks about
  // any login would leave an aged-out cache sitting in storage forever, unused but
  // physically present. The requirement is that it disappears — hence a standing
  // hourly alarm rather than relying solely on the lazy sweep.
  browser.alarms.create(PASS_SWEEP_ALARM, { periodInMinutes: 60 })
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === PASS_SWEEP_ALARM) void sweepExpired()
  })

  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (isFetchUrlSourceRequest(message)) {
      fetchUrlSource(message.url).then(sendResponse)
      return true // keep the sendResponse channel open for an async reply
    }
    if (isResolveLoginsRequest(message)) {
      resolveLogins(message.logins).then(sendResponse)
      return true
    }
    if (isPassStatusRequest(message)) {
      readPassStatus().then(sendResponse)
      return true
    }
    if (isClearPassCacheRequest(message)) {
      clearPassCache('manual').then(() => sendResponse({ ok: true }))
      return true
    }
    return undefined
  })
})
