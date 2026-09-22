/**
 * The Assignees column of a GitHub Projects table view (e.g.
 * `https://github.com/orgs/<org>/projects/<n>/views/1`).
 *
 * Measured live on that page: the whole grid has ZERO `data-hovercard-url` elements
 * and no user links at all, so `detect.ts`'s rules — every one of them keyed off a
 * hovercard attribute or an `<a href>` — miss every single cell here. The login is
 * plain text in a `<span data-component="Text">` that sits right after a GitHub
 * avatar (a single `<img>`, or Primer's `AvatarStack` wrapper for several people).
 * Verified on the live page: this structural rule ("Text span right after an avatar
 * carrier") matched exactly the 16 assignee cells (14 with one assignee, 2 with two)
 * and none of the other 144 `span[data-component="Text"]` elements on the page.
 *
 * Class names are deliberately not used as a signal — `user-group-module__TextCell__meoOH`
 * and friends carry a build hash that changes on every GitHub deploy, same reasoning as
 * documented in `detect.ts` for the dropdown filter popover.
 *
 * This is a separate module rather than an extension of `detect.ts`/`decorate.ts`
 * because it is the one place in the extension that REWRITES the login instead of
 * appending a name next to it (see the "why replace" note below), and because that
 * rewrite needs its own reversibility bookkeeping — its own attributes, its own
 * restore function — that has nothing in common with the `<span class="ghname-real">`
 * insertion strategy the rest of the extension uses.
 *
 * Why replace instead of append: measured live, the cell's inner container is
 * `overflow-x: hidden` and only 116px wide inside a 157px cell. A probe span appended
 * the usual way landed with its right edge at 746px against the cell's 719px boundary
 * — clipped. There is no room for a suffix here, so the login is replaced by the name
 * and the original login text is moved into `title` (visible on hover) instead.
 *
 * `Settings.displayFormat` (parens/brackets/brackets-reversed) has no effect on this
 * cell at all — it always replaces the login with the name and keeps the login(s) in
 * `title`, regardless of which format is selected. The two appending formats describe a
 * separator between a login that STAYS on the page and a suffix appended after it, and
 * this cell has no room for a suffix at all — see above. `brackets-reversed` does
 * rewrite the login elsewhere (see decorate.ts), but this cell's own rewrite predates
 * it, has different reversibility bookkeeping, and is not reused here.
 *
 * Decision taken by Anatoly (not re-derived here): replace the login with the real
 * name, keep the login(s) in `title`, and for several assignees join names with `", "`
 * rather than reproducing GitHub's localized "and" — which is what makes the rewrite
 * itself possible even when we can't reproduce GitHub's list-formatting rules exactly.
 */

import { LOGIN_RE } from './detect'

/** Original, unmodified `textContent` of the cell, captured before the first rewrite. */
const ORIG_ATTR = 'data-ghname-orig'

/** The cell's `title` attribute value before the first rewrite, only set when it had one. */
const ORIG_TITLE_ATTR = 'data-ghname-orig-title'

/**
 * The text we last wrote into the cell. Used to detect two different situations on a
 * later pass: the cell is already showing exactly this text (nothing to do), or React
 * re-rendered the node with fresh text of its own (our bookkeeping is stale and must be
 * dropped before treating the new text as unprocessed input).
 */
const TEXT_ATTR = 'data-ghname-text'

/**
 * Comma-joined lowercased login keys that actually resolved to a name in this cell —
 * read by `collectLogins` in `index.ts` to mark a login as already shown, the same role
 * `data-ghname-for` plays for the inserted `<span>` elsewhere in the extension. A plain
 * attribute list rather than reusing `data-ghname-for` because this cell has no inserted
 * span to carry it on — the attribute has to live on the rewritten element itself.
 */
export const ASSIGNEES_ATTR = 'data-ghname-assignees'

export interface AssigneeCell {
  el: Element
  /** Logins in the order GitHub printed them. */
  logins: string[]
  /** `true` when the list is certain: its length matches the number of avatars. */
  certain: boolean
}

/** Number of GitHub avatar images inside (or, if it IS one, represented by) `carrier`. */
function avatarImageCount(carrier: Element | null): number {
  if (carrier === null) return 0
  if (carrier.tagName === 'IMG') {
    return (carrier.getAttribute('src') ?? '').includes('avatars.githubusercontent.com') ? 1 : 0
  }
  return carrier.querySelectorAll('img[src*="avatars.githubusercontent.com"]').length
}

/**
 * Whether `el` is an avatar carrier: either the avatar `<img>` itself, or the
 * `AvatarStack` wrapper around several of them. The wrapper is only accepted when its
 * own `textContent` is empty — that is what tells it apart from some large unrelated
 * container that merely happens to contain an avatar image somewhere inside; the real
 * `AvatarStack` holds nothing but images (and whitespace).
 */
function isAvatarCarrier(el: Element): boolean {
  if (el.tagName === 'IMG') {
    return (el.getAttribute('src') ?? '').includes('avatars.githubusercontent.com')
  }
  const hasAvatarImg = el.querySelector('img[src*="avatars.githubusercontent.com"]') !== null
  return hasAvatarImg && (el.textContent?.trim() ?? '') === ''
}

/**
 * Candidates for assignee cells: every `span[data-component="Text"]` whose previous
 * sibling is an avatar carrier. Also returns `root` itself when it qualifies — a
 * mutation may deliver the cell's own span node, not just its surroundings, and
 * `querySelectorAll(root)` only finds DESCENDANTS of root (mirrors why
 * `scanAndDecorate` does `candidates.unshift(root)` in `decorate.ts`).
 */
export function findAssigneeCells(root: ParentNode): Element[] {
  const candidates = Array.from(root.querySelectorAll('span[data-component="Text"]'))
  if (root instanceof Element) candidates.unshift(root)

  return candidates.filter((el) => {
    if (el.tagName !== 'SPAN' || el.getAttribute('data-component') !== 'Text') return false
    const prev = el.previousElementSibling
    return prev !== null && isAvatarCarrier(prev)
  })
}

/**
 * Reads the logins out of an assignee cell. Splits the ORIGINAL text (the value of
 * `data-ghname-orig` when the cell was already rewritten once, else the live
 * `textContent`) into login-shaped tokens on any run of characters that isn't a letter,
 * digit or dash, then keeps the tokens that pass `LOGIN_RE`.
 *
 * With `n` avatars in the preceding avatar carrier:
 * - `tokens.length === n` — an exact match, the list is certain.
 * - `tokens.length === n + 1` (and at least two people, otherwise there is nothing to
 *   join) — GitHub's list formatting inserted a conjunction before the last item ("a
 *   and b", "a, b, and c"). The token at `tokens.length - 2` is dropped POSITIONALLY,
 *   not by matching a list of known conjunction words: the word itself is localized UI
 *   text and would read differently for a user with another interface language (and,
 *   for some locales such as Russian "a, b и c", the conjunction is a single
 *   non-Latin character that the token regex already excludes on its own — it never
 *   becomes a token at all, so this branch only fires for locales where it does). What
 *   is universal across locales is that list formatting always puts that word right
 *   before the last item — that position is what this rule actually relies on.
 * - anything else — the token count doesn't line up with the avatar count at all, so the
 *   list is uncertain; the tokens are still returned (best effort) but the caller must
 *   fall back to in-place substitution rather than rebuilding the string.
 *
 * Returns `undefined` when there are no login-shaped tokens at all — nothing to show.
 */
export function readAssigneeCell(el: Element): AssigneeCell | undefined {
  const origAttr = el.getAttribute(ORIG_ATTR)
  const original = origAttr !== null ? origAttr : el.textContent ?? ''

  const n = avatarImageCount(el.previousElementSibling)
  const tokens = original.split(/[^A-Za-z\d-]+/).filter((t) => t !== '' && LOGIN_RE.test(t))
  if (tokens.length === 0) return undefined

  if (tokens.length === n) {
    return { el, logins: tokens, certain: true }
  }

  if (tokens.length === n + 1 && n >= 2) {
    const dropIndex = tokens.length - 2
    const logins = tokens.filter((_, i) => i !== dropIndex)
    return { el, logins, certain: true }
  }

  return { el, logins: tokens, certain: false }
}

/**
 * Rebuilds `text`, replacing only the login-shaped tokens that resolve through
 * `resolvedByLogin`, leaving every separator (", ", " and ", localized conjunctions,
 * whatever GitHub printed) exactly as it was. Used only for the uncertain case — a
 * blind `text.replace(login, name)` is not safe here because a login can be a
 * substring of another word or of another login.
 */
function substituteInPlace(text: string, resolvedByLogin: Map<string, string>): string {
  let result = ''
  let lastIndex = 0
  for (const match of text.matchAll(/[A-Za-z\d-]+/g)) {
    const token = match[0]
    const index = match.index ?? lastIndex
    result += text.slice(lastIndex, index)
    result += resolvedByLogin.get(token) ?? token
    lastIndex = index + token.length
  }
  result += text.slice(lastIndex)
  return result
}

/**
 * Removes our bookkeeping from one cell. `restoreText` is `false` when called from
 * `rewriteAssigneeCells` for a cell React re-rendered with fresh text of its own — in
 * that case the DOM already holds the value we should treat as the new original, and
 * writing `data-ghname-orig` back over it would destroy exactly that fresh text.
 */
function restoreOne(el: Element, restoreText: boolean): void {
  if (restoreText) {
    const orig = el.getAttribute(ORIG_ATTR)
    if (orig !== null) el.textContent = orig
  }

  const origTitle = el.getAttribute(ORIG_TITLE_ATTR)
  if (origTitle !== null) el.setAttribute('title', origTitle)
  else el.removeAttribute('title')

  el.removeAttribute(ORIG_ATTR)
  el.removeAttribute(ORIG_TITLE_ATTR)
  el.removeAttribute(TEXT_ATTR)
  el.removeAttribute(ASSIGNEES_ATTR)
}

/**
 * Walks `root` and rewrites every assignee cell for which at least one login resolves
 * to a name through `lookup`.
 */
export function rewriteAssigneeCells(root: ParentNode, lookup: (loginKey: string) => string | undefined): void {
  for (const el of findAssigneeCells(root)) {
    const storedText = el.getAttribute(TEXT_ATTR)
    if (storedText !== null) {
      // Already showing exactly what we last wrote — nothing to do.
      if (el.textContent === storedText) continue
      // React re-rendered the node with text of its own: our bookkeeping refers to a
      // cell that no longer exists. Drop it (restoring the original `title`, but NOT
      // writing the stored text back — the text now in the DOM is GitHub's fresh one)
      // and fall through to process the fresh text as new, unprocessed input.
      restoreOne(el, false)
    }

    const cell = readAssigneeCell(el)
    if (!cell) continue

    const resolvedByLogin = new Map<string, string>()
    for (const login of cell.logins) {
      const name = lookup(login.toLowerCase())
      if (name) resolvedByLogin.set(login, name)
    }
    // Nothing resolves — leave the element completely untouched, no attributes, no title.
    if (resolvedByLogin.size === 0) continue

    const originalText = el.textContent ?? ''
    const newText = cell.certain
      ? cell.logins.map((login) => resolvedByLogin.get(login) ?? login).join(', ')
      : substituteInPlace(originalText, resolvedByLogin)

    const previousTitle = el.getAttribute('title')
    if (previousTitle !== null) el.setAttribute(ORIG_TITLE_ATTR, previousTitle)
    el.setAttribute(ORIG_ATTR, originalText)
    el.textContent = newText
    el.setAttribute('title', originalText)
    el.setAttribute(TEXT_ATTR, newText)
    el.setAttribute(
      ASSIGNEES_ATTR,
      Array.from(resolvedByLogin.keys())
        .map((login) => login.toLowerCase())
        .join(','),
    )
  }
}

/**
 * Removes all rewrites within `root`, returning the DOM to its original state
 * byte-for-byte — the same function runs both when the display format changes and when
 * the extension is switched off, exactly as `hideProfileName`/`removeAllDecorations`
 * work in `decorate.ts`.
 */
export function restoreAssigneeCells(root: ParentNode): void {
  const found = Array.from(root.querySelectorAll(`[${ORIG_ATTR}]`))
  if (root instanceof Element && root.hasAttribute(ORIG_ATTR)) found.unshift(root)

  for (const el of found) restoreOne(el, true)
}
