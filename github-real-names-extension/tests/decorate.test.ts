import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

import { formatName, formatReplacement } from '../src/core/format'
import {
  decorate,
  redecorateAll,
  removeAllDecorations,
  scanAndDecorate,
} from '../src/entrypoints/content/decorate'

beforeEach(() => {
  document.body.innerHTML = ''
})

function userAnchor(login: string, text = login): HTMLAnchorElement {
  const a = document.createElement('a')
  a.setAttribute('data-hovercard-url', `/users/${login}/hovercard`)
  a.setAttribute('data-hovercard-type', 'user')
  a.setAttribute('href', `/${login}`)
  a.textContent = text
  return a
}

describe('formatName', () => {
  it('brackets: login [name]', () => {
    expect(formatName('anatolyb', 'Anatoly Bobrov', 'brackets')).toBe('anatolyb [Anatoly Bobrov]')
  })

  it('parens: login (name)', () => {
    expect(formatName('anatolyb', 'Anatoly Bobrov', 'parens')).toBe('anatolyb (Anatoly Bobrov)')
  })

  it('brackets-reversed: name [login]', () => {
    expect(formatName('anatolyb', 'Anatoly Bobrov', 'brackets-reversed')).toBe('Anatoly Bobrov [anatolyb]')
  })
})

describe('formatReplacement', () => {
  it('name [login] — the full text that REPLACES the login for brackets-reversed', () => {
    expect(formatReplacement('anatolyb', 'Anatoly Bobrov')).toBe('Anatoly Bobrov [anatolyb]')
  })
})

describe('decorate', () => {
  it('inserts a span RIGHT AFTER the element, not inside it', () => {
    const a = userAnchor('sandy081')
    document.body.appendChild(a)

    const ok = decorate(a, 'sandy081', 'Sandeep Somavarapu', 'parens')

    expect(ok).toBe(true)
    expect(a.textContent).toBe('sandy081')
    const span = a.nextElementSibling
    expect(span?.className).toBe('ghname-real')
    expect(span?.getAttribute('data-ghname-for')).toBe('sandy081')
    expect(span?.textContent).toBe(' (Sandeep Somavarapu)')
  })

  it('for brackets inserts the name in square brackets, does not rearrange the login on the page', () => {
    const a = userAnchor('anatolyb')
    document.body.appendChild(a)

    decorate(a, 'anatolyb', 'Anatoly Bobrov', 'brackets')

    expect(a.nextElementSibling?.textContent).toBe(' [Anatoly Bobrov]')
  })

  it('for parens inserts the name in parentheses', () => {
    const a = userAnchor('anatolyb')
    document.body.appendChild(a)

    decorate(a, 'anatolyb', 'Anatoly Bobrov', 'parens')

    expect(a.nextElementSibling?.textContent).toBe(' (Anatoly Bobrov)')
  })

  it('does not decorate a wrapper link around an img with no text', () => {
    const a = document.createElement('a')
    a.setAttribute('data-hovercard-url', '/users/sandy081/hovercard')
    const img = document.createElement('img')
    img.setAttribute('alt', '@sandy081')
    a.appendChild(img)
    document.body.appendChild(a)

    const ok = decorate(a, 'sandy081', 'Sandeep Somavarapu', 'parens')

    expect(ok).toBe(false)
    expect(a.nextElementSibling).toBeNull()
  })

  it('idempotent: a repeated call does not create a second insertion', () => {
    const a = userAnchor('sandy081')
    document.body.appendChild(a)

    const first = decorate(a, 'sandy081', 'Sandeep Somavarapu', 'parens')
    const second = decorate(a, 'sandy081', 'Sandeep Somavarapu', 'parens')

    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(document.body.querySelectorAll('.ghname-real')).toHaveLength(1)
  })

  it('the global dashboard author-filter <button> — the span is inserted AFTER it, not inside it', () => {
    const button = document.createElement('button')
    button.setAttribute('data-testid', 'author-filter-link')
    button.textContent = 'lobster40'
    document.body.appendChild(button)

    const ok = decorate(button, 'lobster40', 'Lobster Man', 'parens')

    expect(ok).toBe(true)
    expect(button.textContent).toBe('lobster40')
    const span = button.nextElementSibling
    expect(span?.className).toBe('ghname-real')
    expect(span?.textContent).toBe(' (Lobster Man)')
  })

  it('a React pull request list author-filter link — matches two candidate selectors at once, but is decorated only once', () => {
    // Matches BOTH `a[href*="author%3A"]` and `a[data-testid="author-filter-link"]`
    // in findUserElements' fallback — must still produce exactly one inserted span.
    const a = document.createElement('a')
    a.setAttribute('data-testid', 'author-filter-link')
    a.setAttribute(
      'href',
      '/constructorfabric/gears-rust/pulls?q=is%3Apr+state%3Aopen+author%3Alobster40',
    )
    a.textContent = 'lobster40'
    document.body.appendChild(a)

    scanAndDecorate(document.body, () => 'Lobster Man', 'parens')

    expect(document.body.querySelectorAll('.ghname-real')).toHaveLength(1)
    expect(a.nextElementSibling?.textContent).toBe(' (Lobster Man)')
  })
})

describe('decorate — brackets-reversed (rewrite strategy)', () => {
  it('rewrites the link text to "name [login]", inserts NO sibling span, and marks the element', () => {
    const a = document.createElement('a')
    a.setAttribute('href', '/anatolyb')
    a.textContent = 'anatolyb'
    document.body.appendChild(a)

    const ok = decorate(a, 'anatolyb', 'Anatoly Bobrov', 'brackets-reversed')

    expect(ok).toBe(true)
    expect(a.textContent).toBe('Anatoly Bobrov [anatolyb]')
    expect(a.nextElementSibling).toBeNull()
    expect(a.querySelector('.ghname-real')).toBeNull()
    expect(a.getAttribute('data-ghname-replaced')).toBe('anatolyb')
    expect(a.dataset.ghnameDone).toBe('true')
  })

  it('an <a> containing an <img> plus the login text keeps its <img> after the rewrite', () => {
    const a = document.createElement('a')
    a.setAttribute('href', '/anatolyb')
    const img = document.createElement('img')
    img.setAttribute('src', 'https://avatars.githubusercontent.com/u/1')
    a.append(img, document.createTextNode('anatolyb'))
    document.body.appendChild(a)

    const ok = decorate(a, 'anatolyb', 'Anatoly Bobrov', 'brackets-reversed')

    expect(ok).toBe(true)
    expect(a.querySelector('img')).toBe(img)
    expect(a.textContent).toBe('Anatoly Bobrov [anatolyb]')
  })

  it('idempotent: a repeated call does not rewrite the text twice', () => {
    const a = document.createElement('a')
    a.setAttribute('href', '/anatolyb')
    a.textContent = 'anatolyb'
    document.body.appendChild(a)

    const first = decorate(a, 'anatolyb', 'Anatoly Bobrov', 'brackets-reversed')
    const second = decorate(a, 'anatolyb', 'Anatoly Bobrov', 'brackets-reversed')

    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(a.textContent).toBe('Anatoly Bobrov [anatolyb]')
  })

  it('removeAllDecorations restores the original login text exactly and leaves no data-ghname-* attributes', () => {
    const a = document.createElement('a')
    a.setAttribute('href', '/anatolyb')
    a.textContent = 'anatolyb'
    document.body.appendChild(a)
    const before = document.body.innerHTML

    decorate(a, 'anatolyb', 'Anatoly Bobrov', 'brackets-reversed')
    expect(document.body.innerHTML).not.toBe(before)

    removeAllDecorations(document.body)

    expect(document.body.innerHTML).toBe(before)
    expect(a.getAttribute('data-ghname-replaced')).toBeNull()
    expect(a.getAttribute('data-ghname-orig-text')).toBeNull()
    expect(a.dataset.ghnameDone).toBeUndefined()
  })
})

/**
 * Builds a span shaped like `decorate()`'s own output, but with no owner next to it —
 * simulating what's left behind once React swaps out the `<a>` (or other element) that
 * span used to sit after. Real orphans are byte-for-byte indistinguishable from this:
 * `data-ghname-for` plus the class is all `collectOrphans` has to go on.
 */
function orphanSpan(login: string, text = ' [Orphaned Name]'): HTMLSpanElement {
  const span = document.createElement('span')
  span.className = 'ghname-real'
  span.setAttribute('data-ghname-for', login)
  span.textContent = text
  return span
}

describe('orphaned decorations (React sibling-replacement duplication)', () => {
  it('an orphan span with no owner is dropped, leaving only the fresh decoration', () => {
    const orphan = orphanSpan('sandy081')
    const a = userAnchor('sandy081')
    document.body.append(orphan, a)

    scanAndDecorate(document.body, () => 'Sandeep Somavarapu', 'parens')

    const spans = document.body.querySelectorAll('.ghname-real')
    expect(spans).toHaveLength(1)
    expect(a.nextElementSibling).toBe(spans[0])
  })

  it('regression for the measured four-fold duplication: three React replacement cycles never leave more than one span', () => {
    let a = userAnchor('sandy081')
    document.body.appendChild(a)
    scanAndDecorate(document.body, () => 'Sandeep Somavarapu', 'parens')
    expect(document.body.querySelectorAll('.ghname-real')).toHaveLength(1)

    // Each cycle mirrors what was measured live: React drops in a fresh anchor with a
    // new id and no `data-ghname-done`, but leaves the old span (now ownerless) in place.
    for (let i = 0; i < 3; i++) {
      const fresh = userAnchor('sandy081')
      a.replaceWith(fresh)
      a = fresh

      scanAndDecorate(document.body, () => 'Sandeep Somavarapu', 'parens')

      expect(document.body.querySelectorAll('.ghname-real')).toHaveLength(1)
    }
  })

  it('an orphan naming a different login than the anchor being decorated is collected too — an orphan has no owner regardless of which login it names', () => {
    const orphan = orphanSpan('otheruser')
    const a = userAnchor('sandy081')
    document.body.append(orphan, a)

    scanAndDecorate(document.body, () => 'Sandeep Somavarapu', 'parens')

    expect(document.body.querySelectorAll('.ghname-real')).toHaveLength(1)
    expect(document.body.querySelector('.ghname-real')?.getAttribute('data-ghname-for')).toBe('sandy081')
  })

  it('a legitimate decoration is not mistaken for an orphan: scanning twice over the same decorated anchor still leaves exactly one span', () => {
    const a = userAnchor('sandy081')
    document.body.appendChild(a)

    scanAndDecorate(document.body, () => 'Sandeep Somavarapu', 'parens')
    scanAndDecorate(document.body, () => 'Sandeep Somavarapu', 'parens')

    expect(document.body.querySelectorAll('.ghname-real')).toHaveLength(1)
  })

  it('a span appended INSIDE its owner (the dropdown-filter label strategy) is not mistaken for an orphan', () => {
    const doc = new DOMParser().parseFromString(
      readFileSync(join(__dirname, 'fixtures/github', 'filter-dropdown.html'), 'utf8'),
      'text/html',
    )
    const registry: Record<string, string> = { 'registered-only-login': 'Registered Name' }

    scanAndDecorate(doc.body, (loginKey) => registry[loginKey], 'parens')
    scanAndDecorate(doc.body, (loginKey) => registry[loginKey], 'parens')

    const li = doc.querySelector('li[role="option"]')
    const label = li?.querySelector('[id$="--label"]')
    expect(label?.querySelectorAll(':scope > .ghname-real')).toHaveLength(1)
  })
})

describe('scanAndDecorate', () => {
  it('decorates all found links for which lookup returned a name, and skips the rest', () => {
    const a1 = userAnchor('sandy081')
    const a2 = userAnchor('unknownUser')
    document.body.append(a1, a2)

    scanAndDecorate(document.body, (loginKey) => (loginKey === 'sandy081' ? 'Sandeep Somavarapu' : undefined), 'parens')

    expect(a1.nextElementSibling?.textContent).toBe(' (Sandeep Somavarapu)')
    expect(a2.nextElementSibling).toBeNull()
  })

  it('decorates the root itself if it matches the criteria (not only its descendants)', () => {
    const a = userAnchor('sandy081')
    document.body.appendChild(a)

    scanAndDecorate(a, () => 'Sandeep Somavarapu', 'parens')

    expect(a.nextElementSibling?.textContent).toBe(' (Sandeep Somavarapu)')
  })

  it('decorates the root itself with brackets-reversed (not only its descendants)', () => {
    const a = document.createElement('a')
    a.setAttribute('href', '/sandy081')
    a.textContent = 'sandy081'
    document.body.appendChild(a)

    scanAndDecorate(a, () => 'Sandeep Somavarapu', 'brackets-reversed')

    expect(a.textContent).toBe('Sandeep Somavarapu [sandy081]')
    expect(a.nextElementSibling).toBeNull()
  })
})

describe('redecorateAll', () => {
  it('replaces the span content on a format change, without spawning new nodes', () => {
    const a = userAnchor('sandy081')
    document.body.appendChild(a)
    scanAndDecorate(document.body, () => 'Sandeep Somavarapu', 'brackets')
    expect(a.nextElementSibling?.textContent).toBe(' [Sandeep Somavarapu]')

    redecorateAll(document.body, () => 'Sandeep Somavarapu', 'parens')

    expect(document.body.querySelectorAll('.ghname-real')).toHaveLength(1)
    expect(a.nextElementSibling?.textContent).toBe(' (Sandeep Somavarapu)')
  })

  it('parens → brackets: replaces the span content, without spawning new nodes', () => {
    const a = userAnchor('anatolyb')
    document.body.appendChild(a)
    scanAndDecorate(document.body, () => 'Anatoly Bobrov', 'parens')
    expect(a.nextElementSibling?.textContent).toBe(' (Anatoly Bobrov)')

    redecorateAll(document.body, () => 'Anatoly Bobrov', 'brackets')

    expect(document.body.querySelectorAll('.ghname-real')).toHaveLength(1)
    expect(a.nextElementSibling?.textContent).toBe(' [Anatoly Bobrov]')
  })

  it('removes the name for logins for which lookup no longer finds a name on a mapping change', () => {
    const a = userAnchor('sandy081')
    document.body.appendChild(a)
    scanAndDecorate(document.body, () => 'Sandeep Somavarapu', 'parens')

    redecorateAll(document.body, () => undefined, 'parens')

    expect(document.body.querySelectorAll('.ghname-real')).toHaveLength(0)
    expect((a as HTMLElement).dataset.ghnameDone).toBeUndefined()
  })

  it('brackets-reversed → parens: restores the login text and switches to an appended suffix, with no leftovers', () => {
    const a = document.createElement('a')
    a.setAttribute('href', '/anatolyb')
    a.textContent = 'anatolyb'
    document.body.appendChild(a)

    scanAndDecorate(a, () => 'Anatoly Bobrov', 'brackets-reversed')
    expect(a.textContent).toBe('Anatoly Bobrov [anatolyb]')

    redecorateAll(a, () => 'Anatoly Bobrov', 'parens')

    expect(a.textContent).toBe('anatolyb')
    expect(a.nextElementSibling?.textContent).toBe(' (Anatoly Bobrov)')
    expect(a.getAttribute('data-ghname-replaced')).toBeNull()
    expect(a.getAttribute('data-ghname-orig-text')).toBeNull()
  })

  it('parens → brackets-reversed and back: leaves the DOM in the expected state each time, with no leftovers', () => {
    const a = document.createElement('a')
    a.setAttribute('href', '/anatolyb')
    a.textContent = 'anatolyb'
    document.body.appendChild(a)
    const before = document.body.innerHTML

    // `document.body`, not `a`, is used as the root from here on: `parens` inserts a
    // span as a SIBLING of `a`, outside `a`'s own subtree, so a redraw scoped to `a`
    // itself would never find it.
    scanAndDecorate(document.body, () => 'Anatoly Bobrov', 'parens')
    expect(a.nextElementSibling?.textContent).toBe(' (Anatoly Bobrov)')

    redecorateAll(document.body, () => 'Anatoly Bobrov', 'brackets-reversed')
    expect(a.textContent).toBe('Anatoly Bobrov [anatolyb]')
    expect(a.nextElementSibling).toBeNull()

    redecorateAll(document.body, () => 'Anatoly Bobrov', 'parens')
    expect(a.textContent).toBe('anatolyb')
    expect(a.nextElementSibling?.textContent).toBe(' (Anatoly Bobrov)')

    removeAllDecorations(document.body)
    expect(document.body.innerHTML).toBe(before)
  })
})

describe('removeAllDecorations', () => {
  it('returns the DOM to its original state', () => {
    const a = userAnchor('sandy081')
    document.body.appendChild(a)
    const before = document.body.innerHTML

    scanAndDecorate(document.body, () => 'Sandeep Somavarapu', 'parens')
    expect(document.body.innerHTML).not.toBe(before)

    removeAllDecorations(document.body)

    expect(document.body.innerHTML).toBe(before)
  })
})

describe('dropdown filter popover (filter-dropdown.html) — registry takes priority over the GitHub-native name', () => {
  function fixtureDoc(name: string): Document {
    const html = readFileSync(join(__dirname, 'fixtures/github', name), 'utf8')
    return new DOMParser().parseFromString(html, 'text/html')
  }

  const registry: Record<string, string> = {
    'registered-only-login': 'Registered Name',
    andrejk666: 'Andrej',
    // Present on purpose: `docs`/`bug` are plausible label names that also pass
    // LOGIN_RE. If the avatar guard in `loginFromActionListLabel` regresses, these
    // rows would start showing a name too — see the tests below.
    docs: 'Documentation Team',
    bug: 'Bug Triage',
  }
  const lookup = (loginKey: string): string | undefined => registry[loginKey]

  function row(doc: Document, n: number): HTMLLIElement {
    const li = doc.querySelectorAll('li[role="option"]')[n]
    if (!(li instanceof HTMLLIElement)) throw new Error(`row ${n} not found`)
    return li
  }

  it('row without a GitHub name, login in the registry — the registry name appears', () => {
    const doc = fixtureDoc('filter-dropdown.html')
    scanAndDecorate(doc.body, lookup, 'parens')

    const li = row(doc, 0)
    expect(li.querySelector('.ghname-real')?.textContent).toBe(' (Registered Name)')
  })

  it('row without a GitHub name, login not in the registry — nothing changes', () => {
    const doc = fixtureDoc('filter-dropdown.html')
    const before = row(doc, 1).innerHTML

    scanAndDecorate(doc.body, lookup, 'parens')

    expect(row(doc, 1).innerHTML).toBe(before)
  })

  it('row with a GitHub name, login in the registry — the GitHub name is hidden, the registry name is shown', () => {
    const doc = fixtureDoc('filter-dropdown.html')
    scanAndDecorate(doc.body, lookup, 'parens')

    const li = row(doc, 2)
    const nativeName = li.querySelector('[id$="--inline-description"]')
    expect(nativeName?.getAttribute('data-ghname-hidden')).toBe('true')
    expect(li.querySelector('.ghname-real')?.textContent).toBe(' (Andrej)')
  })

  it('row with a GitHub name, login not in the registry — the GitHub name stays, nothing is added', () => {
    const doc = fixtureDoc('filter-dropdown.html')
    const before = row(doc, 3).innerHTML

    scanAndDecorate(doc.body, lookup, 'parens')

    expect(row(doc, 3).innerHTML).toBe(before)
  })

  it('a label row (docs) with no avatar is not decorated even though the registry has a name for it — the main false-positive guard', () => {
    const doc = fixtureDoc('filter-dropdown.html')
    const before = row(doc, 4).innerHTML

    scanAndDecorate(doc.body, lookup, 'parens')

    expect(row(doc, 4).innerHTML).toBe(before)
    expect(row(doc, 4).querySelector('.ghname-real')).toBeNull()
  })

  it('a row with a non-avatar image (bug) is not decorated even though the registry has a name for it', () => {
    const doc = fixtureDoc('filter-dropdown.html')
    const before = row(doc, 5).innerHTML

    scanAndDecorate(doc.body, lookup, 'parens')

    expect(row(doc, 5).innerHTML).toBe(before)
    expect(row(doc, 5).querySelector('.ghname-real')).toBeNull()
  })

  it('the added span lands INSIDE the id$="--label" element, not after it as a sibling — that is what keeps the gap even regardless of the row being grid or flex laid out', () => {
    const doc = fixtureDoc('filter-dropdown.html')
    scanAndDecorate(doc.body, lookup, 'parens')

    const label = row(doc, 0).querySelector('[id$="--label"]')
    expect(label).not.toBeNull()
    // Proves the span is a CHILD of the label, not its next sibling: if `decorate()`
    // had used `el.after(span)` here, the label itself would have gained a sibling
    // and this would be null instead.
    expect(label?.nextElementSibling).toBeNull()
    expect(label?.querySelector(':scope > .ghname-real')).not.toBeNull()
    expect(label?.textContent).toBe('registered-only-login (Registered Name)')
  })

  it('is fully reversible: after scanAndDecorate + removeAllDecorations, innerHTML matches the original byte-for-byte', () => {
    const doc = fixtureDoc('filter-dropdown.html')
    const before = doc.body.innerHTML

    scanAndDecorate(doc.body, lookup, 'parens')
    expect(doc.body.innerHTML).not.toBe(before)

    removeAllDecorations(doc.body)

    expect(doc.body.innerHTML).toBe(before)
  })

  it('is fully reversible byte-for-byte for the row where the GitHub profile name was hidden', () => {
    const doc = fixtureDoc('filter-dropdown.html')
    const li = row(doc, 2)
    const before = li.outerHTML

    scanAndDecorate(doc.body, lookup, 'parens')
    expect(li.outerHTML).not.toBe(before)

    removeAllDecorations(doc.body)

    expect(li.outerHTML).toBe(before)
  })

  it('redecorateAll on a format change does not spawn extra nodes and keeps the GitHub name hidden', () => {
    const doc = fixtureDoc('filter-dropdown.html')
    scanAndDecorate(doc.body, lookup, 'parens')

    redecorateAll(doc.body, lookup, 'brackets')

    const li = row(doc, 2)
    expect(li.querySelectorAll('.ghname-real')).toHaveLength(1)
    expect(li.querySelector('.ghname-real')?.textContent).toBe(' [Andrej]')
    expect(li.querySelector('[id$="--inline-description"]')?.getAttribute('data-ghname-hidden')).toBe('true')
  })

  it('redecorateAll on a format change does not spawn extra nodes for a row with no GitHub profile name (grid layout, no inline-description to hide)', () => {
    const doc = fixtureDoc('filter-dropdown.html')
    scanAndDecorate(doc.body, lookup, 'parens')

    redecorateAll(doc.body, lookup, 'brackets')

    const label = row(doc, 0).querySelector('[id$="--label"]')
    expect(label?.querySelectorAll('.ghname-real')).toHaveLength(1)
    expect(label?.querySelector('.ghname-real')?.textContent).toBe(' [Registered Name]')
  })
})

describe('ordinary page (pr-conversation.html) — regression: insertion stays after the link, never inside it', () => {
  function fixtureDoc(name: string): Document {
    const html = readFileSync(join(__dirname, 'fixtures/github', name), 'utf8')
    return new DOMParser().parseFromString(html, 'text/html')
  }

  it('the span sits after the <a>, not inside it — otherwise the added text would become part of the clickable link', () => {
    const doc = fixtureDoc('pr-conversation.html')

    scanAndDecorate(doc.body, () => 'Sandeep Somavarapu', 'parens')

    const links = Array.from(
      doc.querySelectorAll('a[data-hovercard-url="/users/sandy081/hovercard"]'),
    ).filter((a) => (a.textContent?.trim() ?? '') !== '')
    expect(links.length).toBeGreaterThan(0)

    for (const link of links) {
      // Never inside: the added text must not become part of the clickable link.
      expect(link.querySelector('.ghname-real')).toBeNull()
      expect(link.nextElementSibling?.className).toBe('ghname-real')
    }
  })
})

describe('performance budget', () => {
  function fixtureDoc(name: string): Document {
    const html = readFileSync(join(__dirname, 'fixtures/github', name), 'utf8')
    return new DOMParser().parseFromString(html, 'text/html')
  }

  /**
   * Takes the FASTEST of several runs rather than a single measurement.
   *
   * What this guards against is an order-of-magnitude regression in the scan, not the
   * wall-clock time of one run on a busy machine: a single run can be stalled by an
   * unrelated process or by GC, which used to make this assertion fail at random and,
   * now that CI gates releases on `npm run check`, would block a release for no reason.
   * The fastest run is the one least polluted by such noise, and a real regression slows
   * every run down, so it still gets caught.
   */
  function fastestRun(work: () => void, reset: () => void, runs = 7): number {
    let best = Infinity
    for (let i = 0; i < runs; i++) {
      reset()
      const start = performance.now()
      work()
      best = Math.min(best, performance.now() - start)
    }
    return best
  }

  it('a full pass over pr-conversation.html stays an order of magnitude under one frame', () => {
    const doc = fixtureDoc('pr-conversation.html')
    const lookup = (loginKey: string): string | undefined =>
      loginKey === 'sandy081' ? 'Sandeep Somavarapu' : undefined

    const elapsed = fastestRun(
      () => scanAndDecorate(doc.body, lookup, 'parens'),
      () => removeAllDecorations(doc.body),
    )

    expect(elapsed).toBeLessThan(16)
  })

  it('an incremental pass over a single added node — under 2ms', () => {
    const a = userAnchor('sandy081')
    document.body.appendChild(a)
    const lookup = (loginKey: string): string | undefined =>
      loginKey === 'sandy081' ? 'Sandeep Somavarapu' : undefined

    const elapsed = fastestRun(
      () => scanAndDecorate(a, lookup, 'parens'),
      () => removeAllDecorations(document.body),
    )

    expect(elapsed).toBeLessThan(2)
  })
})

/**
 * Regression: the login is not always the FIRST text node of the element it lives in.
 * `<a><span>by </span>anatolyb</a>` is the shape that breaks a restore driven by
 * "the first non-empty text node" — the rewrite touches the second node, so a restore
 * that guesses the first one would write the login into the wrong place and leave the
 * rewritten text on the page.
 */
describe('brackets-reversed — restore when the login is not the first text node', () => {
  it('restores the rewritten node and nothing else', () => {
    document.body.innerHTML = '<a href="/anatolyb"><span>by </span>anatolyb</a>'
    const a = document.querySelector('a') as HTMLAnchorElement

    decorate(a, 'anatolyb', 'Anatoly Bobrov', 'brackets-reversed')
    expect(a.textContent).toBe('by Anatoly Bobrov [anatolyb]')

    removeAllDecorations(document.body)
    expect(a.textContent).toBe('by anatolyb')
    expect(a.outerHTML).toBe('<a href="/anatolyb"><span>by </span>anatolyb</a>')
  })

  it('drops its attributes even when the text was replaced by a re-render', () => {
    document.body.innerHTML = '<a href="/anatolyb">anatolyb</a>'
    const a = document.querySelector('a') as HTMLAnchorElement

    decorate(a, 'anatolyb', 'Anatoly Bobrov', 'brackets-reversed')
    // What React does: same element, brand new text.
    a.textContent = 'anatolyb'

    removeAllDecorations(document.body)
    expect(a.textContent).toBe('anatolyb')
    expect(a.getAttributeNames().filter((n) => n.startsWith('data-ghname'))).toEqual([])
    expect(a.dataset.ghnameDone).toBeUndefined()
  })
})
