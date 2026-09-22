import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { t } from '../src/core/i18n'
import {
  filenameFromUrl,
  formatFetchError,
  originPattern,
  pickFormatHint,
  validateUrl,
} from '../src/core/url-source'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('validateUrl', () => {
  it('accepts an https address', () => {
    const result = validateUrl('https://example.com/contributors.yaml')
    expect(result.ok).toBe(true)
    expect(result.url?.href).toBe('https://example.com/contributors.yaml')
  })

  it('accepts an http address', () => {
    const result = validateUrl('http://internal.example/mapping.json')
    expect(result.ok).toBe(true)
  })

  it('rejects ftp:', () => {
    const result = validateUrl('ftp://example.com/mapping.json')
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('rejects file:', () => {
    const result = validateUrl('file:///etc/passwd')
    expect(result.ok).toBe(false)
  })

  it('rejects javascript:', () => {
    const result = validateUrl('javascript:alert(1)')
    expect(result.ok).toBe(false)
  })

  it('rejects an empty string', () => {
    const result = validateUrl('   ')
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('rejects garbage that is not a URL at all', () => {
    const result = validateUrl('not a url at all')
    expect(result.ok).toBe(false)
  })
})

describe('originPattern', () => {
  it('without a port', () => {
    expect(originPattern(new URL('https://example.com/contributors.yaml'))).toBe('https://example.com/*')
  })

  it('with a port', () => {
    expect(originPattern(new URL('http://localhost:8080/data.json'))).toBe('http://localhost:8080/*')
  })

  it('with a path — the path does not end up in the pattern', () => {
    expect(originPattern(new URL('https://example.com/team/mapping.csv'))).toBe('https://example.com/*')
  })
})

describe('filenameFromUrl', () => {
  it('returns the last path segment', () => {
    expect(filenameFromUrl(new URL('https://example.com/team/contributors.yaml'))).toBe('contributors.yaml')
  })

  it('empty string if there is no path', () => {
    expect(filenameFromUrl(new URL('https://example.com'))).toBe('')
  })

  it('query parameters do not end up in the name', () => {
    expect(filenameFromUrl(new URL('https://example.com/data.json?token=abc&v=2'))).toBe('data.json')
  })
})

describe('pickFormatHint', () => {
  it('application/json → json', () => {
    expect(pickFormatHint('application/json', new URL('https://example.com/x'))).toBe('json')
  })

  it('text/yaml → yaml', () => {
    expect(pickFormatHint('text/yaml', new URL('https://example.com/x'))).toBe('yaml')
  })

  it('text/csv → csv', () => {
    expect(pickFormatHint('text/csv', new URL('https://example.com/x'))).toBe('csv')
  })

  it('a useless text/plain → determined by the extension in the URL', () => {
    expect(pickFormatHint('text/plain', new URL('https://example.com/contributors.yaml'))).toBe('yaml')
  })

  it('neither content-type nor an extension → undefined', () => {
    expect(pickFormatHint(undefined, new URL('https://example.com/data'))).toBeUndefined()
  })
})

describe('formatFetchError', () => {
  it('a network error (TypeError from fetch)', () => {
    const message = formatFetchError(new TypeError('Failed to fetch'))
    expect(message).toBe(t('errorNetworkUnavailable', 'Failed to fetch'))
  })

  it('a timeout (AbortError)', () => {
    const message = formatFetchError(new DOMException('The operation was aborted', 'AbortError'))
    expect(message).toBe(t('errorTimeout'))
  })

  it('an HTTP status', () => {
    const message = formatFetchError({ httpStatus: 404, httpStatusText: 'Not Found' })
    expect(message).toContain('404')
    expect(message).toContain('Not Found')
  })

  it('an unknown value — does not throw, returns text', () => {
    expect(formatFetchError('something odd')).toBeTruthy()
  })
})

describe('background: fetchUrlSource', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('a successful response returns text and content-type', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: (name: string) => (name === 'content-type' ? 'application/json' : null) },
        text: async () => '{"anatolyb":"Anatoly Bobrov"}',
      })),
    )
    const { fetchUrlSource } = await import('../src/entrypoints/background/index')
    const result = await fetchUrlSource('https://example.com/mapping.json')
    expect(result).toEqual({ ok: true, text: '{"anatolyb":"Anatoly Bobrov"}', contentType: 'application/json' })
  })

  it('a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    const { fetchUrlSource } = await import('../src/entrypoints/background/index')
    const result = await fetchUrlSource('https://example.com/mapping.json')
    expect(result.ok).toBe(false)
    expect(result.error).toBe(t('errorNetworkUnavailable', 'Failed to fetch'))
  })

  it('HTTP 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: { get: () => null },
        text: async () => '',
      })),
    )
    const { fetchUrlSource } = await import('../src/entrypoints/background/index')
    const result = await fetchUrlSource('https://example.com/missing.json')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('404')
  })

  it('a timeout is exceeded', async () => {
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
    const { fetchUrlSource, FETCH_TIMEOUT_MS } = await import('../src/entrypoints/background/index')
    const pending = fetchUrlSource('https://example.com/slow.json')
    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS)
    const result = await pending
    expect(result.ok).toBe(false)
    expect(result.error).toBe(t('errorTimeout'))
  })

  it('the size limit is exceeded by Content-Length', async () => {
    const { MAX_RESPONSE_BYTES } = await import('../src/entrypoints/background/index')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: (name: string) => (name === 'content-length' ? String(MAX_RESPONSE_BYTES + 1) : null) },
        text: async () => 'should not be needed',
      })),
    )
    const { fetchUrlSource } = await import('../src/entrypoints/background/index')
    const result = await fetchUrlSource('https://example.com/huge.json')
    expect(result.ok).toBe(false)
    expect(result.error).toBe(t('errorResponseTooLarge', String(MAX_RESPONSE_BYTES / (1024 * 1024))))
  })

  it('the size limit is exceeded with no Content-Length — based on the actual text read', async () => {
    const { MAX_RESPONSE_BYTES } = await import('../src/entrypoints/background/index')
    const hugeText = 'x'.repeat(MAX_RESPONSE_BYTES + 1)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => null },
        text: async () => hugeText,
      })),
    )
    const { fetchUrlSource } = await import('../src/entrypoints/background/index')
    const result = await fetchUrlSource('https://example.com/huge.json')
    expect(result.ok).toBe(false)
    expect(result.error).toBe(t('errorResponseTooLarge', String(MAX_RESPONSE_BYTES / (1024 * 1024))))
  })
})

describe('background: main — ghname:fetch-url message handler', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('responds with the fetchUrlSource result via sendResponse and keeps the channel open', async () => {
    const addListener = vi.fn()
    vi.stubGlobal('browser', {
      runtime: { onMessage: { addListener }, onInstalled: { addListener: vi.fn() }, onStartup: { addListener: vi.fn() } },
      alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => null },
        text: async () => 'hello',
      })),
    )

    const module = await import('../src/entrypoints/background/index')
    const background = module.default as unknown as { main: () => unknown }
    background.main()

    expect(addListener).toHaveBeenCalledTimes(1)
    const listener = addListener.mock.calls[0]?.[0] as (
      message: unknown,
      sender: unknown,
      sendResponse: (response: unknown) => void,
    ) => unknown
    const sendResponse = vi.fn()
    const keepChannelOpen = listener({ type: 'ghname:fetch-url', url: 'https://example.com/a.json' }, {}, sendResponse)

    expect(keepChannelOpen).toBe(true)
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: true, text: 'hello', contentType: undefined })
    })
  })

  it('ignores messages of another type', async () => {
    const addListener = vi.fn()
    vi.stubGlobal('browser', {
      runtime: { onMessage: { addListener }, onInstalled: { addListener: vi.fn() }, onStartup: { addListener: vi.fn() } },
      alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
    })

    const module = await import('../src/entrypoints/background/index')
    const background = module.default as unknown as { main: () => unknown }
    background.main()

    const listener = addListener.mock.calls[0]?.[0] as (
      message: unknown,
      sender: unknown,
      sendResponse: (response: unknown) => void,
    ) => unknown
    const sendResponse = vi.fn()
    const result = listener({ type: 'ghname:collect-logins' }, {}, sendResponse)

    expect(result).toBeUndefined()
    expect(sendResponse).not.toHaveBeenCalled()
  })

  it('registers onInstalled and materializes the default state in storage (code review defect 1)', async () => {
    const { createMockStorage } = await import('./helpers/mock-storage')
    const mock = createMockStorage()
    vi.stubGlobal('browser', mock)

    const module = await import('../src/entrypoints/background/index')
    const background = module.default as unknown as { main: () => unknown }
    background.main()

    mock._dispatchInstalled()
    await vi.waitFor(() => {
      expect(mock._dump().schemaVersion).toBeDefined()
    })
  })
})
