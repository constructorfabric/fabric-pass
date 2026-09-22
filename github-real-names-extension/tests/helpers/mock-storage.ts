/**
 * In-memory mock of `browser.storage.local` + `browser.storage.onChanged` +
 * `browser.runtime.onMessage`/`sendMessage` for tests.
 *
 * `browser.storage.local`/`browser.runtime` don't exist in vitest/happy-dom — the extension
 * normally gets them from WXT at runtime. Substituted via `vi.stubGlobal('browser', ...)`.
 *
 * `get`/`set`/`remove`/`clear` are regular `vi.fn()`, so the number and arguments of calls
 * are checked through the standard `mock.calls` without a separate counter.
 */

import { vi } from 'vitest'

interface StorageChange {
  oldValue?: unknown
  newValue?: unknown
}

type ChangeListener = (changes: Record<string, StorageChange>, areaName: string) => void

type Keys = string | string[] | Record<string, unknown> | null | undefined

type MessageSendResponse = (response?: unknown) => void

type MessageListener = (message: unknown, sender: Record<string, unknown>, sendResponse: MessageSendResponse) => unknown

export function createMockStorage() {
  let data: Record<string, unknown> = {}
  const listeners = new Set<ChangeListener>()

  function notify(changes: Record<string, StorageChange>): void {
    if (Object.keys(changes).length === 0) return
    for (const listener of listeners) listener(changes, 'local')
  }

  const local = {
    get: vi.fn(async (keys?: Keys) => {
      if (keys === null || keys === undefined) return { ...data }

      const keyList = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys)
      const result: Record<string, unknown> = {}
      for (const key of keyList) {
        if (key in data) result[key] = data[key]
      }
      return result
    }),

    set: vi.fn(async (items: Record<string, unknown>) => {
      const changes: Record<string, StorageChange> = {}
      for (const [key, newValue] of Object.entries(items)) {
        changes[key] = { oldValue: data[key], newValue }
      }
      data = { ...data, ...items }
      notify(changes)
    }),

    remove: vi.fn(async (keys: string | string[]) => {
      const keyList = Array.isArray(keys) ? keys : [keys]
      const changes: Record<string, StorageChange> = {}
      for (const key of keyList) {
        if (key in data) {
          changes[key] = { oldValue: data[key] }
          delete data[key]
        }
      }
      notify(changes)
    }),

    clear: vi.fn(async () => {
      const changes: Record<string, StorageChange> = {}
      for (const key of Object.keys(data)) changes[key] = { oldValue: data[key] }
      data = {}
      notify(changes)
    }),
  }

  const onChanged = {
    addListener: (cb: ChangeListener) => {
      listeners.add(cb)
    },
    removeListener: (cb: ChangeListener) => {
      listeners.delete(cb)
    },
  }

  const messageListeners = new Set<MessageListener>()
  const installedListeners = new Set<() => void>()
  const startupListeners = new Set<() => void>()
  const alarmListeners = new Set<(alarm: { name: string }) => void>()

  const alarms = {
    create: vi.fn(),
    onAlarm: {
      addListener: (cb: (alarm: { name: string }) => void) => {
        alarmListeners.add(cb)
      },
      removeListener: (cb: (alarm: { name: string }) => void) => {
        alarmListeners.delete(cb)
      },
    },
  }

  const runtime = {
    onMessage: {
      addListener: (cb: MessageListener) => {
        messageListeners.add(cb)
      },
      removeListener: (cb: MessageListener) => {
        messageListeners.delete(cb)
      },
    },
    // Content script → background (e.g. `ghname:resolve-logins`) — tests assert on
    // this mock directly rather than routing through `_dispatchMessage`, since the
    // content script never reads the reply.
    sendMessage: vi.fn(async () => undefined),
    onInstalled: {
      addListener: (cb: () => void) => {
        installedListeners.add(cb)
      },
      removeListener: (cb: () => void) => {
        installedListeners.delete(cb)
      },
    },
    onStartup: {
      addListener: (cb: () => void) => {
        startupListeners.add(cb)
      },
      removeListener: (cb: () => void) => {
        startupListeners.delete(cb)
      },
    },
  }

  return {
    storage: { local, onChanged },
    runtime,
    alarms,
    /** Direct access to the contents — for assertions in tests, without going through the API. */
    _dump: () => ({ ...data }),
    /** Synchronously calls all registered `runtime.onInstalled` handlers. */
    _dispatchInstalled: (): void => {
      for (const listener of installedListeners) listener()
    },
    /** Synchronously calls all registered `runtime.onStartup` handlers. */
    _dispatchStartup: (): void => {
      for (const listener of startupListeners) listener()
    },
    /** Synchronously calls all registered `alarms.onAlarm` handlers with `{ name }`. */
    _dispatchAlarm: (name: string): void => {
      for (const listener of alarmListeners) listener({ name })
    },
    /**
     * Synchronously calls all registered `runtime.onMessage` handlers and returns
     * the value passed to the first `sendResponse` call — this is enough for
     * handlers that respond synchronously (see `content/index.ts`).
     */
    _dispatchMessage: (message: unknown, sender: Record<string, unknown> = {}): unknown => {
      let response: unknown
      for (const listener of messageListeners) {
        listener(message, sender, (r) => {
          response = r
        })
      }
      return response
    },
  }
}

export type MockStorage = ReturnType<typeof createMockStorage>
