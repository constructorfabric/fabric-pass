/**
 * Inserting the real name next to a user link.
 *
 * One person on a PR page shows up in several links with identical hovercard
 * attributes: the avatar in the header, the author's name as text, the avatar in
 * the commit stack, an inline link. We only decorate the ones that have their own
 * non-empty visible text — links that just wrap an `<img>` with no text are skipped,
 * otherwise the name would end up hanging next to each image separately.
 *
 * Two of the three display formats (`parens`, `brackets`) APPEND a span after (or
 * inside) `el`, leaving the login itself untouched — see `buildSpan`. The third,
 * `brackets-reversed`, needs the name BEFORE the login, which can't be expressed as an
 * appended suffix, so it REWRITES the login's own text node in place instead — see
 * `replaceLoginText` and the reversibility bookkeeping around `REPLACED_ATTR`, which
 * follows the same pattern as `assignees.ts` (the other place in this extension that
 * rewrites rather than appends).
 */

import type { DisplayFormat } from '../../core/types'
import { formatReplacement, formatSuffix, isAppendingFormat, type AppendingFormat } from '../../core/format'
import { extractLogin, findUserElements } from './detect'
import { restoreAssigneeCells, rewriteAssigneeCells } from './assignees'

const DECORATION_CLASS = 'ghname-real'

/** Attribute on the inserted `<span>` — used to find and remove decorations on redraw. */
const DECORATION_ATTR = 'data-ghname-for'

/**
 * Attribute marking a GitHub-native name span that we hid because the registry has
 * priority for the same login — see `hideProfileName`.
 */
const HIDDEN_ATTR = 'data-ghname-hidden'

/**
 * Attribute on `el` itself for the `brackets-reversed` strategy — the equivalent of
 * `DECORATION_ATTR` for elements that got their text REWRITTEN rather than getting a
 * sibling/child span. Its value is the lowercased login key, read by `collectLogins` in
 * `index.ts` the same way `DECORATION_ATTR` is.
 */
const REPLACED_ATTR = 'data-ghname-replaced'

/**
 * The rewritten text node's original value, captured before the first rewrite —
 * whitespace and all, so `removeAllDecorations` can restore it byte-for-byte. Same role
 * as `assignees.ts`'s `ORIG_ATTR`, but scoped to a single text node rather than the
 * whole element's `textContent`, since `el` here can also contain an `<img>` that must
 * survive the rewrite untouched.
 */
const ORIG_TEXT_ATTR = 'data-ghname-orig-text'

/**
 * The exact value we wrote into that text node. The restore path uses it to find the
 * node again instead of re-running `findLoginTextNode`: that function's fallback branch
 * ("the first non-empty text node") is not guaranteed to return the node the rewrite
 * actually touched — in `<a><span>by </span>anatolyb</a>` the exact-login match picks the
 * second text node while the fallback picks the first, so a restore driven by the
 * fallback would write the stashed login into the WRONG node and leave the rewritten text
 * on the page. Matching on the written value cannot pick the wrong node, and when React
 * has re-rendered the element in the meantime nothing matches at all — which is the
 * correct outcome: the node we rewrote no longer exists, so there is nothing to restore.
 * Same role as `assignees.ts`'s `TEXT_ATTR`.
 */
const WRITTEN_TEXT_ATTR = 'data-ghname-text'

function buildSpan(loginKey: string, name: string, format: AppendingFormat): HTMLSpanElement {
  const span = document.createElement('span')
  span.className = DECORATION_CLASS
  span.setAttribute(DECORATION_ATTR, loginKey)
  span.textContent = formatSuffix(name, format)
  return span
}

/**
 * Finds the text node inside `el` whose visible text IS the login, so `replaceLoginText`
 * knows which node to rewrite without disturbing any other child (an avatar `<img>`, an
 * icon, whatever). Walks every descendant text node (not just direct children) and:
 *
 * - prefers the FIRST one whose trimmed value equals `login` case-insensitively, with or
 *   without a leading `@` — this is the common case, where the link's visible text is
 *   exactly the login;
 * - otherwise falls back to the first text node with a non-empty trimmed value — some
 *   markup wraps the login text in an extra inline element, so an exact-position guess
 *   would miss it. That fallback is a guess, which is why the restore path does NOT use
 *   this function (see `WRITTEN_TEXT_ATTR`).
 *
 * Returns `undefined` when `el` has no non-empty text node at all.
 */
function findLoginTextNode(el: Element, login: string): Text | undefined {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const loginLower = login.toLowerCase()
  let firstNonEmpty: Text | undefined

  let node = walker.nextNode()
  while (node) {
    const text = node as Text
    const trimmed = (text.nodeValue ?? '').trim()
    if (trimmed !== '') {
      if (firstNonEmpty === undefined) firstNonEmpty = text
      const withoutAt = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed
      if (trimmed.toLowerCase() === loginLower || withoutAt.toLowerCase() === loginLower) return text
    }
    node = walker.nextNode()
  }

  return firstNonEmpty
}

/**
 * Rewrites the login's own text node to `` `${name} [${login}]` `` (via
 * `formatReplacement`), preserving whatever leading/trailing whitespace the original
 * node value had — only the trimmed part is replaced. `el.textContent = …` is
 * deliberately never used: it would delete any other child of `el`, such as an avatar
 * `<img>`.
 *
 * Stashes the node's original value in `ORIG_TEXT_ATTR` and marks `el` with
 * `REPLACED_ATTR` so `removeAllDecorations` can restore it later. Returns `false`
 * (without touching the DOM) when `el` has no text node to rewrite at all.
 */
function replaceLoginText(el: Element, login: string, name: string): boolean {
  const node = findLoginTextNode(el, login)
  if (!node) return false

  const original = node.nodeValue ?? ''
  const leading = /^\s*/.exec(original)?.[0] ?? ''
  const trailing = /\s*$/.exec(original)?.[0] ?? ''
  const written = `${leading}${formatReplacement(login, name)}${trailing}`
  node.nodeValue = written

  el.setAttribute(REPLACED_ATTR, login.toLowerCase())
  el.setAttribute(ORIG_TEXT_ATTR, original)
  el.setAttribute(WRITTEN_TEXT_ATTR, written)
  return true
}

/**
 * Undoes `replaceLoginText`: writes the stashed original text back into the text node
 * that still holds exactly what we wrote there, and drops every attribute the rewrite
 * left behind (`REPLACED_ATTR`, `ORIG_TEXT_ATTR`, `WRITTEN_TEXT_ATTR`,
 * `dataset.ghnameDone`).
 *
 * The node is identified by its written value rather than by re-running
 * `findLoginTextNode` — see `WRITTEN_TEXT_ATTR` for why that function must not be used
 * here. The attributes are dropped even when no matching node is found (React replaced
 * the text in the meantime): leaving them behind would make the element look decorated
 * forever and block any later pass.
 */
function restoreReplacedLogin(el: Element): void {
  const original = el.getAttribute(ORIG_TEXT_ATTR)
  const written = el.getAttribute(WRITTEN_TEXT_ATTR)
  if (original !== null && written !== null) {
    const node = findWrittenTextNode(el, written)
    if (node) node.nodeValue = original
  }

  el.removeAttribute(REPLACED_ATTR)
  el.removeAttribute(ORIG_TEXT_ATTR)
  el.removeAttribute(WRITTEN_TEXT_ATTR)
  if (el instanceof HTMLElement) delete el.dataset.ghnameDone
}

/** The descendant text node still holding exactly `written`, if it's still there. */
function findWrittenTextNode(el: Element, written: string): Text | undefined {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    if (node.nodeValue === written) return node as Text
    node = walker.nextNode()
  }
  return undefined
}

/**
 * Hides the GitHub-native profile name sitting right after a dropdown filter
 * popover's `ActionList` label (the `<span id="…--inline-description">` — see
 * PLAN.md, "Dropdown filter markup" backlog entry). The registry takes priority: once
 * we're about to show our own name for this login, GitHub's own name for the same row
 * must not also be visible.
 *
 * Marked with `HIDDEN_ATTR` and hidden via a CSS rule in `style.css`, not
 * `style.display` — a direct style edit would be indistinguishable from styling the
 * page itself might set, so `removeAllDecorations` wouldn't know it's safe to touch.
 * The node itself is never removed — that would be irreversible. A dedicated CSS rule
 * (rather than the standard `hidden` attribute) is used because the UA's default
 * `[hidden] { display: none }` rule is an author-overridable low-priority rule, and
 * Primer's own layout classes on the same node could otherwise win the cascade.
 */
function hideProfileName(el: Element): void {
  const sibling = el.nextElementSibling
  if (!sibling || !sibling.id.endsWith('--inline-description')) return
  sibling.setAttribute(HIDDEN_ATTR, 'true')
}

/**
 * Removes decorations that outlived the element they decorated, among the direct
 * children of `el`'s parent. GitHub's React re-renders a list by replacing a node
 * outright rather than patching it in place — measured live: an `<a>`'s `id` changed
 * between passes (`_r_j8_` → `_r_pp_`), meaning it was swapped, not updated. Our
 * inserted span sits next to that `<a>`, outside React's own tree, so React has no
 * reason to remove it along with the node it was decorating; the replacement `<a>`
 * then gets decorated again on the next pass. Left unchecked this compounds once per
 * re-render — measured 3 orphaned spans plus 1 live one on a single list item, i.e. the
 * same name shown four times. `ownerOf()` already tells owned spans (parent or
 * previous sibling carries `data-ghname-done`) from orphaned ones, so anything it
 * can't find an owner for here is collected.
 *
 * Scoped to the parent's direct children and nothing wider: only a *sibling* span can
 * outlive the node it decorated. A span that sat inside a subtree React replaced was
 * removed together with that subtree, so there is nothing to collect there.
 */
function collectOrphans(el: Element): void {
  const parent = el.parentElement
  if (!parent) return

  for (const child of Array.from(parent.children)) {
    if (child.hasAttribute(DECORATION_ATTR) && ownerOf(child) === undefined) child.remove()
  }
}

/**
 * Decorates a single element, choosing one of three strategies based on `format` and,
 * for the two appending formats, on what `el` is:
 *
 * - `brackets-reversed` REWRITES the login's own text node in place (`replaceLoginText`)
 *   instead of inserting anything — the name has to come BEFORE the login, which an
 *   appended span can never achieve. See `replaceLoginText` for the reversibility
 *   bookkeeping this needs.
 * - On ordinary pages `el` is an `<a>`: for the appending formats the login is part of a
 *   clickable link, so the span goes RIGHT AFTER it (`el.after(span)`) — inserting
 *   inside would make our added text part of the link and clickable too.
 * - In dropdown filter popovers `el` is a plain `<span id="…--label">`, not a link, and
 *   there `after` is unsafe for a different reason: Primer lays the row out two
 *   different ways depending on whether it also has a GitHub-native profile name
 *   sibling (`--inline-description`). Measured live on the same open dropdown: a row
 *   WITHOUT a profile name uses `display: grid` with `gap: normal`, and the label span
 *   is stretched to fill its own grid track (113px wide for ~55px of text) — a sibling
 *   span lands in the NEXT track, producing a wide gap that grows with the longest
 *   login in the list. A row WITH a profile name uses `display: flex` with `gap: 8px`
 *   and a content-sized label span, so the same sibling insertion looks fine there —
 *   hence the uneven gaps between rows. Appending the span INSIDE the label span
 *   sidesteps the row layout entirely: it becomes inline text inside one already
 *   existing element, so the gap is always exactly what `formatSuffix` produces,
 *   in every row.
 *
 * Idempotent: if the element is already decorated (`dataset.ghnameDone`) or has no
 * visible text of its own, does nothing and returns `false`. Same for the rewrite
 * strategy when `el` has no text node to rewrite at all.
 */
export function decorate(el: Element, login: string, name: string, format: DisplayFormat): boolean {
  // Runs even when `el` turns out to already be decorated below: a pass over an
  // already-decorated element is exactly when a React re-render is likely to have
  // just replaced its sibling span's original owner, leaving the span orphaned.
  collectOrphans(el)

  if (el instanceof HTMLElement && el.dataset.ghnameDone === 'true') return false

  const text = el.textContent?.trim() ?? ''
  if (text === '') return false

  hideProfileName(el)

  if (!isAppendingFormat(format)) {
    if (!replaceLoginText(el, login, name)) return false
    if (el instanceof HTMLElement) el.dataset.ghnameDone = 'true'
    return true
  }

  const span = buildSpan(login.toLowerCase(), name, format)
  if (el.tagName === 'A') {
    el.after(span)
  } else {
    el.append(span)
  }

  if (el instanceof HTMLElement) el.dataset.ghnameDone = 'true'
  return true
}

/** Walks `root` and decorates all found user links for which a name exists. */
export function scanAndDecorate(
  root: ParentNode,
  lookup: (loginKey: string) => string | undefined,
  format: DisplayFormat,
): void {
  const candidates = findUserElements(root)
  // A mutation may add the link node itself, not just its surroundings —
  // querySelectorAll(root) only finds DESCENDANTS of root, so we check root itself separately.
  if (root instanceof Element) candidates.unshift(root)

  for (const el of candidates) {
    const login = extractLogin(el)
    if (!login) continue
    const name = lookup(login.toLowerCase())
    if (!name) continue
    decorate(el, login, name, format)
  }

  // The Projects table's Assignees column (see assignees.ts) has no user links at all,
  // so it's handled by its own pass rather than by findUserElements/decorate above.
  rewriteAssigneeCells(root, lookup)
}

/**
 * Finds the element the span was decorating — its owner — regardless of which of the
 * two APPENDING `decorate()` strategies produced it: for `el.after(span)` the owner is
 * the PREVIOUS sibling, for `el.append(span)` it's the PARENT. The parent is checked
 * first because it's the more specific relationship (a parent that happens to carry
 * the flag can only be an owner that appended the span; a previous sibling carrying
 * the flag for an unrelated reason is comparatively more likely). The third strategy
 * (`brackets-reversed`, `REPLACED_ATTR`) never produces a span at all, so it never
 * reaches this function — see `restoreReplacedLogin` for its own, unrelated undo path.
 */
function ownerOf(span: Element): HTMLElement | undefined {
  const parent = span.parentElement
  if (parent instanceof HTMLElement && parent.dataset.ghnameDone === 'true') return parent

  const previous = span.previousElementSibling
  if (previous instanceof HTMLElement && previous.dataset.ghnameDone === 'true') return previous

  return undefined
}

/** Removes the decoration from one inserted `<span>` and from the element it stood next to. */
function undecorateSpan(span: Element): void {
  const owner = ownerOf(span)
  if (owner) delete owner.dataset.ghnameDone
  span.remove()
}

/**
 * Removes all inserted decorations within `root`, returning the DOM to its original
 * state — including un-hiding any GitHub-native names hidden by `hideProfileName` and
 * restoring every element rewritten by `replaceLoginText`.
 */
export function removeAllDecorations(root: ParentNode): void {
  const spans = root.querySelectorAll(`[${DECORATION_ATTR}]`)
  for (const span of spans) undecorateSpan(span)

  const hiddenNames = root.querySelectorAll(`[${HIDDEN_ATTR}]`)
  for (const el of hiddenNames) el.removeAttribute(HIDDEN_ATTR)

  // `root` itself may be the rewritten element (a mutation can deliver the login link
  // itself, not just its surroundings — same reason `scanAndDecorate` does
  // `candidates.unshift(root)`), so it's checked in addition to its descendants.
  const replaced = Array.from(root.querySelectorAll(`[${REPLACED_ATTR}]`))
  if (root instanceof Element && root.hasAttribute(REPLACED_ATTR)) replaced.unshift(root)
  for (const el of replaced) restoreReplacedLogin(el)

  restoreAssigneeCells(root)
}

/**
 * Redraw when the mapping or the display format changes — without reloading the page.
 * Removes all existing insertions within `root` and runs through again with the new
 * `lookup`/`format`.
 */
export function redecorateAll(
  root: ParentNode,
  lookup: (loginKey: string) => string | undefined,
  format: DisplayFormat,
): void {
  removeAllDecorations(root)
  scanAndDecorate(root, lookup, format)
}
