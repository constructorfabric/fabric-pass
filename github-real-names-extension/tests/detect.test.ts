import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { extractLogin, findUserElements } from '../src/entrypoints/content/detect'

/**
 * Fixtures — saved real pages from microsoft/vscode (see PLAN.md §7).
 * The numbers below are ACTUAL, measured on these files via happy-dom, not
 * "by eye" expectations: `pr-conversation.html` contains one extra `data-hovercard-type="user"`
 * on a `<span>` element (not `<a>`, nothing to decorate — it's not a link), so the real
 * count of user LINKS is one less than the count of such attributes in the source.
 * `issues-list.html` and `pulls-list.html` additionally give a couple of logins via the
 * fallback path (`href` with no hovercard attributes at all, with text equal to the login) —
 * this is expected behavior of the fallback channel, not noise.
 *
 * `pr-list-react.html` is the exception: a hand-written synthetic fixture (not a page
 * dump) reproducing the newer React pull request list, which sets no hovercard
 * attributes on author links at all — measured live via the Chrome DevTools protocol
 * (0 `data-hovercard-url` elements on `/pulls`, versus dozens on the other page types).
 */
function fixtureDoc(name: string): Document {
  const html = readFileSync(join(__dirname, 'fixtures/github', name), 'utf8')
  return new DOMParser().parseFromString(html, 'text/html')
}

function extractedLogins(doc: Document): string[] {
  return findUserElements(doc)
    .map((el) => extractLogin(el))
    .filter((login): login is string => login !== undefined)
}

describe('pr-conversation.html', () => {
  const doc = fixtureDoc('pr-conversation.html')
  const logins = extractedLogins(doc)

  it('finds 9 user links', () => {
    expect(logins).toHaveLength(9)
  })

  it('all links are the same unique login sandy081', () => {
    expect(new Set(logins)).toEqual(new Set(['sandy081']))
  })
})

describe('issues-list.html', () => {
  const doc = fixtureDoc('issues-list.html')
  const logins = extractedLogins(doc)

  it('finds 14 unique logins', () => {
    expect(new Set(logins).size).toBe(14)
  })

  it('microsoft is not among the logins — regression on parsing org/search-query href', () => {
    expect(logins).not.toContain('microsoft')
  })
})

describe('pulls-list.html', () => {
  const doc = fixtureDoc('pulls-list.html')
  const logins = extractedLogins(doc)

  it('finds 20 user links', () => {
    expect(logins).toHaveLength(20)
  })

  it('18 of them are unique logins — some people appear on the page twice', () => {
    expect(new Set(logins).size).toBe(18)
  })

  it('microsoft is not among the logins', () => {
    expect(logins).not.toContain('microsoft')
  })
})

describe('pr-list-react.html — the React pull request list sets no hovercard attributes', () => {
  const doc = fixtureDoc('pr-list-react.html')

  it('finds the human logins via the author-filter-link fallback', () => {
    expect(extractedLogins(doc)).toHaveLength(2)
  })

  it('the logins are the three PR authors, including the bot', () => {
    // GitHub renders App accounts as `github-actions[bot]` while the href still carries the
    // bare `github-actions`, so the text-equals-login check rejects them. That is deliberate:
    // bots have no real name to show, and loosening the check to strip the suffix would widen
    // the rule for no benefit. Verified against the live pull request list.
    expect(new Set(extractedLogins(doc))).toEqual(new Set(['lobster40', 'alice-dev']))
  })

  it('a filter link whose text does not match the login in href is skipped', () => {
    const mismatched = Array.from(doc.querySelectorAll('a[data-testid="author-filter-link"]')).find(
      (el) => el.textContent?.trim() === 'Filter by author',
    )
    expect(mismatched).toBeDefined()
    expect(extractLogin(mismatched as Element)).toBeUndefined()
  })

  it('the organization breadcrumb link is not recognized as a login', () => {
    const org = Array.from(doc.querySelectorAll('a')).find((el) => el.textContent?.trim() === 'constructorfabric')
    expect(org).toBeDefined()
    expect(extractLogin(org as Element)).toBeUndefined()
  })
})

describe('pulls-dashboard.html — the global dashboard renders the author-filter element as a <button> with no href', () => {
  const doc = fixtureDoc('pulls-dashboard.html')
  const logins = extractedLogins(doc)

  it('finds exactly the two human logins', () => {
    expect(new Set(logins)).toEqual(new Set(['lobster40', 'mozhaev-dev']))
  })

  it('finds nothing else — no repository names and no dependabot[bot]', () => {
    expect(logins).toHaveLength(2)
    expect(logins).not.toContain('constructorfabric/gears-rust')
    expect(logins).not.toContain('constructorfabric/studio')
    expect(logins).not.toContain('dependabot[bot]')
  })
})

describe('commits-list.html — negative fixture: the page renders client-side', () => {
  const doc = fixtureDoc('commits-list.html')

  it('the detector does not throw and honestly finds zero user links', () => {
    expect(() => findUserElements(doc)).not.toThrow()
    expect(extractedLogins(doc)).toHaveLength(0)
  })
})

describe('filter-dropdown.html — dropdown filter popover (Author/Assignee/Reviewer/…)', () => {
  const doc = fixtureDoc('filter-dropdown.html')

  it('finds one login candidate per row, from the --label span text', () => {
    expect(extractedLogins(doc)).toEqual([
      'registered-only-login',
      'unregistered-login',
      'AndrejK666',
      'no-registry-login',
    ])
  })

  it('findUserElements returns the label span itself, not the surrounding li', () => {
    const elements = findUserElements(doc)
    for (const el of elements) {
      expect(el.tagName).toBe('SPAN')
      expect(el.id.endsWith('--label')).toBe(true)
    }
  })

  it('a label row with no avatar at all is not a candidate, even though its text (docs) passes LOGIN_RE', () => {
    const labelSpan = doc.getElementById('item-5--label')
    expect(labelSpan).not.toBeNull()
    expect(findUserElements(doc)).not.toContain(labelSpan)
    expect(extractLogin(labelSpan as Element)).toBeUndefined()
  })

  it('a row with a non-avatar image (github.githubassets.com) is not a candidate', () => {
    const labelSpan = doc.getElementById('item-6--label')
    expect(labelSpan).not.toBeNull()
    expect(findUserElements(doc)).not.toContain(labelSpan)
    expect(extractLogin(labelSpan as Element)).toBeUndefined()
  })
})

describe('extractLogin — rules from PLAN.md §6', () => {
  it('takes the login from data-hovercard-url, even if href leads to a search query', () => {
    const a = document.createElement('a')
    a.setAttribute('data-hovercard-url', '/users/johnpapa/hovercard')
    a.setAttribute('href', '/microsoft/vscode/issues?q=is%3Aissue+author%3Ajohnpapa')
    a.textContent = 'johnpapa'
    expect(extractLogin(a)).toBe('johnpapa')
  })

  it('data-hovercard-type other than user (organization) — authoritative refusal, href is not used', () => {
    const a = document.createElement('a')
    a.setAttribute('data-hovercard-type', 'organization')
    a.setAttribute('data-hovercard-url', '/orgs/microsoft/hovercard')
    a.setAttribute('href', '/microsoft')
    a.textContent = 'microsoft'
    expect(extractLogin(a)).toBeUndefined()
  })

  it('fallback href path: a single-segment path and text equal to the segment', () => {
    const a = document.createElement('a')
    a.setAttribute('href', '/sandy081')
    a.textContent = 'sandy081'
    expect(extractLogin(a)).toBe('sandy081')
  })

  it('fallback href path accepts text with a leading @', () => {
    const a = document.createElement('a')
    a.setAttribute('href', '/sandy081')
    a.textContent = '@sandy081'
    expect(extractLogin(a)).toBe('sandy081')
  })

  it('fallback href path rejects a multi-segment path', () => {
    const a = document.createElement('a')
    a.setAttribute('href', '/microsoft/vscode')
    a.textContent = 'microsoft/vscode'
    expect(extractLogin(a)).toBeUndefined()
  })

  it('fallback href path rejects text that does not match the segment', () => {
    const a = document.createElement('a')
    a.setAttribute('href', '/sandy081')
    a.textContent = 'Sandeep Somavarapu'
    expect(extractLogin(a)).toBeUndefined()
  })

  it('fallback href path filters out reserved paths', () => {
    const a = document.createElement('a')
    a.setAttribute('href', '/settings')
    a.textContent = 'settings'
    expect(extractLogin(a)).toBeUndefined()
  })

  it('author-filter-link fallback: reads the login from author: in href, text matches case-insensitively', () => {
    const a = document.createElement('a')
    a.setAttribute('href', '/constructorfabric/gears-rust/pulls?q=is%3Apr+state%3Aopen+author%3ALobster40')
    a.textContent = 'lobster40'
    expect(extractLogin(a)).toBe('Lobster40')
  })

  it('author-filter-link fallback: rejects a link whose text does not match the author: login', () => {
    const a = document.createElement('a')
    a.setAttribute('href', '/constructorfabric/gears-rust/pulls?q=is%3Apr+state%3Aopen+author%3Alobster40')
    a.textContent = 'Filter by author'
    expect(extractLogin(a)).toBeUndefined()
  })

  it('author-filter-link fallback: does not fire without an author: parameter in href', () => {
    const a = document.createElement('a')
    a.setAttribute('href', '/constructorfabric/gears-rust/pulls?q=is%3Apr+state%3Aopen')
    a.textContent = 'lobster40'
    expect(extractLogin(a)).toBeUndefined()
  })

  it('author-filter-link text fallback: a <button> with no href is read from its own text', () => {
    const button = document.createElement('button')
    button.setAttribute('data-testid', 'author-filter-link')
    button.textContent = 'lobster40'
    expect(extractLogin(button)).toBe('lobster40')
  })

  it('author-filter-link text fallback: does not fire when the element has an href — the stronger href rule owns that case', () => {
    const a = document.createElement('a')
    a.setAttribute('data-testid', 'author-filter-link')
    a.setAttribute('href', '/constructorfabric/gears-rust/pulls?q=is%3Apr+state%3Aopen+author%3Alobster41')
    a.textContent = 'lobster40'
    // The href says `lobster41`, the text says `lobster40` — if the text fallback took
    // over here it would silently accept the mismatch that `loginFromAuthorFilterHref`
    // is specifically designed to reject.
    expect(extractLogin(a)).toBeUndefined()
  })

  it('author-filter-link text fallback: rejects text that does not pass LOGIN_RE (the sibling repo-filter-link button)', () => {
    const button = document.createElement('button')
    button.setAttribute('data-testid', 'repo-filter-link')
    button.textContent = 'constructorfabric/gears-rust'
    expect(extractLogin(button)).toBeUndefined()
  })

  it('author-filter-link text fallback: rejects dependabot[bot] — bots have no registry entry', () => {
    const button = document.createElement('button')
    button.setAttribute('data-testid', 'author-filter-link')
    button.textContent = 'dependabot[bot]'
    expect(extractLogin(button)).toBeUndefined()
  })

  it('ActionList label fallback: a span whose id ends with --label is read as a login (row has an avatar)', () => {
    const li = document.createElement('li')
    li.setAttribute('role', 'option')
    const img = document.createElement('img')
    img.setAttribute('src', 'https://avatars.githubusercontent.com/u/20254119?s=64')
    const span = document.createElement('span')
    span.id = '_r_1g_--label'
    span.textContent = 'AndrejK666'
    li.append(img, span)
    expect(extractLogin(span)).toBe('AndrejK666')
  })

  it('ActionList label fallback: rejects text that does not pass LOGIN_RE (row has an avatar)', () => {
    const li = document.createElement('li')
    li.setAttribute('role', 'option')
    const img = document.createElement('img')
    img.setAttribute('src', 'https://avatars.githubusercontent.com/u/20254119?s=64')
    const span = document.createElement('span')
    span.id = '_r_1g_--label'
    span.textContent = 'Filter by author'
    li.append(img, span)
    expect(extractLogin(span)).toBeUndefined()
  })

  it('ActionList label fallback: does not fire on a span whose id does not end with --label', () => {
    const span = document.createElement('span')
    span.id = '_r_1g_--inline-description'
    span.textContent = 'ANDREI KUCHMA'
    expect(extractLogin(span)).toBeUndefined()
  })

  it('ActionList label fallback: requires a GitHub avatar image in the same row', () => {
    const li = document.createElement('li')
    li.setAttribute('role', 'option')
    const span = document.createElement('span')
    span.id = '_r_1g_--label'
    span.textContent = 'lobster40'
    li.appendChild(span)
    // No avatar image at all — must be rejected.
    expect(extractLogin(span)).toBeUndefined()

    const img = document.createElement('img')
    img.setAttribute('src', 'https://avatars.githubusercontent.com/u/20254119?s=64')
    li.prepend(img)
    // Now that the row has a GitHub avatar, the same span is accepted.
    expect(extractLogin(span)).toBe('lobster40')
  })

  it('ActionList label fallback: an avatar-shaped image from a different host does not count', () => {
    const li = document.createElement('li')
    li.setAttribute('role', 'option')
    const img = document.createElement('img')
    img.setAttribute('src', 'https://github.githubassets.com/images/icons/label.svg')
    const span = document.createElement('span')
    span.id = '_r_1g_--label'
    span.textContent = 'bug'
    li.append(img, span)
    expect(extractLogin(span)).toBeUndefined()
  })
})

/**
 * The repository owner's breadcrumb link and everything else in the page header is
 * navigation, not a mention of a person. Seen live on
 * `github.com/constructorfabric/studio/issues`: the popup listed the ORGANIZATION
 * `constructorfabric` among the page's logins, because in the logged-in AppHeader that
 * link carries no hovercard attributes and so falls through to the `href` rule.
 */
describe('extractLogin — the repo owner and the page header are not people', () => {
  function anchor(href: string, text: string): HTMLAnchorElement {
    const a = document.createElement('a')
    a.setAttribute('href', href)
    a.textContent = text
    return a
  }

  it('the owner of the repository being viewed is not taken as a login', () => {
    history.pushState({}, '', '/constructorfabric/studio/issues')
    expect(extractLogin(anchor('/constructorfabric', 'constructorfabric'))).toBeUndefined()
  })

  it('on a profile page the same link IS a person — the rule does not apply there', () => {
    history.pushState({}, '', '/vasylcf')
    expect(extractLogin(anchor('/vasylcf', 'vasylcf'))).toBe('vasylcf')
  })

  it('other logins on a repository page are still resolved', () => {
    history.pushState({}, '', '/constructorfabric/studio/issues')
    expect(extractLogin(anchor('/allprogrammers', 'allprogrammers'))).toBe('allprogrammers')
  })

  it('a hovercard link to the owner still wins — the guard only touches the href fallback', () => {
    history.pushState({}, '', '/lobster40/studio/issues')
    const a = anchor('/lobster40', 'lobster40')
    a.setAttribute('data-hovercard-url', '/users/lobster40/hovercard')
    expect(extractLogin(a)).toBe('lobster40')
  })

  it('a single-segment link inside the page header is navigation, not a mention', () => {
    history.pushState({}, '', '/constructorfabric/studio/issues')
    const header = document.createElement('header')
    const a = anchor('/sandy081', 'sandy081')
    header.appendChild(a)
    expect(extractLogin(a)).toBeUndefined()
  })
})
