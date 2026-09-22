import { describe, expect, it } from 'vitest'

import type { CollectLoginsResponse } from '../src/core/messages'
import { MANUAL_SOURCE_ID, type Contributor, type MergedIndex, type Source } from '../src/core/types'
import {
  buildManualContributor,
  buildUpdatedManualSource,
  isGithubUrl,
  shouldShowPassSignedOutHint,
  splitLogins,
  statusForSilentContentScript,
  upsertIntoRecords,
} from '../src/entrypoints/popup/logic'

describe('isGithubUrl', () => {
  it('true for https://github.com/foo', () => {
    expect(isGithubUrl('https://github.com/foo')).toBe(true)
  })

  it('true for a bare https://github.com/', () => {
    expect(isGithubUrl('https://github.com/')).toBe(true)
  })

  it('false for gist.github.com — a different host', () => {
    expect(isGithubUrl('https://gist.github.com')).toBe(false)
  })

  it('false for notgithub.com', () => {
    expect(isGithubUrl('https://notgithub.com')).toBe(false)
  })

  it('false for undefined', () => {
    expect(isGithubUrl(undefined)).toBe(false)
  })

  it('false for chrome://extensions', () => {
    expect(isGithubUrl('chrome://extensions')).toBe(false)
  })
})

describe('statusForSilentContentScript — the content script stayed silent', () => {
  it('a known GitHub URL means the script is simply not injected yet', () => {
    expect(statusForSilentContentScript('https://github.com/acme/repo/pulls')).toBe('no-content-script')
  })

  it('an unknown URL (no host permission) is reported as "not a GitHub page"', () => {
    expect(statusForSilentContentScript(undefined)).toBe('not-github')
  })

  it('a known non-GitHub URL is reported as "not a GitHub page"', () => {
    expect(statusForSilentContentScript('https://example.com')).toBe('not-github')
  })
})

describe('shouldShowPassSignedOutHint — cold-start explanation (PLAN-PASS.md §6 risk 3)', () => {
  it('never signed in + unnamed logins on the page — show the hint', () => {
    expect(shouldShowPassSignedOutHint('never', 3)).toBe(true)
  })

  it('signed out + unnamed logins on the page — show the hint', () => {
    expect(shouldShowPassSignedOutHint('unauthenticated', 1)).toBe(true)
  })

  it('never signed in but everything already named — nothing to explain', () => {
    expect(shouldShowPassSignedOutHint('never', 0)).toBe(false)
  })

  it('pass answered ok — no hint even with unnamed logins (they are just unknown to pass)', () => {
    expect(shouldShowPassSignedOutHint('ok', 2)).toBe(false)
  })

  it('network-error — not a sign-in problem, no hint', () => {
    expect(shouldShowPassSignedOutHint('network-error', 2)).toBe(false)
  })

  it('status unknown (message rejected, service worker asleep) — no hint', () => {
    expect(shouldShowPassSignedOutHint(undefined, 2)).toBe(false)
  })
})

describe('splitLogins', () => {
  function response(logins: CollectLoginsResponse['logins']): CollectLoginsResponse {
    return { logins }
  }

  it('a login present in idx ends up in named with the name from the index', () => {
    const idx: MergedIndex = { sandy081: ['Sandeep Somavarapu', 'manual'] }
    const result = splitLogins(response([{ login: 'sandy081', loginKey: 'sandy081', decorated: true }]), idx)

    expect(result.named).toEqual([{ login: 'sandy081', loginKey: 'sandy081', displayName: 'Sandeep Somavarapu' }])
    expect(result.unnamed).toEqual([])
  })

  it('a login with no entry in idx ends up in unnamed', () => {
    const idx: MergedIndex = {}
    const result = splitLogins(response([{ login: 'octocat', loginKey: 'octocat', decorated: false }]), idx)

    expect(result.unnamed).toEqual([{ login: 'octocat', loginKey: 'octocat' }])
    expect(result.named).toEqual([])
  })

  it('an empty response gives empty named and unnamed', () => {
    const result = splitLogins(response([]), {})
    expect(result).toEqual({ named: [], unnamed: [] })
  })
})

describe('buildManualContributor', () => {
  it('login_key — the login in lowercase', () => {
    const contributor = buildManualContributor('AnatolyB', 'Anatoly Bobrov')
    expect(contributor.login_key).toBe('anatolyb')
  })

  it('display_name is taken from the entered text', () => {
    const contributor = buildManualContributor('anatolyb', 'Anatoly Bobrov')
    expect(contributor.display_name).toBe('Anatoly Bobrov')
  })

  it('trims spaces around the login and name', () => {
    const contributor = buildManualContributor('  anatolyb  ', '  Anatoly Bobrov  ')
    expect(contributor.github_login).toBe('anatolyb')
    expect(contributor.display_name).toBe('Anatoly Bobrov')
  })

  it('github_login keeps the case as on the page', () => {
    const contributor = buildManualContributor('AnatolyB', 'Anatoly Bobrov')
    expect(contributor.github_login).toBe('AnatolyB')
  })
})

describe('upsertIntoRecords', () => {
  function contributor(login: string, name: string): Contributor {
    return { github_login: login, login_key: login.toLowerCase(), display_name: name }
  }

  it('adds a new record if login_key was not seen before', () => {
    const records = [contributor('alice', 'Alice')]
    const result = upsertIntoRecords(records, contributor('bob', 'Bob'))

    expect(result).toEqual([contributor('alice', 'Alice'), contributor('bob', 'Bob')])
  })

  it('replaces an existing record by login_key, without spawning duplicates', () => {
    const records = [contributor('alice', 'Alice'), contributor('bob', 'Bob')]
    const result = upsertIntoRecords(records, contributor('bob', 'Bob Updated'))

    expect(result).toHaveLength(2)
    expect(result.filter((r) => r.login_key === 'bob')).toHaveLength(1)
    expect(result.find((r) => r.login_key === 'bob')?.display_name).toBe('Bob Updated')
  })

  it('keeps the position of the replaced record and the order of the rest', () => {
    const records = [contributor('alice', 'Alice'), contributor('bob', 'Bob'), contributor('carol', 'Carol')]
    const result = upsertIntoRecords(records, contributor('bob', 'Bob Updated'))

    expect(result.map((r) => r.login_key)).toEqual(['alice', 'bob', 'carol'])
  })

  it('an empty record list + a new record → a list of one record', () => {
    const result = upsertIntoRecords([], contributor('alice', 'Alice'))
    expect(result).toEqual([contributor('alice', 'Alice')])
  })
})

describe('buildUpdatedManualSource', () => {
  function manualSource(): Source {
    return {
      id: MANUAL_SOURCE_ID,
      kind: 'manual',
      label: 'Manual edits',
      enabled: true,
      importedAt: '2020-01-01T00:00:00.000Z',
      rawText: '{}',
      stats: { total: 0, imported: 0, skipped: [] },
    }
  }

  it('rawText after saving parses to exactly the same set of records as in records', () => {
    const records = [buildManualContributor('alice', 'Alice'), buildManualContributor('bob', 'Bob')]
    const updated = buildUpdatedManualSource(manualSource(), records)

    const parsed = JSON.parse(updated.rawText ?? '[]') as Array<{ github_login: string; name: string }>
    expect(parsed.map((r) => r.github_login)).toEqual(records.map((r) => r.github_login))
    expect(parsed.map((r) => r.name)).toEqual(records.map((r) => r.display_name))
  })

  it('stats.imported and stats.total match the number of records, skipped is empty', () => {
    const records = [buildManualContributor('alice', 'Alice'), buildManualContributor('bob', 'Bob')]
    const updated = buildUpdatedManualSource(manualSource(), records)

    expect(updated.stats).toEqual({ total: 2, imported: 2, skipped: [] })
  })

  it('keeps the layer metadata (id/kind/label/enabled), does not inherit the old importedAt', () => {
    const source = manualSource()
    const updated = buildUpdatedManualSource(source, [buildManualContributor('alice', 'Alice')])

    expect(updated.id).toBe(source.id)
    expect(updated.kind).toBe(source.kind)
    expect(updated.label).toBe(source.label)
    expect(updated.enabled).toBe(source.enabled)
    expect(updated.importedAt).not.toBe(source.importedAt)
  })
})
