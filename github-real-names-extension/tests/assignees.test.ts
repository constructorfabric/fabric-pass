import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  findAssigneeCells,
  readAssigneeCell,
  restoreAssigneeCells,
  rewriteAssigneeCells,
} from '../src/entrypoints/content/assignees'
import { removeAllDecorations, scanAndDecorate } from '../src/entrypoints/content/decorate'

/**
 * Fixture — snapshot of the Assignees column of a GitHub Projects table view, taken
 * live via the DevTools protocol (see PLAN.md, "Очередь: колонка Assignees в GitHub
 * Projects"). `jalankulkija` and `Bechma` are deliberately absent from `lookup` below —
 * that is what exercises the "unresolved login" paths.
 */
function fixtureDoc(): Document {
  const html = readFileSync(join(__dirname, 'fixtures/github', 'projects-assignees.html'), 'utf8')
  return new DOMParser().parseFromString(html, 'text/html')
}

const registry: Record<string, string> = {
  ainetx: 'Anatoly Bobrov',
  artifizer: 'Alexander Andreev',
}
const lookup = (loginKey: string): string | undefined => registry[loginKey]

/** The five real assignee cells, in document order (see the fixture's own header comment). */
function textCells(doc: Document): Element[] {
  return Array.from(doc.querySelectorAll('span[data-component="Text"]'))
}

describe('findAssigneeCells', () => {
  it('finds exactly 5 cells on the fixture', () => {
    const doc = fixtureDoc()
    expect(findAssigneeCells(doc.body)).toHaveLength(5)
  })

  it('the Title cell (negative control) is not among them', () => {
    const doc = fixtureDoc()
    const titleCell = textCells(doc).find((el) => el.textContent === 'DEVX - Umbrella issue for the SDK')
    expect(titleCell).toBeDefined()
    expect(findAssigneeCells(doc.body)).not.toContain(titleCell)
  })

  it('the global-nav avatar (negative control) contributes no candidate at all', () => {
    // It has no `span[data-component="Text"]` sibling whatsoever — if it somehow were
    // picked up, the total above would be 6, not 5.
    const doc = fixtureDoc()
    const cells = findAssigneeCells(doc.body)
    for (const cell of cells) {
      expect(cell.closest('.GlobalNavUserMenu-module__container__NaVIt')).toBeNull()
    }
  })
})

describe('rewriteAssigneeCells — fixture cells', () => {
  it('single known assignee (ainetx) → name in text, login in title', () => {
    const doc = fixtureDoc()
    const cell = textCells(doc)[0]
    if (!cell) throw new Error('cell 0 not found')

    rewriteAssigneeCells(doc.body, lookup)

    expect(cell.textContent).toBe('Anatoly Bobrov')
    expect(cell.getAttribute('title')).toBe('ainetx')
  })

  it('single unknown assignee (jalankulkija) → completely untouched, no title', () => {
    const doc = fixtureDoc()
    const cell = textCells(doc)[2]
    if (!cell) throw new Error('cell 2 not found')
    const before = cell.outerHTML

    rewriteAssigneeCells(doc.body, lookup)

    expect(cell.outerHTML).toBe(before)
    expect(cell.textContent).toBe('jalankulkija')
    expect(cell.getAttribute('title')).toBeNull()
  })

  it('two known assignees (ainetx and Artifizer) → names joined with ", ", login list in title', () => {
    const doc = fixtureDoc()
    const cell = textCells(doc)[3]
    if (!cell) throw new Error('cell 3 not found')

    rewriteAssigneeCells(doc.body, lookup)

    expect(cell.textContent).toBe('Anatoly Bobrov, Alexander Andreev')
    expect(cell.getAttribute('title')).toBe('ainetx and Artifizer')
    expect(cell.getAttribute('data-ghname-assignees')).toBe('ainetx,artifizer')
  })

  it('one known, one unknown (Artifizer and Bechma) → only the known one is substituted', () => {
    const doc = fixtureDoc()
    const cell = textCells(doc)[4]
    if (!cell) throw new Error('cell 4 not found')

    rewriteAssigneeCells(doc.body, lookup)

    expect(cell.textContent).toBe('Alexander Andreev, Bechma')
    expect(cell.getAttribute('title')).toBe('Artifizer and Bechma')
  })

  it('running the rewrite twice changes nothing', () => {
    const doc = fixtureDoc()

    rewriteAssigneeCells(doc.body, lookup)
    const after1 = doc.body.innerHTML

    rewriteAssigneeCells(doc.body, lookup)
    const after2 = doc.body.innerHTML

    expect(after2).toBe(after1)
  })
})

describe('restoreAssigneeCells', () => {
  it('returns text and title to exactly the original, and removes every data-ghname-* attribute', () => {
    const doc = fixtureDoc()
    const before = doc.body.innerHTML

    rewriteAssigneeCells(doc.body, lookup)
    expect(doc.body.innerHTML).not.toBe(before)

    restoreAssigneeCells(doc.body)

    expect(doc.body.innerHTML).toBe(before)
  })
})

describe('React re-render invalidates stale bookkeeping', () => {
  it('after el.textContent is replaced directly, the next rewrite treats the new text as original', () => {
    const doc = fixtureDoc()
    const cell = textCells(doc)[0]
    if (!cell) throw new Error('cell 0 not found')

    rewriteAssigneeCells(doc.body, lookup)
    expect(cell.textContent).toBe('Anatoly Bobrov')
    expect(cell.getAttribute('title')).toBe('ainetx')

    // Simulate React re-rendering the cell with a fresh, unrelated login that isn't in
    // the registry — the bookkeeping from the previous rewrite is now stale.
    cell.textContent = 'Bechma'

    rewriteAssigneeCells(doc.body, lookup)

    // Bechma doesn't resolve, so the cell must end up completely untouched — no stale
    // title and no stale data-ghname-orig left over from the ainetx rewrite.
    expect(cell.textContent).toBe('Bechma')
    expect(cell.getAttribute('title')).toBeNull()
    expect(cell.getAttribute('data-ghname-orig')).toBeNull()
    expect(cell.getAttribute('data-ghname-text')).toBeNull()
  })

  it('readAssigneeCell on an already-rewritten cell still returns the logins, not the names', () => {
    const doc = fixtureDoc()
    const cell = textCells(doc)[3]
    if (!cell) throw new Error('cell 3 not found')

    rewriteAssigneeCells(doc.body, lookup)
    expect(cell.textContent).toBe('Anatoly Bobrov, Alexander Andreev')

    const result = readAssigneeCell(cell)

    expect(result?.logins).toEqual(['ainetx', 'Artifizer'])
    expect(result?.certain).toBe(true)
  })
})

describe('readAssigneeCell — synthetic cells', () => {
  /**
   * Builds `<div><span><!-- n avatar imgs --></span><span data-component="Text">text</span></div>` —
   * an `AvatarStack`-shaped wrapper (avatars only, no text of its own) followed by the
   * text cell, mirroring the real markup's shape regardless of how many avatars it holds.
   */
  function buildCell(avatarCount: number, text: string): Element {
    const container = document.createElement('div')
    const wrapper = document.createElement('span')
    for (let i = 0; i < avatarCount; i++) {
      const img = document.createElement('img')
      img.setAttribute('src', `https://avatars.githubusercontent.com/u/${i}?s=40`)
      wrapper.appendChild(img)
    }
    container.appendChild(wrapper)
    const span = document.createElement('span')
    span.setAttribute('data-component', 'Text')
    span.textContent = text
    container.appendChild(span)
    return span
  }

  it('a three-avatar cell with a trailing "and" resolves all three names, certain: true', () => {
    const cell = buildCell(3, 'alpha, beta, and gamma')

    const result = readAssigneeCell(cell)

    expect(result?.logins).toEqual(['alpha', 'beta', 'gamma'])
    expect(result?.certain).toBe(true)
  })

  it('a token count matching neither n nor n + 1 is uncertain', () => {
    // One avatar, but the text names two people — a mismatch that can't be resolved
    // positionally: tokens.length (3, including "and") is neither n (1) nor n + 1 (2).
    const cell = buildCell(1, 'foo and bar')

    const result = readAssigneeCell(cell)

    expect(result?.certain).toBe(false)
    expect(result?.logins).toEqual(['foo', 'and', 'bar'])
  })

  it('the uncertain case falls back to in-place substitution, keeping GitHub separators', () => {
    const cell = buildCell(1, 'foo and bar')
    const container = cell.parentElement
    if (!container) throw new Error('cell has no parent')
    const fooLookup = (loginKey: string): string | undefined => (loginKey === 'foo' ? 'Foo Name' : undefined)

    rewriteAssigneeCells(container, fooLookup)

    expect(cell.textContent).toBe('Foo Name and bar')
  })
})

describe('end-to-end through the public decorate.ts API', () => {
  it('scanAndDecorate rewrites the assignee cells, removeAllDecorations restores them byte-for-byte', () => {
    const doc = fixtureDoc()
    const before = doc.body.innerHTML

    scanAndDecorate(doc.body, lookup, 'parens')
    expect(textCells(doc)[0]?.textContent).toBe('Anatoly Bobrov')
    expect(doc.body.innerHTML).not.toBe(before)

    removeAllDecorations(doc.body)

    expect(doc.body.innerHTML).toBe(before)
  })
})
