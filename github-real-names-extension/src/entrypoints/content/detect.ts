/**
 * Extracting a GitHub login from a DOM element.
 *
 * The order was verified against real HTML from four GitHub pages (see
 * `tests/fixtures/github/`), not assumptions — details in PLAN.md §6.
 *
 * 1. `data-hovercard-url="/users/<login>/hovercard"` — the primary and practically
 *    the only reliable source: present on 100% of user links across all verified
 *    fixtures.
 * 2. `href` — a fallback only, and only if the path consists of a SINGLE segment
 *    AND the element's visible text (after trim, without a leading `@`) matches
 *    that segment, AND the link is not page navigation rather than a mention of a
 *    person (see `isNavigationChrome` and `currentRepoOwner`).
 * 3. The pull request list author-filter link, used by the React-based list
 *    component that renders NO hovercard attributes at all (measured live: 0
 *    `data-hovercard-url` elements on `/pulls`, versus dozens on `/issues`,
 *    `/commits/main` and `/pull/:number`). The login is read from the
 *    `author:<login>` query parameter in the (decoded) `href`, and accepted only
 *    if the element's visible text equals that login case-insensitively.
 * 4. The dropdown filter popovers (Author / Assignee / Reviewer / …), rendered by
 *    Primer's `ActionList` component with ZERO hovercard attributes as well (verified
 *    live against a logged-in `constructorfabric/gears-rust/pulls` page — see
 *    PLAN.md, "Dropdown filter markup" backlog entry). Each option is a
 *    `<li role="option">` whose login sits in a plain `<span>`, not an `<a>` — the
 *    span's `id` ends with `--label` and the `<li>`'s `aria-labelledby` points at that
 *    same id, which is Primer's own convention, not a GitHub-specific one. The
 *    span's text is accepted as a login only if it passes `LOGIN_RE` AND the row has
 *    a GitHub avatar image — see `hasUserAvatar`: the same `ActionList` component also
 *    renders label, milestone and sort-order pickers, none of which have an avatar.
 * 5. The global pull request dashboard (`/pulls`, `/pulls/involves`, `/pulls/reviews`),
 *    which renders the SAME author-filter component as source 3 above, but as a
 *    `<button>` with NO `href` at all rather than an `<a>` — measured live: there is no
 *    repository in scope to build a `?author:<login>` search query against on a
 *    cross-repository dashboard, so GitHub renders a plain, unclickable button instead of
 *    a link (verified: 0 elements with `data-hovercard-url`, 25
 *    `button[data-testid="author-filter-link"]`, and no per-row avatars on `/pulls/involves`).
 *    With no `href` to parse and no hovercard attribute, the element's own trimmed text IS
 *    the login, gated by `LOGIN_RE` — which is also what keeps the sibling
 *    `repo-filter-link` button (text `owner/repo`) out, since a slash never passes it.
 *
 * `href` can't be taken as the first source: on issue/PR list pages a user link's
 * `href` often doesn't lead to the profile but to a search query —
 * `/microsoft/vscode/issues?q=is%3Aissue+author%3Ajohnpapa`. The first segment of
 * such a path is `microsoft`; a naive parse would give an organization name instead
 * of a person.
 *
 * If an element has `data-hovercard-url`/`data-hovercard-type` but they say it's NOT
 * a user (organization, repository, bot app, etc.), the `href` fallback is not used —
 * this is an authoritative signal that must be trusted completely, rather than trying
 * to guess the login from the link text on top of it.
 */

/** A valid GitHub login. Exported: `assignees.ts` reuses it rather than duplicating the pattern. */
export const LOGIN_RE = /^[A-Za-z\d](?:[A-Za-z\d]|-(?=[A-Za-z\d])){0,38}$/

/** Reserved top-level paths — just in case, though the rule
 *  "element text equals path segment" already filters out almost all of this on its own. */
const RESERVED_PATHS = new Set([
  'orgs',
  'settings',
  'notifications',
  'features',
  'about',
  'pricing',
  'login',
  'join',
  'sponsors',
  'marketplace',
  'explore',
  'topics',
  'collections',
  'events',
  'codespaces',
  'apps',
])

/** Extracts the path from `href`: both relative (`/sandy081`) and absolute (`https://github.com/sandy081`). */
function pathnameOf(href: string): string {
  if (href.startsWith('http://') || href.startsWith('https://')) {
    try {
      return new URL(href).pathname
    } catch {
      return href
    }
  }
  return href
}

/** Non-empty path segments, without query/hash — those are already stripped from href by the browser attribute. */
function pathSegments(href: string): string[] {
  return pathnameOf(href).split('/').filter((s) => s.length > 0)
}

/** Login from `data-hovercard-url`, if it's in the form `/users/<login>/hovercard`. */
function loginFromHovercardUrl(hovercardUrl: string): string | undefined {
  const match = /^\/users\/([^/]+)\/hovercard(?:$|[/?#])/.exec(hovercardUrl)
  if (!match) return undefined
  const login = match[1]
  return login !== undefined && LOGIN_RE.test(login) ? login : undefined
}

/**
 * The owner of the repository being viewed — the first path segment of the CURRENT
 * page, but only on a repository page (two segments or more). On `/<owner>/<repo>/...`
 * the header breadcrumb links to `/<owner>` with the owner's name as its text, which
 * is exactly the shape the `href` fallback accepts — and in the logged-in AppHeader
 * that link carries NO hovercard attributes, so the organization got read as if it
 * were a person (seen live: the popup listed `constructorfabric` among the logins on
 * `constructorfabric/studio/issues`). A link to the owner of the repo you're looking
 * at is navigation, not someone being mentioned.
 *
 * Deliberately NOT applied on a profile page (`/<login>`, a single segment): there the
 * page IS the person and links to them should still resolve. And on a repo owned by a
 * person rather than an organization, that person is still decorated everywhere they're
 * actually mentioned — those links all carry `data-hovercard-url` and never reach this
 * fallback.
 */
function currentRepoOwner(): string | undefined {
  const segments = pathSegments(location.pathname)
  if (segments.length < 2) return undefined
  const owner = segments[0]
  if (!owner || RESERVED_PATHS.has(owner.toLowerCase())) return undefined
  return owner.toLowerCase()
}

/**
 * Whether the element sits in the page's navigation chrome rather than its content.
 * The global GitHub header is a `<header>` (`role="banner"`), and the single-segment
 * links in it — the breadcrumb owner, your own avatar menu — are navigation, not
 * mentions. Only the `href` fallback consults this: a hovercard link inside the header
 * is still an authoritative user link and keeps working.
 */
function isNavigationChrome(el: Element): boolean {
  return el.closest('header, [role="banner"]') !== null
}

/** Fallback `href` parsing: only a single-segment path with text equal to that segment. */
function loginFromHref(el: Element): string | undefined {
  const href = el.getAttribute('href')
  if (!href) return undefined

  const segments = pathSegments(href)
  if (segments.length !== 1) return undefined
  const segment = segments[0]
  if (!segment) return undefined

  if (segment.toLowerCase() === currentRepoOwner()) return undefined
  if (isNavigationChrome(el)) return undefined

  const text = el.textContent?.trim() ?? ''
  if (text === '') return undefined
  const textWithoutAt = text.startsWith('@') ? text.slice(1) : text
  if (text !== segment && textWithoutAt !== segment) return undefined

  if (RESERVED_PATHS.has(segment.toLowerCase())) return undefined
  if (!LOGIN_RE.test(segment)) return undefined
  return segment
}

/**
 * Fallback for the React pull request list, which sets no hovercard attributes
 * on the author link at all. The login is taken from the `author:<login>` query
 * parameter in the (decoded) `href`, and accepted ONLY if the element's visible
 * text equals that login (case-insensitively).
 *
 * Deliberately NOT used as signals:
 * - the CSS class (e.g. `PullsListItem-module__filterLink__a5ZnW`) — it embeds a
 *   build hash that changes on every GitHub deploy;
 * - `aria-label` (e.g. `Filter by author lobster40`) — it's localized UI text and
 *   will read differently for a user with another interface language;
 * - `data-testid="author-filter-link"` alone — testids get renamed too, and using
 *   it as the deciding factor would still need the text-equals-login check anyway.
 *
 * The `author:` + text-equals-login combination is both more precise and more
 * durable than any of the above. The text check is mandatory: without it, this
 * rule would also match things like a sidebar "filter by author" widget, whose
 * `href` carries the same `author:<login>` parameter but whose visible text is a
 * human-facing label, not the login.
 */
function loginFromAuthorFilterHref(el: Element): string | undefined {
  const href = el.getAttribute('href')
  if (!href) return undefined

  let decoded: string
  try {
    decoded = decodeURIComponent(href)
  } catch {
    decoded = href
  }

  const match = /author:([^+&]+)/.exec(decoded)
  if (!match) return undefined
  const login = match[1]
  if (!login) return undefined

  const text = el.textContent?.trim() ?? ''
  if (text === '') return undefined
  if (text.toLowerCase() !== login.toLowerCase()) return undefined

  if (!LOGIN_RE.test(login)) return undefined
  return login
}

/**
 * Fallback for the global pull request dashboard (`/pulls`, `/pulls/involves`,
 * `/pulls/reviews`), where the author-filter component renders as a `<button>` with NO
 * `href` at all — measured live: there is no single repository in scope there to build
 * an `author:<login>` search query against, so GitHub drops the link entirely rather
 * than reusing `loginFromAuthorFilterHref`'s query-parameter trick.
 *
 * Only fires when there is no `href` to read: an author-filter element that DOES have
 * one is the repo-level `<a>` already owned by `loginFromAuthorFilterHref`, which
 * cross-checks the login against the `author:` query parameter — a stronger check than
 * this function can offer, and this rule must never pre-empt it.
 *
 * With no `href` and no hovercard attribute, there is genuinely nothing else on this
 * element to key on: the CSS-module class (`PullsListItem-module__filterLink__a5ZnW`)
 * embeds a build hash that changes on every GitHub deploy, `aria-label` ("Filter by
 * author lobster40") is localized UI text, and the row has no avatar image at all
 * (measured: 1 avatar on the whole `/pulls/involves` page — the viewer's own, in the
 * header). So `data-testid="author-filter-link"` — normally distrusted as a signal,
 * same as everywhere else in this file — is what says "this is the author"; if GitHub
 * renames it the rule simply goes quiet rather than misfiring on something else.
 * `LOGIN_RE` is still the deciding gate on the text itself: it is what keeps the
 * sibling `repo-filter-link` button ("owner/repo", rejected for its slash) out, and it
 * also rejects `dependabot[bot]` — which is the desired outcome, since bots have no
 * entry in the registry.
 */
function loginFromAuthorFilterText(el: Element): string | undefined {
  if (el.getAttribute('data-testid') !== 'author-filter-link') return undefined
  if (el.hasAttribute('href')) return undefined

  const text = el.textContent?.trim() ?? ''
  if (text === '' || !LOGIN_RE.test(text)) return undefined
  return text
}

/**
 * Whether the `ActionList` row containing `el` has a GitHub avatar image — the
 * signal that separates a user row (Author / Assignee / Reviewer picker) from a
 * label, milestone or sort-order row built on the very same component. Verified live:
 * only user rows carry an `<img src>` on `avatars.githubusercontent.com`.
 *
 * Not used yet, but worth recording here since it was found alongside this rule: the
 * avatar URL embeds the numeric account id (`/u/20254119`), which matches the
 * registry's `github_id` field. If matching by id instead of by visible login text is
 * ever needed, this is the element to read it from.
 */
function hasUserAvatar(el: Element): boolean {
  const row = el.closest('li[role="option"]')
  if (!row) return false
  return row.querySelector('img[src*="avatars.githubusercontent.com"]') !== null
}

/**
 * Login for a dropdown filter popover row (Author / Assignee / Reviewer / …), where
 * hovercard attributes are absent entirely. The row's own visible text IS the
 * login — Primer's `ActionList` convention is a `<span>` whose `id` ends with
 * `--label`, referenced by the row's `aria-labelledby`. Deliberately NOT scoped to
 * `data-component="ActionList.Item"` alone, nor to the listbox's `aria-label`
 * (localized) or `data-testid="item-picker-root"` (shared by every picker, not just
 * user pickers) — `hasUserAvatar` plus `LOGIN_RE` is the combination that actually
 * tells a person row apart from a label/milestone/sort-order row on the same
 * component.
 */
function loginFromActionListLabel(el: Element): string | undefined {
  if (!el.id.endsWith('--label')) return undefined
  if (!hasUserAvatar(el)) return undefined

  const text = el.textContent?.trim() ?? ''
  if (text === '' || !LOGIN_RE.test(text)) return undefined
  return text
}

export function extractLogin(el: Element): string | undefined {
  const hovercardUrl = el.getAttribute('data-hovercard-url')
  if (hovercardUrl !== null) {
    // The attribute is present — this is an authoritative signal. If it's not in the
    // "user" form, the element is definitely not a user link, no need to go further
    // (not an org, not a repo, not a bot).
    return loginFromHovercardUrl(hovercardUrl)
  }

  const hovercardType = el.getAttribute('data-hovercard-type')
  if (hovercardType !== null && hovercardType !== 'user') {
    return undefined
  }

  return (
    loginFromHref(el) ??
    loginFromAuthorFilterHref(el) ??
    loginFromActionListLabel(el) ??
    loginFromAuthorFilterText(el)
  )
}

/**
 * Candidates for user links: the primary channel (hovercard) plus four fallbacks
 * (single-segment `href`, the React pull request list's author-filter link, the
 * dropdown filter popovers' `ActionList` label span, and the global pull request
 * dashboard's author-filter button). The final decision is up to `extractLogin`, here
 * we only collect candidates. We deliberately do NOT search the entire page text with a
 * regex: that produces false positives in comment bodies and in code.
 */
export function findUserElements(root: ParentNode): Element[] {
  const primary = Array.from(
    root.querySelectorAll('a[data-hovercard-url^="/users/"], a[data-hovercard-type="user"]'),
  )
  const seen = new Set<Element>(primary)

  const singleSegmentFallback = Array.from(root.querySelectorAll('a[href]')).filter((el) => {
    if (seen.has(el)) return false
    const href = el.getAttribute('href')
    return href !== null && pathSegments(href).length === 1
  })
  for (const el of singleSegmentFallback) seen.add(el)

  // `querySelectorAll` already de-duplicates elements matching more than one
  // selector in the group, so an anchor with both `href*="author%3A"` and
  // `data-testid="author-filter-link"` appears only once here. The test-id half is
  // deliberately NOT scoped to `a`: the very same component renders as an `<a href>`
  // on a repository's own pull request list, but as a plain `<button>` on the global
  // dashboard (`/pulls`, `/pulls/involves`, `/pulls/reviews`), because there is no
  // single repository in scope there to build a `?author:<login>` search query
  // against — measured live, 25 such buttons and zero such links on `/pulls/involves`.
  const authorFilterFallback = Array.from(
    root.querySelectorAll('a[href*="author%3A"], [data-testid="author-filter-link"]'),
  ).filter((el) => !seen.has(el))
  for (const el of authorFilterFallback) seen.add(el)

  // Scoped to `li[role="option"]` on purpose — the bare `[id$="--label"]` convention
  // is used by many Primer components, not just this one. `hasUserAvatar` further
  // excludes label/milestone/sort-order rows built on the same `ActionList` component,
  // which never carry a GitHub avatar. The <span> itself (not the <li>) is returned:
  // `decorate()` appends its span INSIDE this label span (see decorate.ts for why),
  // and giving it the <li> instead would both place the added text outside the row
  // entirely and defeat that insertion strategy.
  const actionListLabelFallback = Array.from(
    root.querySelectorAll('li[role="option"] span[id$="--label"]'),
  ).filter((el) => !seen.has(el) && hasUserAvatar(el))

  return [...primary, ...singleSegmentFallback, ...authorFilterFallback, ...actionListLabelFallback]
}
