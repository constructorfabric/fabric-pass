import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { PASS_MAX_CACHE_AGE_MS } from '../src/core/config'
import { formatName } from '../src/core/format'
import { t } from '../src/core/i18n'
import {
  buildSkippedExport,
  downloadJson,
  FORMAT_PREVIEW,
  formatDate,
  formatImportSummary,
  formatParseErrors,
  importFailed,
  importPipeline,
  passStatusLabel,
  skipReasonLabel,
} from '../src/entrypoints/options/logic'
import type { DisplayFormat, Source } from '../src/core/types'

function fixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf8')
}

function sourceWithSkipped(overrides: Partial<Source> = {}): Source {
  return {
    id: 'src-1',
    kind: 'json',
    label: 'hand.broken.semantic.json',
    enabled: true,
    importedAt: '2026-09-09T10:00:00.000Z',
    stats: {
      total: 2,
      imported: 0,
      skipped: [
        { index: 0, login: 'noname', reason: 'no_name' },
        { index: 1, reason: 'no_login', detail: 'no login field' },
      ],
    },
    ...overrides,
  }
}

describe('skipReasonLabel', () => {
  it('no_name → human-readable text, not a code', () => {
    expect(skipReasonLabel('no_name')).toBe(t('skipReasonNoName'))
  })

  it('name_equals_login → human-readable text', () => {
    expect(skipReasonLabel('name_equals_login')).toBe(t('skipReasonNameEqualsLogin'))
  })

  it('no_login → human-readable text', () => {
    expect(skipReasonLabel('no_login')).toBe(t('skipReasonNoLogin'))
  })

  it('draft → human-readable text', () => {
    expect(skipReasonLabel('draft')).toBe(t('skipReasonDraft'))
  })

  it('agent → human-readable text', () => {
    expect(skipReasonLabel('agent')).toBe(t('skipReasonAgent'))
  })

  it('invalid_record → human-readable text', () => {
    expect(skipReasonLabel('invalid_record')).toBe(t('skipReasonInvalidRecord'))
  })

  it('duplicate_login → human-readable text', () => {
    expect(skipReasonLabel('duplicate_login')).toBe(t('skipReasonDuplicateLogin'))
  })
})

describe('buildSkippedExport', () => {
  it('exports valid JSON with a record count equal to stats.skipped', () => {
    const json = buildSkippedExport(sourceWithSkipped())
    const parsed = JSON.parse(json) as { skipped: unknown[] }
    expect(parsed.skipped).toHaveLength(2)
  })

  it('translates the reason into reasonLabel, not leaving the user with a bare code', () => {
    const json = buildSkippedExport(sourceWithSkipped())
    const parsed = JSON.parse(json) as { skipped: Array<{ reason: string; reasonLabel: string }> }
    expect(parsed.skipped[0]?.reasonLabel).toBe(t('skipReasonNoName'))
  })
})

describe('formatImportSummary', () => {
  it('with no errors and no skips — only counters', () => {
    const summary = formatImportSummary({ total: 3, imported: 3, skipped: [] }, [])
    expect(summary).toBe(`${t('importSummaryTotal', '3')} ${t('importSummaryImported', '3')}`)
  })

  it('with skips and errors — mentions both, with the error position', () => {
    const summary = formatImportSummary(
      { total: 5, imported: 3, skipped: [{ index: 3, reason: 'no_name' }, { index: 4, reason: 'no_login' }] },
      [{ line: 7, column: 2, message: 'hanging comma' }],
    )
    expect(summary).toContain(t('importSummarySkipped', '2'))
    expect(summary).toContain(`${t('errorLineColumn', ['7', '2'])}hanging comma`)
  })
})

describe('formatDate', () => {
  it('formats an ISO date in the short format of the current locale', () => {
    const iso = '2026-09-09T10:15:00.000Z'
    const expected = new Intl.DateTimeFormat('en', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso))
    expect(formatDate(iso)).toBe(expected)
  })

  it('returns an invalid string as-is, not "Invalid Date"', () => {
    expect(formatDate('not a date')).toBe('not a date')
  })
})

describe('importPipeline — contributors.subset.yaml', () => {
  const result = importPipeline(fixture('contributors.subset.yaml'), 'contributors.subset.yaml')

  it('recognizes the yaml format', () => {
    expect(result.format).toBe('yaml')
  })

  it('imports 9 out of 13 records, skips 4', () => {
    expect(result.stats.total).toBe(13)
    expect(result.records).toHaveLength(9)
    expect(result.stats.skipped).toHaveLength(4)
  })

  it('ktursunov is skipped as name_equals_login, max0xf — as no_name', () => {
    const reasons = result.stats.skipped.map((s) => s.reason)
    expect(reasons).toContain('name_equals_login')
    expect(reasons).toContain('no_name')
    expect(result.stats.skipped.find((s) => s.login === 'ktursunov')?.reason).toBe('name_equals_login')
    expect(result.stats.skipped.find((s) => s.login === 'max0xf')?.reason).toBe('no_name')
  })
})

describe('importPipeline — mapping.csv', () => {
  const result = importPipeline(fixture('mapping.csv'), 'mapping.csv')

  it('recognizes the csv format and foreign field names (github/real_name)', () => {
    expect(result.format).toBe('csv')
    expect(result.records).toHaveLength(3)
  })

  it('skips nothing — all three rows are valid', () => {
    expect(result.stats.skipped).toHaveLength(0)
  })
})

describe('importFailed — general "file not parsed at all" check for file and URL import (code review defect 2)', () => {
  it('broken syntax (0 records, has errors) — import failed completely', () => {
    const result = importPipeline(fixture('hand.broken.syntax.json'), 'hand.broken.syntax.json')
    expect(importFailed(result)).toBe(true)
  })

  it('semantically broken file (some records still imported) — not considered a complete failure', () => {
    const result = importPipeline(fixture('hand.broken.semantic.json'), 'hand.broken.semantic.json')
    expect(importFailed(result)).toBe(false)
  })

  it('a valid file with no errors — not considered a failure', () => {
    const result = importPipeline(fixture('mapping.csv'), 'mapping.csv')
    expect(importFailed(result)).toBe(false)
  })
})

describe('formatParseErrors', () => {
  it('includes the line and column number, not just the message text', () => {
    expect(formatParseErrors([{ line: 7, column: 2, message: 'hanging comma' }])).toBe(
      `${t('errorLineColumn', ['7', '2'])}hanging comma`,
    )
  })

  it('multiple errors are joined with « / »', () => {
    expect(formatParseErrors([{ message: 'first' }, { message: 'second' }])).toBe('first / second')
  })
})

describe('passStatusLabel', () => {
  it('never — hasn\'t connected to pass yet', () => {
    expect(passStatusLabel({ lastStatus: 'never' })).toBe(t('passStatusNever'))
  })

  it('ok — a plain positive line', () => {
    expect(passStatusLabel({ lastStatus: 'ok' })).toBe(t('passStatusOk'))
  })

  it('unauthenticated — explains the person isn\'t signed in, not "error"', () => {
    expect(passStatusLabel({ lastStatus: 'unauthenticated' })).toBe(t('passStatusUnauthenticated'))
  })

  it('network-error includes the lastError text', () => {
    const label = passStatusLabel({ lastStatus: 'network-error', lastError: 'Network unavailable.' })
    expect(label).toContain('Network unavailable.')
  })

  it('network-error without lastError falls back to the generic default', () => {
    expect(passStatusLabel({ lastStatus: 'network-error' })).toBe(
      t('passStatusNetworkError', t('passStatusNetworkErrorDefault')),
    )
  })

  it('expired mentions the configured number of days', () => {
    const days = String(Math.round(PASS_MAX_CACHE_AGE_MS / 86_400_000))
    expect(passStatusLabel({ lastStatus: 'expired' })).toBe(t('passStatusExpired', days))
  })
})

describe('downloadJson — the anchor must be in the document at click time (code review defect 4)', () => {
  it('adds <a> to the document before .click() and removes it afterward', () => {
    let wasInDocumentAtClickTime = false
    const originalClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      wasInDocumentAtClickTime = document.body.contains(this)
    }

    try {
      downloadJson('{}', 'test.json')
    } finally {
      HTMLAnchorElement.prototype.click = originalClick
    }

    expect(wasInDocumentAtClickTime).toBe(true)
  })
})

describe('importPipeline — hand.broken.semantic.json', () => {
  const result = importPipeline(fixture('hand.broken.semantic.json'), 'hand.broken.semantic.json')

  it('valid records pass through despite broken neighbors', () => {
    expect(result.records).toHaveLength(2)
    expect(result.records.map((r) => r.github_login).sort()).toEqual(['anatolyb', 'jdoe123'])
  })

  it('skipped records are listed with reasons: no_login and duplicate_login are present', () => {
    const reasons = result.stats.skipped.map((s) => s.reason)
    expect(reasons).toContain('no_login')
    expect(reasons).toContain('duplicate_login')
    expect(result.stats.skipped).toHaveLength(4)
  })
})

describe('FORMAT_PREVIEW — the settings preview must not drift from what actually gets inserted', () => {
  const formats: DisplayFormat[] = ['parens', 'brackets', 'brackets-reversed']

  for (const f of formats) {
    it(`${f}: matches formatName`, () => {
      expect(FORMAT_PREVIEW[f]).toBe(formatName('anatolyb', 'Anatoly Bobrov', f))
    })
  }
})
