import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CollectLoginsResponse } from '../src/core/messages'
import { DEFAULT_SETTINGS, STORAGE_KEYS, type MergedIndex } from '../src/core/types'
import { createMockStorage } from './helpers/mock-storage'

let mock: ReturnType<typeof createMockStorage>

function userAnchor(login: string, text = login): HTMLAnchorElement {
  const a = document.createElement('a')
  a.setAttribute('data-hovercard-url', `/users/${login}/hovercard`)
  a.setAttribute('data-hovercard-type', 'user')
  a.setAttribute('href', `/${login}`)
  a.textContent = text
  return a
}

/** Same trick as in `tests/content.test.ts` — the only way to call `main()` without a typescript-eslint dispute. */
async function runMain(): Promise<void> {
  const module = await import('../src/entrypoints/content/index')
  const contentScript = module.default as unknown as { main: () => unknown }
  await contentScript.main()
}

beforeEach(() => {
  mock = createMockStorage()
  vi.stubGlobal('browser', mock)
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('ghname:collect-logins handler', () => {
  it('registers and responds with a login list even with an empty idx (fresh install)', async () => {
    await mock.storage.local.set({
      [STORAGE_KEYS.idx]: {},
      [STORAGE_KEYS.settings]: DEFAULT_SETTINGS,
    })
    document.body.append(userAnchor('sandy081'), userAnchor('octocat'))

    await runMain()
    const response = mock._dispatchMessage({ type: 'ghname:collect-logins' }) as CollectLoginsResponse

    expect(response.logins).toHaveLength(2)
    expect(response.logins.map((l) => l.loginKey).sort()).toEqual(['octocat', 'sandy081'])
    expect(response.logins.every((l) => l.decorated === false)).toBe(true)
  })

  it('registers even when the extension is disabled (settings.enabled === false)', async () => {
    await mock.storage.local.set({
      [STORAGE_KEYS.idx]: { sandy081: ['Sandeep Somavarapu', 'manual'] } satisfies MergedIndex,
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, enabled: false },
    })
    document.body.append(userAnchor('sandy081'))

    await runMain()
    const response = mock._dispatchMessage({ type: 'ghname:collect-logins' }) as CollectLoginsResponse

    expect(response.logins).toEqual([{ login: 'sandy081', loginKey: 'sandy081', decorated: false }])
  })

  it('decorated: true for a login whose name is already shown on the page', async () => {
    const idx: MergedIndex = { sandy081: ['Sandeep Somavarapu', 'manual'] }
    await mock.storage.local.set({
      [STORAGE_KEYS.idx]: idx,
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, enabled: true },
    })
    document.body.append(userAnchor('sandy081'), userAnchor('octocat'))

    await runMain()
    const response = mock._dispatchMessage({ type: 'ghname:collect-logins' }) as CollectLoginsResponse

    const sandy = response.logins.find((l) => l.loginKey === 'sandy081')
    const octocat = response.logins.find((l) => l.loginKey === 'octocat')
    expect(sandy?.decorated).toBe(true)
    expect(octocat?.decorated).toBe(false)
  })

  it('ignores messages of another type', async () => {
    await mock.storage.local.set({
      [STORAGE_KEYS.idx]: {},
      [STORAGE_KEYS.settings]: DEFAULT_SETTINGS,
    })

    await runMain()
    const response = mock._dispatchMessage({ type: 'some-other-message' })

    expect(response).toBeUndefined()
  })
})
