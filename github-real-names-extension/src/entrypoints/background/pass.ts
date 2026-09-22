/**
 * Fabric Pass resolver: turns logins seen on GitHub pages into display names, lazily,
 * by asking `${PASS_ORIGIN}/api/names` for the ones this extension doesn't already
 * know.
 *
 * `passCache` (see `core/store.ts`) is the source of truth; `records[PASS_SOURCE_ID]`
 * and `idx` are a PROJECTION of it (`projectPassCache`), rebuilt every time the cache
 * changes — never edited directly.
 *
 * THE single most important invariant here: the cache is NEVER wiped because of a
 * 401, a network error or a timeout. Age (`sweepExpired`) is the only reason a cached
 * name ever disappears — a flaky network or a logged-out session must not look like
 * "pass forgot everyone".
 */

import {
  PASS_BATCH_SIZE,
  PASS_ENTRY_TTL_MS,
  PASS_MAX_BATCHES_PER_REQUEST,
  PASS_MAX_CACHE_AGE_MS,
  PASS_MIN_NETWORK_INTERVAL_MS,
  PASS_MISS_TTL_MS,
  PASS_ORIGIN,
} from '../../core/config'
import { t } from '../../core/i18n'
import { projectPassCache } from '../../core/pass-projection'
import { upsertSource } from '../../core/sources'
import { readPassCache, readPassMeta, readState, writePassCache, writePassMeta } from '../../core/store'
import { PASS_SOURCE_ID, type PassCache, type PassCacheEntry, type PassMeta, type PassStatus, type Source } from '../../core/types'
import { formatFetchError, type HttpStatusErrorLike } from '../../core/url-source'
import { FETCH_TIMEOUT_MS } from './limits'

/**
 * Logins currently being asked about, across all in-flight `resolveLogins` calls —
 * module-level so two tabs asking about the same login at the same moment produce one
 * fetch, not two. Every login added here MUST be removed in a `finally`, including on
 * throw, or a single failure would poison that login until the service worker restarts.
 */
const inFlight = new Set<string>()

/**
 * Timestamp (ms) of the last network attempt, module-level so the
 * `PASS_MIN_NETWORK_INTERVAL_MS` spacing holds across separate `resolveLogins` calls,
 * not just within one.
 */
let lastNetworkAt = 0

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Waits out whatever's left of `PASS_MIN_NETWORK_INTERVAL_MS` since the last attempt, then reserves this slot. */
async function waitForNetworkSlot(): Promise<void> {
  const elapsed = Date.now() - lastNetworkAt
  if (elapsed < PASS_MIN_NETWORK_INTERVAL_MS) {
    await sleep(PASS_MIN_NETWORK_INTERVAL_MS - elapsed)
  }
  lastNetworkAt = Date.now()
}

/** Shape the endpoint promises — validated defensively, see `isPassNamesResponse`. */
interface PassNamesResponse {
  names?: Record<string, string>
  unknown?: string[]
}

function isPassNamesResponse(body: unknown): body is PassNamesResponse {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false
  const candidate = body as Record<string, unknown>

  if (candidate.names !== undefined) {
    if (typeof candidate.names !== 'object' || candidate.names === null || Array.isArray(candidate.names)) {
      return false
    }
    if (!Object.values(candidate.names).every((value) => typeof value === 'string')) return false
  }

  if (candidate.unknown !== undefined) {
    if (!Array.isArray(candidate.unknown) || !candidate.unknown.every((value) => typeof value === 'string')) {
      return false
    }
  }

  return true
}

type BatchOutcome =
  | { kind: 'ok'; names: Record<string, string>; unknown: string[] }
  | { kind: 'unauthenticated' }
  | { kind: 'network-error'; message: string }

/**
 * A single request for one batch. Never throws — every outcome (timeout, network
 * error, non-OK status, malformed body) comes back as `{ kind: 'network-error' }`
 * except 401, which is its own `unauthenticated` outcome (not an error).
 */
async function fetchBatch(batch: string[]): Promise<BatchOutcome> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const query = batch.map((login) => encodeURIComponent(login)).join(',')
    const response = await fetch(`${PASS_ORIGIN}/api/names?logins=${query}`, {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    })

    if (response.status === 401) {
      return { kind: 'unauthenticated' }
    }

    if (!response.ok) {
      // Covers 400 (shouldn't happen — we respect the endpoint's own batch limit) and
      // anything else non-OK. Same handling either way: not the cache's problem.
      const httpError: HttpStatusErrorLike = { httpStatus: response.status, httpStatusText: response.statusText }
      return { kind: 'network-error', message: formatFetchError(httpError) }
    }

    const body = await response.json().catch(() => undefined)
    if (!isPassNamesResponse(body)) {
      return { kind: 'network-error', message: t('errorPassMalformedResponse') }
    }

    return { kind: 'ok', names: body.names ?? {}, unknown: body.unknown ?? [] }
  } catch (e) {
    return { kind: 'network-error', message: formatFetchError(e) }
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Persists `cache` as `records[PASS_SOURCE_ID]` and rebuilds `idx` — the one place
 * that turns the cache (source of truth) into the layer machinery's shape. Used by
 * both a successful resolve and `clearPassCache`, so a fill and a wipe go through
 * exactly the same projection. `upsertSource` keeps the layer's existing position and
 * calls `rebuildIndex()` itself — don't rebuild twice.
 */
async function writeLayer(cache: PassCache): Promise<void> {
  const state = await readState()
  const existing = state.sources.find((s) => s.id === PASS_SOURCE_ID)
  const base: Source =
    existing ?? {
      id: PASS_SOURCE_ID,
      kind: 'pass',
      label: t('sourcesPassDefaultLabel'),
      enabled: true,
      importedAt: new Date().toISOString(),
      stats: { total: 0, imported: 0, skipped: [] },
    }

  const { records, stats } = projectPassCache(cache)
  await upsertSource({ ...base, importedAt: new Date().toISOString(), stats }, records)
}

/**
 * The ONLY thing that ever deletes cached names. A no-op (fresh `lastAuthOkAt`, or an
 * already-empty cache) doesn't write anything — a wipe would fire a storage-change
 * event that every open GitHub tab reacts to by redecorating, and an empty cache has
 * nothing to redecorate for.
 */
export async function sweepExpired(): Promise<boolean> {
  const cache = await readPassCache()
  if (Object.keys(cache).length === 0) return false

  const meta = await readPassMeta()
  // An absent OR unparseable `lastAuthOkAt` is treated the same: we can't date this
  // cache's provenance, so it's stale.
  const parsedAuthOkAt = meta.lastAuthOkAt ? Date.parse(meta.lastAuthOkAt) : NaN
  const isStale = Number.isNaN(parsedAuthOkAt) || Date.now() - parsedAuthOkAt > PASS_MAX_CACHE_AGE_MS
  if (!isStale) return false

  await clearPassCache('expired')
  return true
}

/**
 * Wipes the pass cache and layer. `lastAuthOkAt` is NEVER cleared here — it's the "you
 * were last signed into pass at ..." timestamp the UI shows, and clearing it would
 * also make the very next `sweepExpired` treat an already-empty cache as stale
 * forever (absent `lastAuthOkAt` + non-empty cache = wipe; here the cache is empty
 * either way, but there's no reason to throw away a value the UI still needs).
 */
export async function clearPassCache(reason: 'expired' | 'manual'): Promise<void> {
  const meta = await readPassMeta()

  await writePassCache({})
  await writeLayer({})

  const nextMeta: PassMeta = { lastStatus: reason === 'expired' ? 'expired' : 'never' }
  if (meta.lastAuthOkAt) nextMeta.lastAuthOkAt = meta.lastAuthOkAt
  await writePassMeta(nextMeta)
}

/** `true` if `entry` is old enough (by its own kind's TTL) to be asked again. An unparseable `fetchedAt` counts as stale. */
function isStaleEntry(entry: PassCacheEntry, now: number): boolean {
  const fetchedAt = Date.parse(entry.fetchedAt)
  if (Number.isNaN(fetchedAt)) return true
  const ttl = entry.name === null ? PASS_MISS_TTL_MS : PASS_ENTRY_TTL_MS
  return now - fetchedAt > ttl
}

/**
 * Resolves `logins` against Fabric Pass, filling `passCache` (and re-projecting it
 * into the pass layer) as far as this call's batch budget allows.
 *
 * `resolved` counts only NAMES obtained in this call (positive cache entries) —
 * logins pass came back not knowing about don't count, even though they're cached
 * too (negatively), so the caller can tell "we asked and got nothing" from "we got N
 * names".
 */
export async function resolveLogins(logins: string[]): Promise<{ status: PassStatus; resolved: number }> {
  await sweepExpired()

  const state = await readState()
  const passSource = state.sources.find((s) => s.id === PASS_SOURCE_ID)
  const currentMeta = await readPassMeta()

  // A disabled layer must not generate traffic — the content script guards this too
  // (phase 4), but this is the guard that actually matters.
  if (passSource?.enabled === false) {
    return { status: currentMeta.lastStatus, resolved: 0 }
  }

  const normalized = Array.from(new Set(logins.map((login) => login.trim().toLowerCase()).filter((login) => login !== '')))

  const cache = await readPassCache()
  const now = Date.now()
  const needsAsking = normalized.filter((login) => {
    const entry = cache[login]
    return !entry || isStaleEntry(entry, now)
  })

  // Checking `inFlight` and adding to it happens in one synchronous stretch (no
  // `await` in between) so two concurrent calls for the same login can't both decide
  // to fetch it — whichever call's synchronous code runs first claims the login.
  const toAsk = needsAsking.filter((login) => !inFlight.has(login))
  if (toAsk.length === 0) {
    return { status: currentMeta.lastStatus, resolved: 0 }
  }
  for (const login of toAsk) inFlight.add(login)

  try {
    const batches: string[][] = []
    for (let i = 0; i < toAsk.length && batches.length < PASS_MAX_BATCHES_PER_REQUEST; i += PASS_BATCH_SIZE) {
      batches.push(toAsk.slice(i, i + PASS_BATCH_SIZE))
    }
    // Anything past PASS_MAX_BATCHES_PER_REQUEST batches is deliberately DROPPED, not
    // queued — the next page view's resolveLogins call will ask again. Do not "fix"
    // this into a persistent queue; that's the whole point of the lazy, per-visit design.

    let resolved = 0
    let cacheChanged = false
    const workingCache: PassCache = { ...cache }
    let metaPatch: PassMeta = { ...currentMeta }

    for (const batch of batches) {
      await waitForNetworkSlot()
      const outcome = await fetchBatch(batch)

      if (outcome.kind === 'ok') {
        const fetchedAt = new Date().toISOString()
        for (const login of batch) {
          const name = outcome.names[login]
          if (name !== undefined) {
            workingCache[login] = { name, fetchedAt }
            resolved++
          } else {
            // Negative cache: covers both an explicit `unknown` entry and a login the
            // server simply didn't mention at all — without this, a partially
            // answering server would cause an infinite re-ask loop.
            workingCache[login] = { name: null, fetchedAt }
          }
        }
        cacheChanged = true
        metaPatch = { lastAuthOkAt: fetchedAt, lastStatus: 'ok' }
        continue
      }

      if (outcome.kind === 'unauthenticated') {
        metaPatch = { lastStatus: 'unauthenticated' }
        if (currentMeta.lastAuthOkAt) metaPatch.lastAuthOkAt = currentMeta.lastAuthOkAt
        break
      }

      // network-error: non-OK status, thrown error, timeout, or malformed body.
      metaPatch = { lastStatus: 'network-error', lastError: outcome.message }
      if (currentMeta.lastAuthOkAt) metaPatch.lastAuthOkAt = currentMeta.lastAuthOkAt
      break
    }

    await writePassMeta(metaPatch)

    if (cacheChanged) {
      await writePassCache(workingCache)
      await writeLayer(workingCache)
    }

    return { status: metaPatch.lastStatus, resolved }
  } finally {
    for (const login of toAsk) inFlight.delete(login)
  }
}

/** For the UI (phase 5): pass status plus how many names (positive entries) are currently cached. */
export async function readPassStatus(): Promise<PassMeta & { cachedNames: number }> {
  const [meta, cache] = await Promise.all([readPassMeta(), readPassCache()])
  const cachedNames = Object.values(cache).filter((entry) => entry.name !== null).length
  return { ...meta, cachedNames }
}
