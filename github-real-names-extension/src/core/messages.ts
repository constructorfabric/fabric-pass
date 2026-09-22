/**
 * Popup/content script ↔ background messaging protocol.
 *
 * The popup has no access to the DOM of the open tab, so it asks the content script
 * to collect logins from the page via `browser.tabs.sendMessage`. The Fabric Pass
 * messages go the other way — content script/UI → background,
 * which is the only context with a stable, persistent pass session cookie and
 * `optional_host_permissions`.
 */

import type { PassMeta, PassStatus } from './types'

/** Request popup → content script: collect user logins from the current page. */
export interface CollectLoginsRequest {
  type: 'ghname:collect-logins'
}

export interface CollectLoginsResponse {
  logins: Array<{
    login: string
    loginKey: string
    /** `true` if a name is already shown next to this login. */
    decorated: boolean
  }>
}

/**
 * Request options → background: fetch the text of a URL source.
 *
 * Background is the only context that makes network requests to arbitrary
 * addresses: it has stable `optional_host_permissions`, unlike the options page.
 */
export interface FetchUrlSourceRequest {
  type: 'ghname:fetch-url'
  url: string
}

export interface FetchUrlSourceResponse {
  ok: boolean
  text?: string
  error?: string
  contentType?: string
}

export function isFetchUrlSourceRequest(message: unknown): message is FetchUrlSourceRequest {
  if (typeof message !== 'object' || message === null) return false
  const candidate = message as Record<string, unknown>
  return candidate.type === 'ghname:fetch-url' && typeof candidate.url === 'string'
}

/**
 * Request content script → background: resolve logins found on the current page
 * against Fabric Pass. See `entrypoints/background/pass.ts` for the batching,
 * negative-cache and rate-limiting behind this.
 */
export interface ResolveLoginsRequest {
  type: 'ghname:resolve-logins'
  logins: string[]
}

export interface ResolveLoginsResponse {
  status: PassStatus
  resolved: number
}

export function isResolveLoginsRequest(message: unknown): message is ResolveLoginsRequest {
  if (typeof message !== 'object' || message === null) return false
  const candidate = message as Record<string, unknown>
  return (
    candidate.type === 'ghname:resolve-logins' &&
    Array.isArray(candidate.logins) &&
    candidate.logins.every((login) => typeof login === 'string')
  )
}

/** Request UI → background: current Fabric Pass status, for the Sources tab (phase 5). */
export interface PassStatusRequest {
  type: 'ghname:pass-status'
}

export type PassStatusResponse = PassMeta & { cachedNames: number }

export function isPassStatusRequest(message: unknown): message is PassStatusRequest {
  if (typeof message !== 'object' || message === null) return false
  return (message as Record<string, unknown>).type === 'ghname:pass-status'
}

/** Request UI → background: manually wipe the Fabric Pass cache ("Clear cache" button, phase 5). */
export interface ClearPassCacheRequest {
  type: 'ghname:clear-pass-cache'
}

export interface ClearPassCacheResponse {
  ok: true
}

export function isClearPassCacheRequest(message: unknown): message is ClearPassCacheRequest {
  if (typeof message !== 'object' || message === null) return false
  return (message as Record<string, unknown>).type === 'ghname:clear-pass-cache'
}

export type ExtensionMessage =
  | CollectLoginsRequest
  | FetchUrlSourceRequest
  | ResolveLoginsRequest
  | PassStatusRequest
  | ClearPassCacheRequest
