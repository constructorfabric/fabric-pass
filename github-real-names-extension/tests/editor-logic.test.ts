import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  exampleSkeleton,
  exportMapping,
  jsonTextToRows,
  mergeAllRecords,
  recordsToJsonText,
  resolveEditorText,
  rowsToJsonText,
  suggestField,
  validateJsonText,
  type EditorRow,
} from '../src/entrypoints/options/editor-logic'
import { DEFAULT_SETTINGS } from '../src/core/types'
import type { Contributor, Settings, Source } from '../src/core/types'

function fixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf8')
}

describe('validateJsonText — shape A (flat map)', () => {
  const result = validateJsonText(fixture('hand.valid.a.json'))

  it('recognized as flat-map', () => {
    expect(result.ok).toBe(true)
    expect(result.shape).toBe('flat-map')
  })

  it('recordCount matches the number of login-name pairs', () => {
    expect(result.recordCount).toBe(3)
  })
})

describe('validateJsonText — shape B (array of objects)', () => {
  const result = validateJsonText(fixture('hand.valid.b.json'))

  it('recognized as array', () => {
    expect(result.ok).toBe(true)
    expect(result.shape).toBe('array')
  })

  it('recordCount matches the number of objects in the array', () => {
    expect(result.recordCount).toBe(3)
  })
})

describe('validateJsonText — shape C (contributors wrapper)', () => {
  const result = validateJsonText(fixture('hand.valid.c.json'))

  it('recognized as wrapped', () => {
    expect(result.ok).toBe(true)
    expect(result.shape).toBe('wrapped')
  })

  it('recordCount matches the number of records inside contributors', () => {
    expect(result.recordCount).toBe(2)
  })
})

describe('resolveEditorText — the same data in different shapes gives the same set of records', () => {
  const flatMap = '{ "anatolyb": "Anatoly Bobrov", "jdoe123": "John Doe" }'
  const array = JSON.stringify([
    { github_login: 'anatolyb', name: 'Anatoly Bobrov' },
    { github_login: 'jdoe123', name: 'John Doe' },
  ])
  const wrapped = JSON.stringify({
    contributors: [
      { github_login: 'anatolyb', name: 'Anatoly Bobrov' },
      { github_login: 'jdoe123', name: 'John Doe' },
    ],
  })

  function loginsAndNames(text: string): Array<[string, string]> {
    const parsed = resolveEditorText(text)
    if (!parsed.ok) throw new Error('expected a successful parse')
    return parsed.records
      .map((r): [string, string] => [r.login_key, r.display_name])
      .sort((a, b) => a[0].localeCompare(b[0]))
  }

  it('shape A and shape B give the same set of records', () => {
    expect(loginsAndNames(flatMap)).toEqual(loginsAndNames(array))
  })

  it('shape B and shape C give the same set of records', () => {
    expect(loginsAndNames(array)).toEqual(loginsAndNames(wrapped))
  })
})

describe('validateJsonText — syntax error', () => {
  const result = validateJsonText(fixture('hand.broken.syntax.json'))

  it('ok: false', () => {
    expect(result.ok).toBe(false)
  })

  it('syntaxError contains a defined line', () => {
    expect(result.syntaxError?.line).toBeDefined()
    expect(result.syntaxError?.line).toBeGreaterThan(0)
  })
})

describe('validateJsonText — semantically broken file', () => {
  const result = validateJsonText(fixture('hand.broken.semantic.json'))

  it('the file is still parsed (ok: true)', () => {
    expect(result.ok).toBe(true)
  })

  it('recordCount counts all records in the file, including problematic ones', () => {
    expect(result.recordCount).toBe(6)
  })

  it('problematic records are listed with positions and reasons', () => {
    expect(result.recordIssues.length).toBeGreaterThan(0)
    for (const issue of result.recordIssues) {
      expect(issue.index).toBeGreaterThanOrEqual(0)
      expect(issue.reason).toBeDefined()
    }
  })

  it('valid records (not in recordIssues) are counted', () => {
    expect(result.recordCount - result.recordIssues.length).toBe(2)
  })
})

describe('validateJsonText — foreign field names', () => {
  const result = validateJsonText(fixture('hand.foreign-fields.json'))

  it('all foreign field names are recognized, unknownFields is empty', () => {
    expect(result.unknownFields).toEqual([])
  })

  it('_note is not considered an unknown field', () => {
    expect(result.unknownFields.some((f) => f.field === '_note')).toBe(false)
  })
})

describe('validateJsonText — a field from IGNORED_FIELDS', () => {
  const text = JSON.stringify([
    { github_login: 'anatolyb', name: 'Anatoly Bobrov', profile_completeness: 100 },
  ])
  const result = validateJsonText(text)

  it('profile_completeness does not end up in unknownFields', () => {
    expect(result.unknownFields).toEqual([])
  })
})

describe('validateJsonText — a typo in a field name', () => {
  const text = JSON.stringify([{ login: 'typoguy', nmae: 'Wrong Key', fullName: 'Gregory Typo' }])
  const result = validateJsonText(text)

  it('nmae ends up in unknownFields with a name suggestion', () => {
    const warning = result.unknownFields.find((f) => f.field === 'nmae')
    expect(warning?.suggestion).toBe('name')
  })

  it('the record is still imported thanks to fullName', () => {
    const parsed = resolveEditorText(text)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.records.some((r) => r.login_key === 'typoguy')).toBe(true)
    }
  })
})

describe('suggestField', () => {
  it('nmae -> name', () => {
    expect(suggestField('nmae')).toBe('name')
  })

  it('emial -> email', () => {
    expect(suggestField('emial')).toBe('email')
  })

  it('campny -> company', () => {
    expect(suggestField('campny')).toBe('company')
  })

  it('usrname -> github_login', () => {
    expect(suggestField('usrname')).toBe('github_login')
  })

  it('logn -> github_login', () => {
    expect(suggestField('logn')).toBe('github_login')
  })

  it('a completely dissimilar string -> no suggestion', () => {
    expect(suggestField('xqzxyz-completely-unrelated-987')).toBeUndefined()
  })
})

describe('Round-trip Table -> JSON -> Table', () => {
  it('does not lose column fields', () => {
    const rows: EditorRow[] = [
      { github_login: 'anatolyb', name: 'Anatoly Bobrov', company: 'Acronis', email: 'a@example.com', extra: {} },
      { github_login: 'jdoe123', name: 'John Doe', company: '', email: '', extra: {} },
    ]
    const text = rowsToJsonText(rows)
    const roundTripped = jsonTextToRows(text)
    expect(roundTripped).toEqual(rows)
  })

  it('an empty row with no login is dropped', () => {
    const rows: EditorRow[] = [{ github_login: '', name: '', company: '', email: '', extra: {} }]
    const text = rowsToJsonText(rows)
    expect(jsonTextToRows(text)).toEqual([])
  })
})

describe('Round-trip JSON -> Table -> JSON — fields outside the four columns are not lost (T12)', () => {
  it('discord_username, status, is_admin, github_id and _note survive the table representation', () => {
    const original = [
      {
        github_login: 'anatolyb',
        github_id: '12345',
        name: 'Anatoly Bobrov',
        company: 'Acronis',
        email: 'a@example.com',
        discord_username: 'anatolyb',
        telegram_username: '@anatolyb',
        is_agent: false,
        is_admin: true,
        status: 'confirmed',
        _note: 'do not touch this field',
      },
    ]
    const text = JSON.stringify(original)

    const rows = jsonTextToRows(text)
    expect(rows[0]?.extra).toMatchObject({
      github_id: '12345',
      discord_username: 'anatolyb',
      telegram_username: '@anatolyb',
      is_agent: false,
      is_admin: true,
      status: 'confirmed',
      _note: 'do not touch this field',
    })

    const roundTripped = JSON.parse(rowsToJsonText(rows))
    expect(roundTripped).toEqual([original[0]])
  })

  it('the column value wins over a same-named key accidentally left in extra', () => {
    const rows: EditorRow[] = [
      {
        github_login: 'anatolyb',
        name: 'Changed In Table',
        company: '',
        email: '',
        extra: { name: 'Old Value From Extra' },
      },
    ]
    const parsed = JSON.parse(rowsToJsonText(rows)) as Array<{ name: string }>
    expect(parsed[0]?.name).toBe('Changed In Table')
  })
})

describe('Round-trip export -> import', () => {
  it('gives an identical set of records', () => {
    const original = resolveEditorText(fixture('hand.valid.b.json'))
    if (!original.ok) throw new Error('fixture expected to parse')

    const exported = exportMapping(original.records)
    const reimported = resolveEditorText(exported)
    if (!reimported.ok) throw new Error('exported mapping expected to parse')

    const simplify = (records: typeof original.records) =>
      records.map((r) => ({ login_key: r.login_key, display_name: r.display_name })).sort((a, b) =>
        a.login_key.localeCompare(b.login_key),
      )

    expect(simplify(reimported.records)).toEqual(simplify(original.records))
  })

  it('recordsToJsonText — shape B, recognized as array', () => {
    const text = recordsToJsonText([
      { github_login: 'anatolyb', login_key: 'anatolyb', display_name: 'Anatoly Bobrov' },
    ])
    expect(validateJsonText(text).shape).toBe('array')
  })
})

describe('exampleSkeleton', () => {
  const text = exampleSkeleton()
  const result = validateJsonText(text)

  it('valid JSON, recognized as shape B (array)', () => {
    expect(result.ok).toBe(true)
    expect(result.shape).toBe('array')
  })

  it('contains _note', () => {
    expect(text).toContain('_note')
  })

  it('_note does not end up in unknownFields', () => {
    expect(result.unknownFields.some((f) => f.field === '_note')).toBe(false)
  })
})

describe('jsonTextToRows/rowsToJsonText — clearing a column does not survive under a field synonym (code review defect 3)', () => {
  it('clearing the name with the fullName synonym really removes the name from JSON, not just leaves it under the synonym', () => {
    const text = JSON.stringify([{ login: 'alice', fullName: 'Alice Smith' }])
    const rows = jsonTextToRows(text)
    expect(rows[0]?.extra).toEqual({})

    const cleared = rows.map((r) => ({ ...r, name: '' }))
    const parsed = JSON.parse(rowsToJsonText(cleared)) as Array<Record<string, unknown>>
    expect(parsed[0]).toEqual({ github_login: 'alice' })
  })

  it('clearing the company with the org synonym really removes the company from JSON', () => {
    const text = JSON.stringify([{ github_login: 'bob', name: 'Bob', org: 'Acme' }])
    const rows = jsonTextToRows(text)
    expect(rows[0]?.extra).toEqual({})

    const cleared = rows.map((r) => ({ ...r, company: '' }))
    const parsed = JSON.parse(rowsToJsonText(cleared)) as Array<Record<string, unknown>>
    expect(parsed[0]).toEqual({ github_login: 'bob', name: 'Bob' })
  })

  it('clearing the email with the mail synonym really removes the email from JSON', () => {
    const text = JSON.stringify([{ github_login: 'carol', name: 'Carol', mail: 'carol@example.com' }])
    const rows = jsonTextToRows(text)
    expect(rows[0]?.extra).toEqual({})

    const cleared = rows.map((r) => ({ ...r, email: '' }))
    const parsed = JSON.parse(rowsToJsonText(cleared)) as Array<Record<string, unknown>>
    expect(parsed[0]).toEqual({ github_login: 'carol', name: 'Carol' })
  })

  it('synonyms for fields unrelated to the four columns still survive in extra', () => {
    const text = JSON.stringify([{ github_login: 'dan', name: 'Dan', discord: 'dan#1234' }])
    const rows = jsonTextToRows(text)
    expect(rows[0]?.extra).toEqual({ discord: 'dan#1234' })
  })
})

describe('mergeAllRecords — matches mergeIntoIndex, does not surface what settings hide (code review defect 5)', () => {
  function source(overrides: Partial<Source>): Source {
    return {
      id: 'src',
      kind: 'manual',
      label: 'Layer',
      enabled: true,
      importedAt: '2026-09-09T10:00:00.000Z',
      stats: { total: 0, imported: 0, skipped: [] },
      ...overrides,
    }
  }

  function contributor(overrides: Partial<Contributor>): Contributor {
    return { github_login: 'x', login_key: 'x', display_name: 'X', ...overrides }
  }

  it('bots do not end up in the merged set', () => {
    const sources = [source({ id: 'a' })]
    const records = { a: [contributor({ login_key: 'bot', is_agent: true })] }
    expect(mergeAllRecords(sources, records, DEFAULT_SETTINGS)).toEqual([])
  })

  it('drafts do not end up in the merged set if showDraft is off', () => {
    const sources = [source({ id: 'a' })]
    const records = { a: [contributor({ login_key: 'draft-user', status: 'draft' })] }
    const settings: Settings = { ...DEFAULT_SETTINGS, showDraft: false }
    expect(mergeAllRecords(sources, records, settings)).toEqual([])
  })

  it('drafts end up in the merged set if showDraft is on — matches idx', () => {
    const sources = [source({ id: 'a' })]
    const draft = contributor({ login_key: 'draft-user', status: 'draft' })
    const records = { a: [draft] }
    const settings: Settings = { ...DEFAULT_SETTINGS, showDraft: true }
    expect(mergeAllRecords(sources, records, settings)).toEqual([draft])
  })

  it('a disabled layer does not participate in the merge', () => {
    const sources = [source({ id: 'a', enabled: false })]
    const records = { a: [contributor({ login_key: 'x' })] }
    expect(mergeAllRecords(sources, records, DEFAULT_SETTINGS)).toEqual([])
  })

  it('on conflict, the higher-priority layer (first in the list) wins', () => {
    const sources = [source({ id: 'high' }), source({ id: 'low' })]
    const high = contributor({ login_key: 'x', display_name: 'Higher Priority' })
    const low = contributor({ login_key: 'x', display_name: 'Lower Priority' })
    const records = { high: [high], low: [low] }
    expect(mergeAllRecords(sources, records, DEFAULT_SETTINGS)).toEqual([high])
  })
})

describe('validateJsonText — a structure that does not match any shape', () => {
  const result = validateJsonText(JSON.stringify({ a: { b: 1 } }))

  it('ok: false', () => {
    expect(result.ok).toBe(false)
  })

  it('the message mentions all three shapes', () => {
    const message = result.syntaxError?.message ?? ''
    expect(message).toContain('A)')
    expect(message).toContain('B)')
    expect(message).toContain('C)')
  })
})

describe('empty editor text', () => {
  it.each([['', 'empty string'], ['   \n\t ', 'whitespace only']])('%s is not a syntax error', (text) => {
    const result = validateJsonText(text)
    expect(result.ok).toBe(true)
    expect(result.syntaxError).toBeUndefined()
    expect(result.recordCount).toBe(0)
    expect(result.recordIssues).toEqual([])
    expect(result.unknownFields).toEqual([])
  })

  it('resolveEditorText returns an empty record set, not a failure', () => {
    const parsed = resolveEditorText('')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.records).toEqual([])
    expect(parsed.stats).toEqual({ total: 0, imported: 0, skipped: [] })
  })

  it('jsonTextToRows on empty text gives no rows', () => {
    expect(jsonTextToRows('')).toEqual([])
  })
})
