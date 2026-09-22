/**
 * Fabric Pass resolver (`entrypoints/background/pass.ts`, PLAN-PASS.md §3). Replaces
 * the deleted `tests/background-builtin-sync.test.ts`.
 *
 * `pass.ts` keeps module-level state (the in-flight `Set`, the last-network
 * timestamp) that must not leak between tests, so every test starts with
 * `vi.resetModules()` and re-imports `pass.ts` (and anything it shares state
 * through, like `core/store.ts`) fresh — same pattern as `tests/store.test.ts` and
 * the "background: fetchUrlSource" block in `tests/url-source.test.ts`.
 *
 * Batch spacing (`PASS_MIN_NETWORK_INTERVAL_MS`) is exercised with real fake timers
 * (`vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync`) rather than skipped, so the
 * spacing logic itself is actually under test, not just assumed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PASS_BATCH_SIZE, PASS_MAX_BATCHES_PER_REQUEST, PASS_MAX_CACHE_AGE_MS, PASS_MIN_NETWORK_INTERVAL_MS } from '../src/core/config'
import { MANUAL_SOURCE_ID, PASS_SOURCE_ID, type Contributor, type PassCache, type PassMeta } from '../src/core/types'
import { createMockStorage } from './helpers/mock-storage'

let mock: ReturnType<typeof createMockStorage>

/** Generic fetch stub: answers every login it was asked about as `unknown`, matching the endpoint's shape. */
function fetchAllUnknown(): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    const requested = new URL(url).searchParams.get('logins')?.split(',') ?? []
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ names: {}, unknown: requested }),
    }
  })
}

function contributor(login: string, name: string): Contributor {
  return { github_login: login, login_key: login.toLowerCase(), display_name: name }
}

beforeEach(() => {
  mock = createMockStorage()
  vi.stubGlobal('browser', mock)
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('resolveLogins — batching', () => {
  it('150 unknown logins are asked in two batches of 100 and 50, both hitting /api/names', async () => {
    const { initializeIfNeeded } = await import('../src/core/store')
    await initializeIfNeeded()

    const logins = Array.from({ length: 150 }, (_, i) => `user${i}`)
    const fetchMock = fetchAllUnknown()
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()

    const { resolveLogins } = await import('../src/entrypoints/background/pass')
    const pending = resolveLogins(logins)
    await vi.advanceTimersByTimeAsync(PASS_MIN_NETWORK_INTERVAL_MS)
    const result = await pending

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstUrl = new URL(fetchMock.mock.calls[0]?.[0] as string)
    const secondUrl = new URL(fetchMock.mock.calls[1]?.[0] as string)
    expect(firstUrl.searchParams.get('logins')?.split(',')).toHaveLength(PASS_BATCH_SIZE)
    expect(secondUrl.searchParams.get('logins')?.split(',')).toHaveLength(50)
    expect(result.status).toBe('ok')
    expect(result.resolved).toBe(0) // all came back as `unknown`, negative cache doesn't count
  })

  it('more logins than PASS_BATCH_SIZE * PASS_MAX_BATCHES_PER_REQUEST → only that many batches go out, no error', async () => {
    const { initializeIfNeeded } = await import('../src/core/store')
    await initializeIfNeeded()

    const total = PASS_BATCH_SIZE * PASS_MAX_BATCHES_PER_REQUEST + 100
    const logins = Array.from({ length: total }, (_, i) => `user${i}`)
    const fetchMock = fetchAllUnknown()
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()

    const { resolveLogins } = await import('../src/entrypoints/background/pass')
    const pending = resolveLogins(logins)
    await vi.advanceTimersByTimeAsync(PASS_MIN_NETWORK_INTERVAL_MS * PASS_MAX_BATCHES_PER_REQUEST)
    const result = await pending

    expect(fetchMock).toHaveBeenCalledTimes(PASS_MAX_BATCHES_PER_REQUEST)
    expect(result.status).toBe('ok')
  })
})

describe('resolveLogins — negative cache', () => {
  it('a login returned in `unknown` is cached negatively: a second call makes no further fetch', async () => {
    const { initializeIfNeeded } = await import('../src/core/store')
    await initializeIfNeeded()

    const fetchMock = fetchAllUnknown()
    vi.stubGlobal('fetch', fetchMock)

    const { resolveLogins } = await import('../src/entrypoints/background/pass')
    await resolveLogins(['bob'])
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await resolveLogins(['bob'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a login asked for but absent from both `names` and `unknown` is also cached negatively', async () => {
    const { initializeIfNeeded } = await import('../src/core/store')
    await initializeIfNeeded()

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ names: {}, unknown: [] }), // server says nothing about 'ghost'
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { resolveLogins } = await import('../src/entrypoints/background/pass')
    await resolveLogins(['ghost'])

    const { readPassCache } = await import('../src/core/store')
    const cache = await readPassCache()
    expect(cache.ghost).toEqual({ name: null, fetchedAt: expect.any(String) })

    // Cached negatively → a second call must not fetch again.
    await resolveLogins(['ghost'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('resolveLogins — deduplication', () => {
  it('two concurrent calls for the same login produce exactly one fetch', async () => {
    const { initializeIfNeeded } = await import('../src/core/store')
    await initializeIfNeeded()

    const fetchMock = fetchAllUnknown()
    vi.stubGlobal('fetch', fetchMock)

    const { resolveLogins } = await import('../src/entrypoints/background/pass')
    await Promise.all([resolveLogins(['alice']), resolveLogins(['alice'])])

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('resolveLogins — success', () => {
  it('writes names into passCache, projects them into the pass layer and idx', async () => {
    const { initializeIfNeeded, readPassCache, readState } = await import('../src/core/store')
    await initializeIfNeeded()

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ names: { alice: 'Alice Smith' }, unknown: ['bob'] }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { resolveLogins } = await import('../src/entrypoints/background/pass')
    const result = await resolveLogins(['alice', 'bob'])

    expect(result.resolved).toBe(1) // only the positive entry counts

    const cache = await readPassCache()
    expect(cache.alice?.name).toBe('Alice Smith')
    expect(cache.bob).toEqual({ name: null, fetchedAt: expect.any(String) })

    const state = await readState()
    expect(state.records[PASS_SOURCE_ID]?.some((r) => r.login_key === 'alice' && r.display_name === 'Alice Smith')).toBe(
      true,
    )
    expect(state.idx.alice).toEqual(['Alice Smith', PASS_SOURCE_ID])
  })

  it('sets lastAuthOkAt and lastStatus: "ok" on success', async () => {
    const { initializeIfNeeded, readPassMeta } = await import('../src/core/store')
    await initializeIfNeeded()

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ names: { alice: 'Alice Smith' }, unknown: [] }),
      })),
    )

    const { resolveLogins } = await import('../src/entrypoints/background/pass')
    await resolveLogins(['alice'])

    const meta = await readPassMeta()
    expect(meta.lastStatus).toBe('ok')
    expect(meta.lastAuthOkAt).toBeTruthy()
  })
})

describe('resolveLogins — 401', () => {
  it('sets lastStatus: "unauthenticated", leaves the cache untouched, and stops sending remaining batches', async () => {
    const { initializeIfNeeded, readPassCache, readPassMeta } = await import('../src/core/store')
    await initializeIfNeeded()

    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({}),
    }))
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()

    const logins = Array.from({ length: 150 }, (_, i) => `user${i}`) // would be 2 batches
    const { resolveLogins } = await import('../src/entrypoints/background/pass')
    const pending = resolveLogins(logins)
    await vi.advanceTimersByTimeAsync(PASS_MIN_NETWORK_INTERVAL_MS)
    await pending

    expect(fetchMock).toHaveBeenCalledTimes(1) // second batch never sent

    const meta = await readPassMeta()
    expect(meta.lastStatus).toBe('unauthenticated')

    const cache = await readPassCache()
    expect(cache).toEqual({})
  })
})

describe('resolveLogins — network failure', () => {
  it('a non-OK status sets lastStatus: "network-error" with a message, cache unchanged', async () => {
    const { initializeIfNeeded, readPassCache, readPassMeta } = await import('../src/core/store')
    await initializeIfNeeded()

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({}),
      })),
    )

    const { resolveLogins } = await import('../src/entrypoints/background/pass')
    await resolveLogins(['alice'])

    const meta = await readPassMeta()
    expect(meta.lastStatus).toBe('network-error')
    expect(meta.lastError).toBeTruthy()

    const cache = await readPassCache()
    expect(cache).toEqual({})
  })

  it('a timeout (abort) sets lastStatus: "network-error", cache unchanged', async () => {
    const { initializeIfNeeded, readPassCache, readPassMeta } = await import('../src/core/store')
    await initializeIfNeeded()

    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
          }),
      ),
    )

    const { resolveLogins } = await import('../src/entrypoints/background/pass')
    const { FETCH_TIMEOUT_MS } = await import('../src/entrypoints/background/limits')
    const pending = resolveLogins(['alice'])
    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS)
    await pending

    const meta = await readPassMeta()
    expect(meta.lastStatus).toBe('network-error')

    const cache = await readPassCache()
    expect(cache).toEqual({})
  })

  it('a malformed JSON body is treated as a network error, cache unchanged, without throwing', async () => {
    const { initializeIfNeeded, readPassCache, readPassMeta } = await import('../src/core/store')
    await initializeIfNeeded()

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => {
          throw new SyntaxError('Unexpected token')
        },
      })),
    )

    const { resolveLogins } = await import('../src/entrypoints/background/pass')
    await expect(resolveLogins(['alice'])).resolves.not.toThrow()

    const meta = await readPassMeta()
    expect(meta.lastStatus).toBe('network-error')

    const cache = await readPassCache()
    expect(cache).toEqual({})
  })
})

describe('resolveLogins — disabled layer', () => {
  it('makes no fetch when the pass layer is disabled', async () => {
    const { initializeIfNeeded } = await import('../src/core/store')
    await initializeIfNeeded()
    const { setEnabled } = await import('../src/core/sources')
    await setEnabled(PASS_SOURCE_ID, false)

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { resolveLogins } = await import('../src/entrypoints/background/pass')
    await resolveLogins(['alice'])

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('sweepExpired', () => {
  it('a fresh lastAuthOkAt → returns false, writes nothing', async () => {
    const { initializeIfNeeded, writePassCache, writePassMeta } = await import('../src/core/store')
    await initializeIfNeeded()
    await writePassCache({ alice: { name: 'Alice Smith', fetchedAt: new Date().toISOString() } } satisfies PassCache)
    await writePassMeta({ lastAuthOkAt: new Date().toISOString(), lastStatus: 'ok' } satisfies PassMeta)
    mock.storage.local.set.mockClear()

    const { sweepExpired } = await import('../src/entrypoints/background/pass')
    const wiped = await sweepExpired()

    expect(wiped).toBe(false)
    expect(mock.storage.local.set).not.toHaveBeenCalled()
  })

  it('past PASS_MAX_CACHE_AGE_MS → empties the pass cache/layer/idx, sets lastStatus: "expired", keeps lastAuthOkAt, leaves manual layer untouched', async () => {
    const { initializeIfNeeded, readState, readPassCache, readPassMeta, writePassMeta } = await import('../src/core/store')
    const { upsertSource } = await import('../src/core/sources')
    await initializeIfNeeded()

    const manualBefore = (await readState()).sources.find((s) => s.id === MANUAL_SOURCE_ID)!
    await upsertSource(manualBefore, [contributor('carol', 'Carol Manual')])

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ names: { alice: 'Alice Smith' }, unknown: [] }),
      })),
    )
    const { resolveLogins, sweepExpired } = await import('../src/entrypoints/background/pass')
    await resolveLogins(['alice'])

    const oldAuthOkAt = new Date(Date.now() - PASS_MAX_CACHE_AGE_MS - 1000).toISOString()
    const metaBeforeSweep = await readPassMeta()
    await writePassMeta({ ...metaBeforeSweep, lastAuthOkAt: oldAuthOkAt })

    const wiped = await sweepExpired()
    expect(wiped).toBe(true)

    const cache = await readPassCache()
    expect(cache).toEqual({})

    const state = await readState()
    expect(state.records[PASS_SOURCE_ID]).toEqual([])
    expect(state.idx.alice).toBeUndefined()
    expect(state.idx.carol).toEqual(['Carol Manual', MANUAL_SOURCE_ID])
    expect(state.records[MANUAL_SOURCE_ID]).toEqual([contributor('carol', 'Carol Manual')])

    const meta = await readPassMeta()
    expect(meta.lastStatus).toBe('expired')
    expect(meta.lastAuthOkAt).toBe(oldAuthOkAt)
  })

  it('a non-empty cache with no lastAuthOkAt → wipes', async () => {
    const { initializeIfNeeded, writePassCache, readPassCache } = await import('../src/core/store')
    await initializeIfNeeded()
    await writePassCache({ alice: { name: 'Alice Smith', fetchedAt: new Date().toISOString() } } satisfies PassCache)

    const { sweepExpired } = await import('../src/entrypoints/background/pass')
    const wiped = await sweepExpired()

    expect(wiped).toBe(true)
    expect(await readPassCache()).toEqual({})
  })
})

describe('background entrypoint — pass-sweep alarm', () => {
  it('the alarm listener registered on startup calls sweepExpired', async () => {
    const { initializeIfNeeded, writePassCache, writePassMeta, readPassCache } = await import('../src/core/store')
    await initializeIfNeeded()
    await writePassCache({ alice: { name: 'Alice Smith', fetchedAt: new Date().toISOString() } } satisfies PassCache)
    // No lastAuthOkAt at all → sweepExpired treats this cache as stale.
    await writePassMeta({ lastStatus: 'never' } satisfies PassMeta)

    const module = await import('../src/entrypoints/background/index')
    const background = module.default as unknown as { main: () => unknown }
    background.main()

    mock._dispatchAlarm(module.PASS_SWEEP_ALARM)

    await vi.waitFor(async () => {
      expect(await readPassCache()).toEqual({})
    })
  })
})
