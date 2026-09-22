/**
 * Content script — entry point. Logic is described in PLAN.md §6.
 *
 * Early exit is a requirement, not an optimization: while the extension is switched
 * off, it must be completely inert (no `MutationObserver`, no touching the DOM). An
 * empty `idx` no longer implies that: since PLAN-PASS.md §4, names arrive lazily —
 * this script reports the logins it sees to background, which asks Fabric Pass and
 * writes the result to storage — so a fresh install with nothing cached yet is a
 * normal cold state, not a reason to go inert. Going inert on an empty `idx` would
 * mean never asking pass in the first place.
 *
 * Dynamics are the main path, not an addition. For example, `/commits/main` is served
 * by the server with no user links at all: authors sit in JSON inside
 * `react-app.embeddedData` and only appear in the DOM after React hydration. We don't
 * parse that JSON — it's internal and changes without warning — and we only work with
 * the final DOM, so on such pages the entire result comes from `MutationObserver`.
 */

import { defineContentScript } from 'wxt/utils/define-content-script'
import type { CollectLoginsResponse, ExtensionMessage, ResolveLoginsRequest } from '../../core/messages'
import { onStateChanged, readIdx, readSettings } from '../../core/store'
import { STORAGE_KEYS, type DisplayFormat } from '../../core/types'
import { extractLogin, findUserElements } from './detect'
import { redecorateAll, removeAllDecorations, scanAndDecorate } from './decorate'
import { findAssigneeCells, readAssigneeCell } from './assignees'
import './style.css'

/** Attribute that `decorate.ts` marks the inserted span with — used to tell that the name is already shown. */
const DECORATED_ATTR = 'data-ghname-for'

/**
 * Attribute that `assignees.ts` marks a rewritten Projects table cell with — the
 * equivalent of `DECORATED_ATTR` for cells that have no inserted span to carry it on.
 */
const ASSIGNEES_DECORATED_ATTR = 'data-ghname-assignees'

/**
 * Attribute that `decorate.ts` marks an element with when its login text was REWRITTEN
 * in place (the `brackets-reversed` format) instead of getting an inserted span — the
 * equivalent of `DECORATED_ATTR` for that strategy. Without this, a login shown only in
 * the reversed format would have no `DECORATED_ATTR` anywhere nearby and the popup would
 * wrongly list it as "no name" even though it's already visible on the page.
 */
const REPLACED_ATTR = 'data-ghname-replaced'

/**
 * Collects unique logins from the entire page: the light DOM body plus, recursively,
 * all open shadow roots. Doesn't depend on `idx`/`settings` — it must respond even
 * when the extension is disabled or the mapping is empty, otherwise the popup on a
 * fresh install wouldn't see a single login.
 */
function collectLogins(): CollectLoginsResponse['logins'] {
  const entries = new Map<string, { login: string; decorated: boolean }>()

  function visit(root: ParentNode): void {
    for (const el of findUserElements(root)) {
      const login = extractLogin(el)
      if (!login) continue
      const loginKey = login.toLowerCase()
      if (!entries.has(loginKey)) entries.set(loginKey, { login, decorated: false })
    }

    for (const marker of root.querySelectorAll(`[${DECORATED_ATTR}]`)) {
      const loginKey = marker.getAttribute(DECORATED_ATTR)
      if (!loginKey) continue
      const entry = entries.get(loginKey)
      if (entry) entry.decorated = true
    }

    // Same "already shown" flag as above, but for elements rewritten in place by the
    // `brackets-reversed` format — those have no inserted span to carry DECORATED_ATTR.
    for (const marker of root.querySelectorAll(`[${REPLACED_ATTR}]`)) {
      const loginKey = marker.getAttribute(REPLACED_ATTR)
      if (!loginKey) continue
      const entry = entries.get(loginKey)
      if (entry) entry.decorated = true
    }

    // Projects table Assignees cells (see assignees.ts): read through `readAssigneeCell`
    // rather than the raw text so that a cell we already rewrote still reports the
    // logins it stands for, not the substituted names.
    for (const cell of findAssigneeCells(root)) {
      const assigneeCell = readAssigneeCell(cell)
      if (!assigneeCell) continue
      for (const login of assigneeCell.logins) {
        const loginKey = login.toLowerCase()
        if (!entries.has(loginKey)) entries.set(loginKey, { login, decorated: false })
      }
    }

    // These cells have no inserted span to carry DECORATED_ATTR, so the "already shown"
    // flag is read straight off the rewritten cell and split, since a cell can name more
    // than one login at once.
    for (const marker of root.querySelectorAll(`[${ASSIGNEES_DECORATED_ATTR}]`)) {
      const value = marker.getAttribute(ASSIGNEES_DECORATED_ATTR)
      if (!value) continue
      for (const loginKey of value.split(',')) {
        const entry = entries.get(loginKey)
        if (entry) entry.decorated = true
      }
    }

    const hosts: Element[] = []
    if (root instanceof Element && root.shadowRoot) hosts.push(root)
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) hosts.push(el)
    }
    for (const host of hosts) {
      if (host.shadowRoot) visit(host.shadowRoot)
    }
  }

  visit(document.body)

  return Array.from(entries, ([loginKey, entry]) => ({ login: entry.login, loginKey, decorated: entry.decorated }))
}

export default defineContentScript({
  matches: ['https://github.com/*'],
  async main() {
    // Registered BEFORE the early exit: the popup must get the list of logins even
    // on a fresh install, when the index is empty or the extension is disabled —
    // that's exactly the moment it's needed most.
    browser.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
      if (message?.type !== 'ghname:collect-logins') return undefined
      const response: CollectLoginsResponse = { logins: collectLogins() }
      sendResponse(response)
      return undefined
    })

    let idx = await readIdx()
    let settings = await readSettings()

    function lookup(loginKey: string): string | undefined {
      return idx[loginKey]?.[0]
    }

    function format(): DisplayFormat {
      return settings.displayFormat
    }

    // All roots (light DOM body + open shadow roots) that need to be fully redrawn
    // when the mapping/format changes — `redecorateAll` doesn't cross the shadow DOM boundary.
    const knownRoots = new Set<ParentNode>([document.body])
    // Shadow roots that already have their own MutationObserver attached — don't
    // duplicate the subscription. Recreated in `startObserving()` so that after
    // `stopObserving()` subscriptions get reattached to all already-known shadow
    // roots, not just newly appeared ones.
    let observedShadowRoots = new WeakSet<ShadowRoot>()
    // All active MutationObservers (body + shadow) — a single list so that
    // `stopObserving()` can disconnect all of them without guessing how many there are
    // or where.
    let activeObservers: MutationObserver[] = []
    // Observation can be started and stopped repeatedly — the source of truth for
    // the idempotency of `startObserving()`/`stopObserving()`.
    let observing = false

    // Logins this tab already reported to background — the tab-local half of a
    // two-level guard against a report storm. Without it, every `MutationObserver`
    // flush on a busy page would re-send the same logins; background dedupes too
    // (a module-level in-flight `Set`, shared across tabs), but that only stops the
    // duplicate network call, not a duplicate `runtime.sendMessage` from this tab.
    const askedLogins = new Set<string>()

    /** Decorates `root` and recursively descends into open shadow roots inside it. */
    function decorateDeep(root: ParentNode): void {
      scanAndDecorate(root, lookup, format())

      const hosts: Element[] = []
      if (root instanceof Element && root.shadowRoot) hosts.push(root)
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) hosts.push(el)
      }

      for (const host of hosts) {
        const shadowRoot = host.shadowRoot
        if (!shadowRoot || observedShadowRoots.has(shadowRoot)) continue
        observedShadowRoots.add(shadowRoot)
        knownRoots.add(shadowRoot)

        decorateDeep(shadowRoot)

        // Mutations inside a shadow root don't bubble up to the body observer — a separate one is needed.
        // Same rationale as the body observer in `startObserving()` for watching attributes too.
        const shadowObserver = new MutationObserver(handleMutations)
        shadowObserver.observe(shadowRoot, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['data-hovercard-url', 'data-hovercard-type'],
        })
        activeObservers.push(shadowObserver)
      }
    }

    // Mutations accumulate in a queue and are processed in a single pass, rather than
    // one at a time — otherwise a large batch of changes would cause extra work frame
    // after frame. The flush is primarily scheduled through requestAnimationFrame so
    // it lines up with rendering, but a hidden tab never gets a rAF callback —
    // measured live: a background tab found five matching logins via
    // `collect-logins` yet decorated none of them, because rAF just never fired. That
    // broke pages GitHub finishes rendering on the client (the commits and
    // pull-request lists), which depend entirely on this queue since the server sends
    // them with no user links at all. A fallback `setTimeout` (~50ms) guarantees the
    // flush happens either way; whichever timer fires first cancels the other, so
    // there's still exactly one pass per batch.
    const pendingNodes = new Set<Node>()
    let frameScheduled = false
    let scheduledFrameId: number | undefined
    let scheduledTimeoutId: ReturnType<typeof setTimeout> | undefined

    function cancelScheduledFlush(): void {
      if (scheduledFrameId !== undefined) {
        cancelAnimationFrame(scheduledFrameId)
        scheduledFrameId = undefined
      }
      if (scheduledTimeoutId !== undefined) {
        clearTimeout(scheduledTimeoutId)
        scheduledTimeoutId = undefined
      }
    }

    function flushPendingNodes(): void {
      frameScheduled = false
      cancelScheduledFlush()
      const nodes = [...pendingNodes]
      pendingNodes.clear()
      for (const node of nodes) {
        if (node instanceof Element || node instanceof DocumentFragment) decorateDeep(node)
      }
      // Covers everything React/Turbo adds after the first paint — the counterpart
      // to the call at the end of `startObserving()`, which only covers the initial,
      // server-rendered HTML.
      scheduleLoginReport()
    }

    function handleMutations(mutations: MutationRecord[]): void {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          // The hovercard attribute arrived on a node we already know about — queue
          // the node itself, not its children, so `decorateDeep` re-examines it.
          pendingNodes.add(mutation.target)
          continue
        }
        mutation.addedNodes.forEach((node) => pendingNodes.add(node))
      }
      if (frameScheduled) return
      frameScheduled = true
      scheduledFrameId = requestAnimationFrame(flushPendingNodes)
      scheduledTimeoutId = setTimeout(flushPendingNodes, 50)
    }

    /**
     * Reports logins seen on the page that `idx` doesn't know about yet, so
     * background can ask Fabric Pass about them. Filters against both `idx` (already
     * resolved, from a previous visit or another tab) and `askedLogins` (already
     * reported by THIS tab), so a repeat call with nothing new is a no-op.
     *
     * The reply is deliberately ignored: background writes any names it gets back to
     * storage, and the existing `onStateChanged` subscription above already redraws
     * the page from `idx` — do NOT "fix" this into an `await` plus a manual redraw,
     * that would just duplicate the redraw path this file already has.
     */
    function reportUnknownLogins(): void {
      const unknown = collectLogins().filter((entry) => !(entry.loginKey in idx) && !askedLogins.has(entry.loginKey))
      if (unknown.length === 0) return

      for (const entry of unknown) askedLogins.add(entry.loginKey)

      // No check of settings/`sources.pass.enabled` here on purpose: a disabled pass
      // layer is background's call to make (`resolveLogins` returns early for it,
      // before any network call), not this file's — reading another storage key on
      // every GitHub page for no behavioural gain isn't worth it.
      const request: ResolveLoginsRequest = { type: 'ghname:resolve-logins', logins: unknown.map((entry) => entry.loginKey) }
      // `sendMessage` can reject when the service worker is asleep/restarting —
      // swallow that here so it doesn't surface as an unhandled rejection in the
      // page's own console; the reply is ignored anyway (see above).
      void browser.runtime.sendMessage(request).catch(() => {})
    }

    // Debounced ~300ms so a client-rendered page doesn't send one report per
    // MutationObserver batch. Measured live: `/commits/main` inserts user links
    // across dozens of batches as React hydrates — one report once the dust settles
    // beats fifty small ones.
    let loginReportTimeoutId: ReturnType<typeof setTimeout> | undefined

    function scheduleLoginReport(): void {
      if (!observing) return
      if (loginReportTimeoutId !== undefined) clearTimeout(loginReportTimeoutId)
      loginReportTimeoutId = setTimeout(reportUnknownLogins, 300)
    }

    /**
     * Starts observing: a full pass over the already-rendered HTML plus a
     * `MutationObserver` on body (and recursively on shadow roots — their
     * subscription is attached inside `decorateDeep`). Idempotent — calling it again
     * while observation is already running does nothing, so a second
     * `MutationObserver` on body isn't created.
     */
    function startObserving(): void {
      if (observing) return
      observing = true

      decorateDeep(document.body)

      // `childList` alone is not enough: measured live on `/commits/main`, GitHub
      // inserts a user `<a>` first and only fills in `data-hovercard-url` on it in a
      // SEPARATE, later mutation (`oldValue: null`) — on that one page, 70 of 129
      // user links arrived this way, decorated 0 by the first pass and unreachable by
      // any later one since nothing revisits an already-scanned node. Watching
      // `attributes` closes that gap by re-queuing the node once the attribute shows
      // up. `attributeFilter` is required, not an optimization: without it this
      // observer would fire on every attribute change anywhere on the page (GitHub
      // sets a huge number of them), whereas the two names listed here are the only
      // ones `extractLogin` ever reads.
      const bodyObserver = new MutationObserver(handleMutations)
      bodyObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-hovercard-url', 'data-hovercard-type'],
      })
      activeObservers.push(bodyObserver)

      // Covers the server-rendered first paint — the pass above already touched
      // `decorateDeep`, so any login it left unresolved is known by now.
      scheduleLoginReport()
    }

    /**
     * Stops observing: disconnects all accumulated `MutationObserver`s (body and
     * shadow) and resets `observedShadowRoots`, so that the next `startObserving()`
     * reattaches subscriptions to all known shadow roots, instead of treating them
     * as already covered. Also cancels a flush scheduled by `handleMutations` that
     * hasn't run yet — otherwise it would still fire once after the extension is
     * disabled.
     */
    function stopObserving(): void {
      if (!observing) return
      observing = false

      for (const observer of activeObservers) observer.disconnect()
      activeObservers = []
      observedShadowRoots = new WeakSet<ShadowRoot>()

      frameScheduled = false
      cancelScheduledFlush()
      pendingNodes.clear()

      // Same reasoning as `cancelScheduledFlush()` above: a disabled extension must
      // not fire one last report after the fact.
      if (loginReportTimeoutId !== undefined) {
        clearTimeout(loginReportTimeoutId)
        loginReportTimeoutId = undefined
      }
    }

    // GitHub navigates via Turbo, no full page reload happens. While observation is
    // stopped (the extension is disabled), this is a no-op — otherwise a disabled
    // extension would come back to life on any Turbo navigation.
    function fullScan(): void {
      if (!observing) return
      decorateDeep(document.body)
      scheduleLoginReport()
    }
    document.addEventListener('turbo:load', fullScan)
    document.addEventListener('turbo:render', fullScan)

    // Registered BEFORE the early exit — same as the message listener above: the
    // first mapping import or re-enabling the extension must reach an already-open
    // tab, without requiring a page reload.
    onStateChanged((changedKeys) => {
      if (!changedKeys.includes(STORAGE_KEYS.idx) && !changedKeys.includes(STORAGE_KEYS.settings)) return
      void (async () => {
        idx = await readIdx()
        settings = await readSettings()

        if (!settings.enabled) {
          for (const root of knownRoots) removeAllDecorations(root)
          stopObserving()
          return
        }

        if (!observing) {
          startObserving()
          return
        }

        for (const root of knownRoots) redecorateAll(root, lookup, format())
      })()
    })

    // The early exit disables DOM observation and decoration, but not the message
    // exchange with the popup, nor the storage change subscription — both are
    // registered above independently of this condition. An empty `idx` is NOT a
    // reason to exit here — see the top-of-file comment.
    if (!settings.enabled) return

    startObserving()
  },
})
