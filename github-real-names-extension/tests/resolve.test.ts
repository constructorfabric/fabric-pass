import { describe, it, expect } from 'vitest'

import { resolveRecords, pickName, normalizeForComparison, toTitleCase } from '../src/core/resolve'
import type { RawRecord } from '../src/core/types'

/** A compact RawRecord constructor for tests: only the needed fields + position. */
function raw(index: number, fields: Partial<RawRecord> = {}): RawRecord {
  return { _index: index, ...fields }
}

describe('resolveRecords — name source priority', () => {
  it('lobster40: github_name is empty, name wins', () => {
    const { records } = resolveRecords([raw(0, { github_login: 'lobster40', github_name: null, name: 'Anatoly Bobrov' })])
    expect(records[0]?.display_name).toBe('Anatoly Bobrov')
  })

  it('Artifizer: github_name matches the login, but name still wins', () => {
    const { records } = resolveRecords([raw(0, { github_login: 'Artifizer', github_name: 'Artifizer', name: 'Alexander Andreev' })])
    expect(records[0]?.display_name).toBe('Alexander Andreev')
  })

  it('AndrejK666: name is shorter and less informative, but still wins over github_name', () => {
    const { records } = resolveRecords([raw(0, { github_login: 'AndrejK666', github_name: 'ANDREI KUCHMA', name: 'Andrej' })])
    expect(records[0]?.display_name).toBe('Andrej')
  })
})

describe('resolveRecords — Title Case', () => {
  it('Andrei-Iliushin-Constructor: an all-caps name is converted to Title Case, raw_name keeps the original', () => {
    const { records } = resolveRecords([raw(0, { github_login: 'Andrei-Iliushin-Constructor', name: 'ANDREI ILIUSHIN' })])
    expect(records[0]?.display_name).toBe('Andrei Iliushin')
    expect(records[0]?.raw_name).toBe('ANDREI ILIUSHIN')
  })

  it('diffora: OLEKSII SHPONARSKYI -> Oleksii Shponarskyi', () => {
    const { records } = resolveRecords([raw(0, { github_login: 'diffora', name: 'OLEKSII SHPONARSKYI' })])
    expect(records[0]?.display_name).toBe('Oleksii Shponarskyi')
  })
})

describe('resolveRecords — the name matches the login', () => {
  it('ktursunov: name "KTursunov" matches the login after normalization -> skip', () => {
    const { records, stats } = resolveRecords([raw(0, { github_login: 'ktursunov', name: 'KTursunov' })])
    expect(records).toHaveLength(0)
    expect(stats.skipped[0]?.reason).toBe('name_equals_login')
  })

  it('MikeFalcon77: github_name "MikeY" — a nickname-like login, but name wins and is not mangled by Title Case', () => {
    const { records } = resolveRecords([raw(0, { github_login: 'MikeFalcon77', github_name: 'MikeY', name: 'Mike Yastrebtsov' })])
    expect(records[0]?.display_name).toBe('Mike Yastrebtsov')
    expect(records[0]?.raw_name).toBeUndefined()
  })
})

describe('resolveRecords — aliases', () => {
  it('claudedigon -> xiboliaren: display_name is taken from the target record', () => {
    const { records } = resolveRecords([
      raw(0, {
        github_login: 'claudedigon',
        github_id: '203880066',
        name: 'Claude Digon',
        alias_of_github_id: '192490142',
      }),
      raw(1, { github_login: 'xiboliaren', github_id: '192490142', name: 'Xi Boliaren' }),
    ])
    const claudedigon = records.find((r) => r.login_key === 'claudedigon')
    expect(claudedigon?.display_name).toBe('Xi Boliaren')
  })

  it('an alias to a missing target -> its own name is used', () => {
    const { records } = resolveRecords([
      raw(0, {
        github_login: 'claudedigon',
        github_id: '203880066',
        name: 'Claude M Digon',
        alias_of_github_id: '999999999',
      }),
    ])
    expect(records[0]?.display_name).toBe('Claude M Digon')
  })

  it('an alias with no own name but with an existing target -> the record is not skipped, name from the target', () => {
    const { records, stats } = resolveRecords([
      raw(0, {
        github_login: 'claudedigon',
        github_id: '203880066',
        name: null,
        github_name: null,
        alias_of_github_id: '192490142',
      }),
      raw(1, { github_login: 'targetuser', github_id: '192490142', name: 'Target Realname' }),
    ])
    expect(stats.skipped).toHaveLength(0)
    const claudedigon = records.find((r) => r.login_key === 'claudedigon')
    expect(claudedigon?.display_name).toBe('Target Realname')
  })

  it('the alias target exists but is nameless -> the record\'s own name is used (code review defect 3)', () => {
    const { records, stats } = resolveRecords([
      raw(0, {
        github_login: 'abobrov-alt',
        github_id: '203880066',
        name: 'Anatoly Bobrov',
        alias_of_github_id: '123',
      }),
      raw(1, { github_login: 'nameless-target', github_id: '123', name: null, github_name: null }),
    ])
    // Record #0 (the alias) is not skipped — it has its own name. Record #1 (the target
    // itself, a separate person in the set) is legitimately skipped by no_name — it
    // really has no name, and this has nothing to do with resolving record #0's alias.
    expect(stats.skipped.some((s) => s.index === 0)).toBe(false)
    const alias = records.find((r) => r.login_key === 'abobrov-alt')
    expect(alias?.display_name).toBe('Anatoly Bobrov')
  })

  it('an alias cycle (A -> B, B -> A) does not hang, both records get their own names', () => {
    const { records, stats } = resolveRecords([
      raw(0, { github_login: 'accountA', github_id: 'id-a', name: 'Person A', alias_of_github_id: 'id-b' }),
      raw(1, { github_login: 'accountB', github_id: 'id-b', name: 'Person B', alias_of_github_id: 'id-a' }),
    ])
    expect(stats.skipped).toHaveLength(0)
    expect(records.find((r) => r.login_key === 'accounta')?.display_name).toBe('Person A')
    expect(records.find((r) => r.login_key === 'accountb')?.display_name).toBe('Person B')
  })
})

/**
 * `draft`/`is_agent` are PREFERENCE filters (T12): `resolveRecords` no longer
 * applies them, it only carries `status`/`is_agent` into `Contributor` as-is. The
 * decision whether to hide such a record is made by `sources.ts#mergeIntoIndex` — see sources.test.ts.
 */
describe('resolveRecords — draft and is_agent are not filtered here', () => {
  it('max0xf: a nameless draft is skipped by no_name, not by draft (SKIP_REASON_PRECEDENCE)', () => {
    const { records, stats } = resolveRecords([raw(0, { github_login: 'max0xf', name: null, github_name: null, status: 'draft' })])
    expect(records).toHaveLength(0)
    expect(stats.skipped[0]?.reason).toBe('no_name')
  })

  it('a draft with a normal name ends up in records regardless of settings, status is preserved', () => {
    const { records, stats } = resolveRecords([raw(0, { github_login: 'exampleuser', name: 'Draft Person', status: 'draft' })])
    expect(stats.skipped).toHaveLength(0)
    expect(records).toHaveLength(1)
    expect(records[0]?.display_name).toBe('Draft Person')
    expect(records[0]?.status).toBe('draft')
  })

  it('is_agent: true with a normal name ends up in records, is_agent is preserved', () => {
    const { records, stats } = resolveRecords([raw(0, { github_login: 'botaccount', name: 'Some Bot', is_agent: true })])
    expect(stats.skipped).toHaveLength(0)
    expect(records).toHaveLength(1)
    expect(records[0]?.display_name).toBe('Some Bot')
    expect(records[0]?.is_agent).toBe(true)
  })
})

describe('resolveRecords — duplicates and broken records', () => {
  it('a login_key duplicate in different case: the second record is skipped, the first stays', () => {
    const { records, stats } = resolveRecords([
      raw(0, { github_login: 'Lobster40', name: 'Anatoly Bobrov' }),
      raw(1, { github_login: 'lobster40', name: 'Someone Else' }),
    ])
    expect(records).toHaveLength(1)
    expect(records[0]?.display_name).toBe('Anatoly Bobrov')
    expect(stats.skipped[0]?.reason).toBe('duplicate_login')
  })

  it('a record without a login -> no_login', () => {
    const { records, stats } = resolveRecords([raw(0, { github_login: null, name: 'Nobody' })])
    expect(records).toHaveLength(0)
    expect(stats.skipped[0]?.reason).toBe('no_login')
  })

  it('a structurally broken record -> invalid_record', () => {
    const brokenInput = ['not-an-object' as unknown as RawRecord]
    const { records, stats } = resolveRecords(brokenInput)
    expect(records).toHaveLength(0)
    expect(stats.skipped[0]?.reason).toBe('invalid_record')
  })
})

describe('resolveRecords — statistics', () => {
  it('total/imported/skipped.length add up', () => {
    const input = [
      raw(0, { github_login: 'lobster40', name: 'Anatoly Bobrov' }),
      raw(1, { github_login: 'ktursunov', name: 'KTursunov' }),
      raw(2, { github_login: null, name: 'Nobody' }),
      raw(3, { github_login: 'max0xf', status: 'draft' }),
      raw(4, { github_login: 'somebot', name: 'Some Bot', is_agent: true }),
    ]
    const { records, stats } = resolveRecords(input)
    expect(stats.total).toBe(input.length)
    expect(stats.imported).toBe(records.length)
    expect(stats.imported + stats.skipped.length).toBe(stats.total)
  })
})

describe('toTitleCase', () => {
  it('JEAN-LUC -> Jean-Luc', () => {
    expect(toTitleCase('JEAN-LUC')).toBe('Jean-Luc')
  })

  it("O'BRIEN -> O'Brien", () => {
    expect(toTitleCase("O'BRIEN")).toBe("O'Brien")
  })

  it('MikeY stays unchanged (not all-caps)', () => {
    expect(toTitleCase('MikeY')).toBe('MikeY')
  })

  it('bit4flip stays unchanged (not all-caps)', () => {
    expect(toTitleCase('bit4flip')).toBe('bit4flip')
  })

  it('a string of digits stays unchanged', () => {
    expect(toTitleCase('12345')).toBe('12345')
  })
})

describe('normalizeForComparison', () => {
  it('lowercase', () => {
    expect(normalizeForComparison('KTursunov')).toBe('ktursunov')
  })

  it('removes spaces', () => {
    expect(normalizeForComparison('Anatoly Bobrov')).toBe('anatolybobrov')
  })

  it('removes dots, underscores and hyphens', () => {
    expect(normalizeForComparison('a.b_c-d')).toBe('abcd')
  })

  it('matches for a name and a login in different case with separators', () => {
    expect(normalizeForComparison('Artifizer')).toBe(normalizeForComparison('artifizer'))
  })
})

describe('pickName', () => {
  it('returns undefined if all name fields are empty', () => {
    expect(pickName(raw(0, { name: null, github_name: undefined, discord_name: '   ' }))).toBeUndefined()
  })
})

describe('duplicates and contenders for the same login', () => {
  it('a record skipped for another reason does not block a later valid one with the same login', () => {
    const raw: RawRecord[] = [
      { github_login: 'alice', name: null, _index: 0 },
      { github_login: 'alice', name: 'Alice Smith', _index: 1 },
    ]
    const { records, stats } = resolveRecords(raw)

    expect(records).toHaveLength(1)
    expect(records[0]!.display_name).toBe('Alice Smith')
    expect(stats.skipped).toHaveLength(1)
    expect(stats.skipped[0]).toMatchObject({ index: 0, reason: 'no_name' })
  })

  it('only an already-imported login counts as a duplicate', () => {
    const raw: RawRecord[] = [
      { github_login: 'bob', name: 'Bob First', _index: 0 },
      { github_login: 'BOB', name: 'Bob Second', _index: 1 },
    ]
    const { records, stats } = resolveRecords(raw)

    expect(records).toHaveLength(1)
    expect(records[0]!.display_name).toBe('Bob First')
    expect(stats.skipped[0]).toMatchObject({ index: 1, reason: 'duplicate_login' })
  })

  it('github_login is kept in its original case, but without surrounding spaces', () => {
    const raw: RawRecord[] = [{ github_login: '  CarolDev  ', name: 'Carol Danvers', _index: 0 }]
    const { records } = resolveRecords(raw)

    expect(records[0]!.github_login).toBe('CarolDev')
    expect(records[0]!.login_key).toBe('caroldev')
  })
})
