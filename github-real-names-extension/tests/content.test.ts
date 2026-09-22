import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResolveLoginsRequest } from '../src/core/messages'
import { DEFAULT_SETTINGS, STORAGE_KEYS, type MergedIndex } from '../src/core/types'
import { createMockStorage } from './helpers/mock-storage'

let mock: ReturnType<typeof createMockStorage>

// The content script gives no external way to stop its MutationObserver — wrap the
// global constructor to track every created instance and disconnect them in
// afterEach. Without this, an observer left over from a previous test keeps
// hanging on `document.body` in subsequent tests.
let createdObservers: MutationObserver[] = []

function userAnchor(login: string, text = login): HTMLAnchorElement {
  const a = document.createElement('a')
  a.setAttribute('data-hovercard-url', `/users/${login}/hovercard`)
  a.setAttribute('data-hovercard-type', 'user')
  a.setAttribute('href', `/${login}`)
  a.textContent = text
  return a
}

/** The only way to call `main()` without a typescript-eslint dispute over the `ContentScriptDefinition` union type. */
async function runMain(): Promise<void> {
  const module = await import('../src/entrypoints/content/index')
  const contentScript = module.default as unknown as { main: () => unknown }
  await contentScript.main()
}

beforeEach(() => {
  mock = createMockStorage()
  vi.stubGlobal('browser', mock)
  document.body.innerHTML = ''

  const RealMutationObserver = MutationObserver
  class TrackingMutationObserver extends RealMutationObserver {
    constructor(callback: MutationCallback) {
      super(callback)
      createdObservers.push(this)
    }
  }
  vi.stubGlobal('MutationObserver', TrackingMutationObserver)
})

afterEach(async () => {
  for (const observer of createdObservers) observer.disconnect()
  createdObservers = []
  vi.useRealTimers()

  // Unconditionally disables — same rationale as `createdObservers` above, but for
  // the ~300ms login-report timer (PLAN-PASS.md §4): `main()` registers the
  // storage listener before any early exit, so this reaches every test regardless
  // of what it did. Without it, a test that starts observing and never disables
  // again leaves a real, still-pending report timer that can fire during a LATER
  // test — scanning THAT test's `document.body` against THIS test's stale
  // `idx`/`askedLogins` — and inflate its `sendMessage` call count.
  await mock.storage.local.set({ [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, enabled: false } })
  // `set()` resolving only means `onChanged` listeners were invoked SYNCHRONOUSLY;
  // the content script's own handler is a fire-and-forget async IIFE — one real
  // macrotask is enough for its awaits (`readIdx`/`readSettings`) to settle and
  // `stopObserving()` to actually run before the module is torn down below.
  await new Promise((resolve) => setTimeout(resolve, 0))

  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  vi.resetModules()
})

describe('main — early exit', () => {
  it('settings.enabled === false → MutationObserver is not created, even if idx is filled', async () => {
    const idx: MergedIndex = { sandy081: ['Sandeep Somavarapu', 'manual'] }
    await mock.storage.local.set({
      [STORAGE_KEYS.idx]: idx,
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, enabled: false },
    })
    const ctor = vi.fn()
    class FakeObserver {
      constructor(...args: unknown[]) {
        ctor(...args)
      }
      observe(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('MutationObserver', FakeObserver)

    await runMain()

    expect(ctor).not.toHaveBeenCalled()
  })
})

describe('main — normal operation', () => {
  it('initial pass, mutation batching, turbo navigation, mapping change and shadow DOM', async () => {
    const idx: MergedIndex = {
      sandy081: ['Sandeep Somavarapu', 'manual'],
      octocat: ['The Octocat', 'manual'],
      hubot: ['Hubot', 'manual'],
      shadowuser1: ['Shadow One', 'manual'],
      shadowuser2: ['Shadow Two', 'manual'],
    }
    await mock.storage.local.set({
      [STORAGE_KEYS.idx]: idx,
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, enabled: true, displayFormat: 'brackets' },
    })

    // Shadow DOM present BEFORE the initial pass — traversed recursively.
    const shadowHost1 = document.createElement('div')
    document.body.appendChild(shadowHost1)
    const shadowRoot1 = shadowHost1.attachShadow({ mode: 'open' })
    const shadowAnchor1 = userAnchor('shadowuser1')
    shadowRoot1.appendChild(shadowAnchor1)

    // Initial markup: the known link is decorated, the unknown one (last in body) is not.
    const known = userAnchor('sandy081')
    const unknownLogin = userAnchor('unknownUser')
    document.body.append(known, unknownLogin)

    await runMain()

    expect(known.nextElementSibling?.textContent).toBe(' [Sandeep Somavarapu]')
    expect(unknownLogin.nextElementSibling).toBeNull()
    expect(shadowAnchor1.nextElementSibling?.textContent).toBe(' [Shadow One]')

    // Mutation on body: processed in a batch on requestAnimationFrame, not synchronously.
    const dynamic = userAnchor('octocat')
    document.body.appendChild(dynamic)
    expect(dynamic.nextElementSibling).toBeNull()
    await vi.waitFor(() => {
      expect(dynamic.nextElementSibling?.textContent).toBe(' [The Octocat]')
    })

    // turbo:load — GitHub does not reload the whole page, a full pass is needed again.
    const turboAdded = userAnchor('hubot')
    document.body.appendChild(turboAdded)
    document.dispatchEvent(new Event('turbo:load'))
    expect(turboAdded.nextElementSibling?.textContent).toBe(' [Hubot]')

    // Shadow host added DYNAMICALLY through the regular MutationObserver on body.
    const shadowHost2 = document.createElement('div')
    const shadowRoot2 = shadowHost2.attachShadow({ mode: 'open' })
    const shadowAnchor2 = userAnchor('shadowuser2')
    shadowRoot2.appendChild(shadowAnchor2)
    document.body.appendChild(shadowHost2)
    await vi.waitFor(() => {
      expect(shadowAnchor2.nextElementSibling?.textContent).toBe(' [Shadow Two]')
    })

    // A node inside an already-attached shadow root — mutations inside it don't bubble
    // up to the observer on body, it's decorated only thanks to a separate observer.
    const shadowAnchor2b = userAnchor('shadowuser2', 'shadowuser2-second')
    shadowRoot2.appendChild(shadowAnchor2b)
    await vi.waitFor(() => {
      expect(shadowAnchor2b.nextElementSibling?.textContent).toBe(' [Shadow Two]')
    })

    // Mapping and format change via storage.onChanged — redraw without a reload.
    await mock.storage.local.set({
      [STORAGE_KEYS.idx]: { ...idx, newperson: ['New Person', 'manual'] },
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, enabled: true, displayFormat: 'parens' },
    })
    const newperson = userAnchor('newperson')
    document.body.appendChild(newperson)

    await vi.waitFor(() => {
      expect(known.nextElementSibling?.textContent).toBe(' (Sandeep Somavarapu)')
    })
    // Idempotent: the redraw replaces the existing span's content, doesn't spawn a new one.
    expect(document.body.querySelectorAll('[data-ghname-for="sandy081"]')).toHaveLength(1)
    expect(newperson.nextElementSibling?.textContent).toBe(' (New Person)')
  })
})

describe('main — flush scheduling (requestAnimationFrame + fallback timer)', () => {
  it('hidden tab: requestAnimationFrame never calls back, the fallback setTimeout still decorates', async () => {
    // Simulates a hidden tab: browsers never invoke the rAF callback while
    // document.visibilityState === 'hidden'. The stub mirrors that — it accepts a
    // callback, like the real API, but never calls it.
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const idx: MergedIndex = { hiddentabuser: ['Hidden Tab User', 'manual'] }
    await mock.storage.local.set({
      [STORAGE_KEYS.idx]: idx,
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, enabled: true },
    })

    await runMain()

    const dynamic = userAnchor('hiddentabuser')
    document.body.appendChild(dynamic)
    expect(dynamic.nextElementSibling).toBeNull()

    // rAF never fires (stubbed above) — only the ~50ms fallback timer can decorate this.
    await vi.waitFor(() => {
      expect(dynamic.nextElementSibling?.textContent).toBe(' (Hidden Tab User)')
    })
  })

  it('visible tab: requestAnimationFrame fires, the fallback timer does not cause a second pass', async () => {
    const idx: MergedIndex = { singleflushuser: ['Single Flush User', 'manual'] }
    await mock.storage.local.set({
      [STORAGE_KEYS.idx]: idx,
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, enabled: true },
    })

    await runMain()

    const dynamic = userAnchor('singleflushuser')
    document.body.appendChild(dynamic)

    await vi.waitFor(() => {
      expect(dynamic.nextElementSibling?.textContent).toBe(' (Single Flush User)')
    })

    // The real rAF flush must have cancelled the fallback timer — wait past its
    // ~50ms delay and confirm no second span was inserted.
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(document.body.querySelectorAll('[data-ghname-for="singleflushuser"]')).toHaveLength(1)
  })

  it('stopObserving() cancels a flush that was scheduled but has not run yet', async () => {
    const idx: MergedIndex = { canceledflushuser: ['Canceled Flush User', 'manual'] }
    await mock.storage.local.set({
      [STORAGE_KEYS.idx]: idx,
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, enabled: true },
    })
    const known = userAnchor('canceledflushuser')
    document.body.appendChild(known)

    await runMain()
    expect(known.nextElementSibling?.textContent).toBe(' (Canceled Flush User)')

    // Adds a node to the pending queue — schedules both the rAF and the fallback
    // timer, neither of which has run yet.
    const dynamic = userAnchor('canceledflushuser', 'canceledflushuser-second')
    document.body.appendChild(dynamic)

    await mock.storage.local.set({
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, enabled: false },
    })

    // Same reasoning as the "disabling enabled" test above: this confirms the async
    // disable handler (and therefore stopObserving()) has already run.
    await vi.waitFor(() => {
      expect(document.body.querySelectorAll('[data-ghname-for]')).toHaveLength(0)
    })

    // Wait past both the animation frame and the ~50ms fallback timer — neither
    // should decorate the pending node now that the flush was cancelled.
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(dynamic.nextElementSibling).toBeNull()
  })
})

describe('main — toggling settings.enabled on an already-open page', () => {
  it('disabling enabled removes all insertions and does not bring them back', async () => {
    const idx: MergedIndex = { toggleuser: ['Toggle User', 'manual'] }
    await mock.storage.local.set({
      [STORAGE_KEYS.idx]: idx,
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, enabled: true },
    })
    const known = userAnchor('toggleuser')
    document.body.appendChild(known)

    await runMain()
    expect(known.nextElementSibling?.textContent).toBe(' (Toggle User)')

    await mock.storage.local.set({
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, enabled: false },
    })

    await vi.waitFor(() => {
      expect(known.nextElementSibling).toBeNull()
    })

    // A mutation after disabling must not decorate anything — observation is stopped.
    // Nothing to wait for here: the preceding `vi.waitFor` already guarantees that
    // `stopObserving()` has run (it's called synchronously in the same block as removing
    // the decorations), which means all MutationObservers are already disconnected and
    // the node added below cannot be decorated now or in the future.
    const dynamic = userAnchor('toggleuser', 'toggleuser-second')
    document.body.appendChild(dynamic)
    expect(dynamic.nextElementSibling).toBeNull()
    expect(document.body.querySelectorAll('[data-ghname-for]')).toHaveLength(0)
  })

  it('re-enabling enabled brings back insertions without reloading the page', async () => {
    const idx: MergedIndex = { reenableuser: ['Reenable User', 'manual'] }
    await mock.storage.local.set({
      [STORAGE_KEYS.idx]: idx,
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, enabled: false },
    })
    const known = userAnchor('reenableuser')
    document.body.appendChild(known)

    await runMain()
    expect(known.nextElementSibling).toBeNull()

    await mock.storage.local.set({
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, enabled: true },
    })

    await vi.waitFor(() => {
      expect(known.nextElementSibling?.textContent).toBe(' (Reenable User)')
    })
  })

  it('the first mapping import with an initially empty idx reaches an already-open page', async () => {
    await mock.storage.local.set({
      [STORAGE_KEYS.idx]: {},
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, enabled: true },
    })
    const known = userAnchor('freshmappinguser')
    document.body.appendChild(known)

    await runMain()
    expect(known.nextElementSibling).toBeNull()

    await mock.storage.local.set({
      [STORAGE_KEYS.idx]: { freshmappinguser: ['Fresh Mapping User', 'manual'] } satisfies MergedIndex,
    })

    await vi.waitFor(() => {
      expect(known.nextElementSibling?.textContent).toBe(' (Fresh Mapping User)')
    })
  })

  it('a repeated call to startObserving() does not create a second MutationObserver on body', async () => {
    // `enabled: false` here, not an empty idx — an empty idx no longer keeps the
    // script from observing (see "main — early exit" above).
    await mock.storage.local.set({
      [STORAGE_KEYS.idx]: {},
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, enabled: false },
    })

    const ctor = vi.fn()
    class FakeObserver {
      constructor(...args: unknown[]) {
        ctor(...args)
      }
      observe(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('MutationObserver', FakeObserver)

    await runMain()
    expect(ctor).not.toHaveBeenCalled()

    // First enabling — starts observing, creates a MutationObserver on body.
    await mock.storage.local.set({
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, enabled: true },
    })
    await vi.waitFor(() => {
      expect(ctor).toHaveBeenCalledTimes(1)
    })

    // Next change (observation already running) — just a redraw, no second MutationObserver is created.
    await mock.storage.local.set({
      [STORAGE_KEYS.idx]: { idempotentuser: ['Idempotent User', 'manual'] } satisfies MergedIndex,
    })
    await vi.waitFor(() => {
      expect(ctor).toHaveBeenCalledTimes(1)
    })
  })
})

describe('main — attribute mutations (hovercard attribute appearing after node insertion)', () => {
  it('an anchor without data-hovercard-url stays undecorated until the attribute is added, then gets decorated', async () => {
    const idx: MergedIndex = { diffora: ['Diffora User', 'manual'] }
    await mock.storage.local.set({
      [STORAGE_KEYS.idx]: idx,
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, enabled: true },
    })

    await runMain()

    // Mirrors what GitHub actually does on /commits/main: the <a> lands in the DOM
    // first, with no hovercard attribute at all. The text is deliberately NOT equal
    // to the href segment, so the `href` fallback in `detect.ts` doesn't fire either —
    // this element must stay completely unrecognized by the first (childList) pass.
    const el = document.createElement('a')
    el.setAttribute('href', '/diffora')
    el.textContent = 'Diffora Person'
    document.body.appendChild(el)

    // Wait past the childList pass triggered by the append above — it must find nothing.
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(el.nextElementSibling).toBeNull()

    // GitHub fills in the attribute in a separate, later mutation — this is exactly that step.
    el.setAttribute('data-hovercard-url', '/users/diffora/hovercard')

    await vi.waitFor(() => {
      expect(el.nextElementSibling?.textContent).toBe(' (Diffora User)')
    })
  })

  it('a repeated change of an already-watched attribute on a decorated element does not insert a second span', async () => {
    const idx: MergedIndex = { diffora: ['Diffora User', 'manual'] }
    await mock.storage.local.set({
      [STORAGE_KEYS.idx]: idx,
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, enabled: true },
    })
    const known = userAnchor('diffora', 'Diffora Person')
    document.body.appendChild(known)

    await runMain()
    expect(known.nextElementSibling?.textContent).toBe(' (Diffora User)')

    // Re-setting an already-present, watched attribute still fires a MutationRecord —
    // `decorate()`'s own idempotency (`data-ghname-done`) is what must stop a second span,
    // not the observer.
    known.setAttribute('data-hovercard-url', '/users/diffora/hovercard')

    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(document.body.querySelectorAll('[data-ghname-for="diffora"]')).toHaveLength(1)
  })

  it('changing an unwatched attribute (e.g. class) never schedules a pass — attributeFilter is in effect', async () => {
    const idx: MergedIndex = { classattruser: ['Class Attr User', 'manual'] }
    await mock.storage.local.set({
      [STORAGE_KEYS.idx]: idx,
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, enabled: true },
    })

    await runMain()

    // Stubbed to run the flush synchronously so a call count reliably reflects how
    // many passes got scheduled, without racing real animation frames.
    const rafSpy = vi.fn((cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
    vi.stubGlobal('requestAnimationFrame', rafSpy)

    const el = document.createElement('a')
    el.setAttribute('href', '/classattruser')
    el.textContent = 'irrelevant text'
    document.body.appendChild(el)

    // The childList mutation from the append above schedules exactly one pass.
    await vi.waitFor(() => {
      expect(rafSpy).toHaveBeenCalledTimes(1)
    })

    el.setAttribute('class', 'some-class')

    // attributeFilter must keep this mutation from ever reaching the observer —
    // no new pass gets scheduled, even after waiting past the fallback timer too.
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(rafSpy).toHaveBeenCalledTimes(1)
  })
})

describe('main — reporting unknown logins to background (PLAN-PASS.md §4)', () => {
  it('a page with several unknown logins sends exactly one ghname:resolve-logins message, after the debounce elapses', async () => {
    const idx: MergedIndex = { known1: ['Known One', 'manual'] }
    await mock.storage.local.set({
      [STORAGE_KEYS.idx]: idx,
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, enabled: true },
    })
    document.body.append(userAnchor('known1'), userAnchor('UnknownA'), userAnchor('UnknownB'))

    vi.useFakeTimers()
    await runMain()

    // Nothing sent yet — the report is debounced, not immediate.
    expect(mock.runtime.sendMessage).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(300)

    expect(mock.runtime.sendMessage).toHaveBeenCalledTimes(1)
    // `sendMessage` is typed as taking no arguments (matches the real `browser.runtime.sendMessage`
    // call sites elsewhere, which don't rely on its parameter types) — cast the call's args
    // to `unknown[]` first so indexing into it doesn't fight the empty-tuple inference.
    const request = (mock.runtime.sendMessage.mock.calls[0] as unknown[] | undefined)?.[0] as ResolveLoginsRequest
    expect(request.type).toBe('ghname:resolve-logins')
    // Lower-cased login KEYS, not the display-cased logins seen on the page — and
    // nothing already present in idx (known1 is absent).
    expect([...request.logins].sort()).toEqual(['unknowna', 'unknownb'])
  })

  it('a second MutationObserver batch for logins already reported sends no second message', async () => {
    const idx: MergedIndex = { known1: ['Known One', 'manual'] }
    await mock.storage.local.set({
      [STORAGE_KEYS.idx]: idx,
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, enabled: true },
    })
    document.body.append(userAnchor('UnknownA'))

    vi.useFakeTimers()
    await runMain()
    await vi.advanceTimersByTimeAsync(300)
    expect(mock.runtime.sendMessage).toHaveBeenCalledTimes(1)
    mock.runtime.sendMessage.mockClear()

    // Real `requestAnimationFrame` isn't hooked into `vi.useFakeTimers()` here (see
    // the "hidden tab" test above) — stubbed so the flush below is driven only by
    // the deterministic, fake-timer-controlled ~50ms fallback, not a race with a
    // real rAF callback.
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    // A second occurrence of the SAME login arriving through the regular
    // MutationObserver — the tab-local `askedLogins` guard must swallow it.
    document.body.appendChild(userAnchor('UnknownA', 'unknowna-again'))
    // Past the mutation flush (fake ~50ms fallback) and the report debounce.
    await vi.advanceTimersByTimeAsync(50)
    await vi.advanceTimersByTimeAsync(300)

    expect(mock.runtime.sendMessage).not.toHaveBeenCalled()
  })

  it('a mutation introducing a genuinely new login sends a second message containing only that login', async () => {
    const idx: MergedIndex = { known1: ['Known One', 'manual'] }
    await mock.storage.local.set({
      [STORAGE_KEYS.idx]: idx,
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, enabled: true },
    })
    document.body.append(userAnchor('UnknownA'))

    vi.useFakeTimers()
    await runMain()
    await vi.advanceTimersByTimeAsync(300)
    expect(mock.runtime.sendMessage).toHaveBeenCalledTimes(1)
    mock.runtime.sendMessage.mockClear()

    // Real `requestAnimationFrame` isn't hooked into `vi.useFakeTimers()` here (see
    // the "hidden tab" test above, which stubs it for the same reason) — without
    // this, the flush below could race between the real rAF and the fake ~50ms
    // fallback timer, making this test flaky. Stubbing it forces the flush through
    // the deterministic, fake-timer-controlled fallback only.
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    document.body.appendChild(userAnchor('UnknownC'))
    await vi.advanceTimersByTimeAsync(50)
    await vi.advanceTimersByTimeAsync(300)

    expect(mock.runtime.sendMessage).toHaveBeenCalledTimes(1)
    const request = (mock.runtime.sendMessage.mock.calls[0] as unknown[] | undefined)?.[0] as ResolveLoginsRequest
    expect(request.logins).toEqual(['unknownc'])
  })

  it('settings.enabled === false → no message is ever sent', async () => {
    await mock.storage.local.set({
      [STORAGE_KEYS.idx]: {},
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, enabled: false },
    })
    document.body.append(userAnchor('someone'))

    vi.useFakeTimers()
    await runMain()
    await vi.advanceTimersByTimeAsync(1000)

    expect(mock.runtime.sendMessage).not.toHaveBeenCalled()
  })

  it('regression guard: an empty idx no longer makes the script inert — the observer still starts and unknown logins get reported', async () => {
    await mock.storage.local.set({
      [STORAGE_KEYS.idx]: {},
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, enabled: true },
    })
    const ctor = vi.fn()
    class FakeObserver {
      constructor(...args: unknown[]) {
        ctor(...args)
      }
      observe(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('MutationObserver', FakeObserver)
    document.body.append(userAnchor('freshuser'))

    vi.useFakeTimers()
    await runMain()

    expect(ctor).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(300)

    expect(mock.runtime.sendMessage).toHaveBeenCalledTimes(1)
    const request = (mock.runtime.sendMessage.mock.calls[0] as unknown[] | undefined)?.[0] as ResolveLoginsRequest
    expect(request.logins).toEqual(['freshuser'])
  })

  it('after names land in idx via storage.onChanged, the page is decorated even though idx started out empty', async () => {
    await mock.storage.local.set({
      [STORAGE_KEYS.idx]: {},
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, enabled: true },
    })
    const known = userAnchor('lazyloadeduser')
    document.body.appendChild(known)

    await runMain()
    expect(known.nextElementSibling).toBeNull()

    await mock.storage.local.set({
      [STORAGE_KEYS.idx]: { lazyloadeduser: ['Lazy Loaded User', 'manual'] } satisfies MergedIndex,
    })

    await vi.waitFor(() => {
      expect(known.nextElementSibling?.textContent).toBe(' (Lazy Loaded User)')
    })
  })
})
