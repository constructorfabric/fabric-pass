import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseYaml } from '../src/core/parsers/yaml'
import { parseJson, offsetToLineCol } from '../src/core/parsers/json'
import { parseCsv } from '../src/core/parsers/csv'
import { detectFormat, parseAny } from '../src/core/parsers/index'

function fixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf8')
}

describe('parseYaml', () => {
  const result = parseYaml(fixture('contributors.subset.yaml'))

  it('parses all 13 records with no errors', () => {
    expect(result.records).toHaveLength(13)
    expect(result.errors).toEqual([])
  })

  it('lobster40: github_name null, name from name', () => {
    const rec = result.records.find((r) => r.github_login === 'lobster40')
    expect(rec?.github_name).toBeNull()
    expect(rec?.name).toBe('Anatoly Bobrov')
  })

  it('claudedigon: alias_of_github_id — string', () => {
    const rec = result.records.find((r) => r.github_login === 'claudedigon')
    expect(rec?.alias_of_github_id).toBe('192490142')
  })

  it('max0xf: status draft', () => {
    const rec = result.records.find((r) => r.github_login === 'max0xf')
    expect(rec?.status).toBe('draft')
  })

  it('Artifizer: the registry id field did not end up in github_id', () => {
    const rec = result.records.find((r) => r.github_login === 'Artifizer')
    expect(rec?.github_id).toBe('192502778')
  })
})

describe('parseJson — shape A (flat map)', () => {
  const result = parseJson(fixture('hand.valid.a.json'))

  it('gives 3 records', () => {
    expect(result.records).toHaveLength(3)
  })

  it('every record has github_login and name filled in', () => {
    for (const rec of result.records) {
      expect(typeof rec.github_login).toBe('string')
      expect(typeof rec.name).toBe('string')
    }
  })
})

describe('parseJson — a single record without a wrapper (code review defect 2)', () => {
  it('{"github_login":"alice","name":"Alice Smith"} — one record, not a flat map of two logins', () => {
    const result = parseJson('{"github_login":"alice","name":"Alice Smith"}')
    expect(result.records).toHaveLength(1)
    expect(result.records[0]?.github_login).toBe('alice')
    expect(result.records[0]?.name).toBe('Alice Smith')
  })

  it('a real flat map {"alice":"Alice Smith","bob":"Bob Jones"} stays shape A with two records', () => {
    const result = parseJson('{"alice":"Alice Smith","bob":"Bob Jones"}')
    expect(result.records).toHaveLength(2)
    expect(result.records.map((r) => r.github_login)).toEqual(['alice', 'bob'])
  })

  it('an object with a single login key {"alice":"Alice Smith"} stays shape A', () => {
    const result = parseJson('{"alice":"Alice Smith"}')
    expect(result.records).toHaveLength(1)
    expect(result.records[0]?.github_login).toBe('alice')
    expect(result.records[0]?.name).toBe('Alice Smith')
  })
})

describe('parseJson — shape B (array of objects)', () => {
  const result = parseJson(fixture('hand.valid.b.json'))

  it('gives 3 records', () => {
    expect(result.records).toHaveLength(3)
  })

  it('ignores the _note field', () => {
    const rec = result.records.find((r) => r.github_login === 'ktursunov')
    expect(rec).not.toHaveProperty('_note')
  })
})

describe('parseJson — shape C (contributors wrapper)', () => {
  const result = parseJson(fixture('hand.valid.c.json'))

  it('gives 2 records', () => {
    expect(result.records).toHaveLength(2)
  })
})

describe('parseJson — syntax error', () => {
  const result = parseJson(fixture('hand.broken.syntax.json'))

  it('records is empty, exactly one error', () => {
    expect(result.records).toEqual([])
    expect(result.errors).toHaveLength(1)
  })

  it('the error has a meaningful line', () => {
    expect(result.errors[0]?.line).toBeDefined()
    expect(result.errors[0]?.line).toBeGreaterThan(0)
  })
})

describe('parseJson — semantically broken records', () => {
  const result = parseJson(fixture('hand.broken.semantic.json'))

  it('the parser does not throw and imports all records as-is', () => {
    expect(result.records).toHaveLength(6)
  })

  it('_index matches the position in the original array', () => {
    result.records.forEach((rec, i) => {
      expect(rec._index).toBe(i)
    })
  })

  it('a record without a login passes through the parser', () => {
    const rec = result.records.find((r) => r.name === 'No Login')
    expect(rec).toBeDefined()
    expect(rec?.github_login).toBeUndefined()
  })

  it('a record without a name passes through the parser', () => {
    const rec = result.records.find((r) => r.github_login === 'noname')
    expect(rec).toBeDefined()
    expect(rec?.name).toBeUndefined()
  })
})

describe('parseJson — foreign field names', () => {
  const result = parseJson(fixture('hand.foreign-fields.json'))

  it('gives 3 records', () => {
    expect(result.records).toHaveLength(3)
  })

  it('login/username/handle → github_login', () => {
    expect(result.records[0]?.github_login).toBe('anatolyb')
    expect(result.records[1]?.github_login).toBe('jdoe123')
    expect(result.records[2]?.github_login).toBe('third')
  })

  it('fullName/real_name/displayName → name', () => {
    expect(result.records[0]?.name).toBe('Anatoly Bobrov')
    expect(result.records[1]?.name).toBe('John Doe')
    expect(result.records[2]?.name).toBe('Third Person')
  })

  it('org → company', () => {
    expect(result.records[0]?.company).toBe('Acronis')
  })

  it('mail → email', () => {
    expect(result.records[1]?.email).toBe('jdoe@example.com')
  })
})

describe('parseCsv', () => {
  const result = parseCsv(fixture('mapping.csv'))

  it('gives 3 records', () => {
    expect(result.records).toHaveLength(3)
  })

  it('jdoe123: company contains a comma from quotes', () => {
    const rec = result.records.find((r) => r.github_login === 'jdoe123')
    expect(rec?.company).toBe('Constructor, Tech')
  })

  it('ktursunov: empty company cell → null', () => {
    const rec = result.records.find((r) => r.github_login === 'ktursunov')
    expect(rec?.company).toBeNull()
  })
})

describe('detectFormat', () => {
  it('.yaml by extension', () => {
    expect(detectFormat('x', 'contributors.yaml')).toBe('yaml')
  })

  it('.yml by extension', () => {
    expect(detectFormat('x', 'contributors.yml')).toBe('yaml')
  })

  it('.json by extension', () => {
    expect(detectFormat('x', 'mapping.json')).toBe('json')
  })

  it('.csv by extension', () => {
    expect(detectFormat('x', 'mapping.csv')).toBe('csv')
  })

  it('content starting with { → json', () => {
    expect(detectFormat('{"a":1}')).toBe('json')
  })

  it('content starting with [ → json', () => {
    expect(detectFormat('[1,2,3]')).toBe('json')
  })

  it('content starting with contributors: → yaml', () => {
    expect(detectFormat('contributors:\n  - github_login: x\n')).toBe('yaml')
  })

  it('a comma in the first line without { → csv', () => {
    expect(detectFormat('github,name\nanatolyb,Anatoly Bobrov')).toBe('csv')
  })

  it('mapping.csv (a real fixture) is still detected as csv', () => {
    expect(detectFormat(fixture('mapping.csv'))).toBe('csv')
  })

  it('a bare YAML array without contributors: → yaml', () => {
    expect(detectFormat('- github_login: anatolyb\n  name: Anatoly Bobrov\n')).toBe('yaml')
  })

  it('no extension and no explicit signs → json by default', () => {
    expect(detectFormat('plain text with no structure')).toBe('json')
  })
})

describe('parseAny', () => {
  it('dispatches to the right parser by extension', () => {
    expect(parseAny(fixture('mapping.csv'), 'mapping.csv').format).toBe('csv')
    expect(parseAny(fixture('hand.valid.b.json'), 'hand.valid.b.json').format).toBe('json')
    expect(parseAny(fixture('contributors.subset.yaml'), 'contributors.subset.yaml').format).toBe('yaml')
  })

  it('a bare YAML array with no file name and no contributors: is parsed as yaml', () => {
    const text = '- github_login: anatolyb\n  name: Anatoly Bobrov\n- github_login: jdoe123\n  name: John Doe\n'
    const result = parseAny(text)
    expect(result.format).toBe('yaml')
    expect(result.records).toHaveLength(2)
    expect(result.errors).toEqual([])
  })

  it('.json with YAML content inside — an honest error, not guessing the format', () => {
    const text = '- github_login: anatolyb\n  name: Anatoly Bobrov\n'
    const result = parseAny(text, 'weird.json')
    expect(result.format).toBe('json')
    expect(result.records).toEqual([])
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('text with no extension, not parsing as json but parsing as yaml — the fallback kicks in', () => {
    // The first non-empty line is a comment: it doesn't look like a YAML array/key
    // or CSV, so detectFormat picks json by default. JSON.parse fails on "#",
    // and parseAny falls back to the second format in the json/yaml pair — here
    // that's valid YAML (a comment + a block list).
    const text = '# see below\n- github_login: anatolyb\n  name: Anatoly Bobrov\n'
    const result = parseAny(text)
    expect(result.format).toBe('yaml')
    expect(result.records).toHaveLength(1)
  })
})

describe('offsetToLineCol', () => {
  it('offset at the start of the text → line 1, column 1', () => {
    expect(offsetToLineCol('hello world', 0)).toEqual({ line: 1, column: 1 })
  })

  it('offset on the first line', () => {
    expect(offsetToLineCol('hello world', 6)).toEqual({ line: 1, column: 7 })
  })

  it('offset after \\n on the second line', () => {
    expect(offsetToLineCol('abc\ndef', 4)).toEqual({ line: 2, column: 1 })
  })

  it('offset after \\r\\n on the second line', () => {
    expect(offsetToLineCol('ab\r\ncd', 4)).toEqual({ line: 2, column: 1 })
  })
})
