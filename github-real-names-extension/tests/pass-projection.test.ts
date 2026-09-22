import { describe, expect, it } from 'vitest'

import { projectPassCache } from '../src/core/pass-projection'
import type { PassCache } from '../src/core/types'

describe('projectPassCache', () => {
  it('turns a positive entry into a record', () => {
    const cache: PassCache = { alice: { name: 'Alice Smith', fetchedAt: '2026-01-01T00:00:00.000Z' } }

    const { records } = projectPassCache(cache)

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ github_login: 'alice', login_key: 'alice', display_name: 'Alice Smith' })
  })

  it('drops a negative cache entry (name: null)', () => {
    const cache: PassCache = { bob: { name: null, fetchedAt: '2026-01-01T00:00:00.000Z' } }

    const { records } = projectPassCache(cache)

    expect(records).toHaveLength(0)
  })

  it('an ALL-CAPS name is converted to Title Case, same as any other layer', () => {
    const cache: PassCache = { carol: { name: 'CAROL NG', fetchedAt: '2026-01-01T00:00:00.000Z' } }

    const { records } = projectPassCache(cache)

    expect(records[0]?.display_name).toBe('Carol Ng')
  })

  it('a name equal to its login is skipped as name_equals_login, same rejection as any other layer', () => {
    const cache: PassCache = { dave: { name: 'dave', fetchedAt: '2026-01-01T00:00:00.000Z' } }

    const { records, stats } = projectPassCache(cache)

    expect(records).toHaveLength(0)
    expect(stats.skipped.map((s) => s.reason)).toContain('name_equals_login')
  })

  it('an empty cache gives an empty result', () => {
    const { records, stats } = projectPassCache({})

    expect(records).toEqual([])
    expect(stats.total).toBe(0)
  })
})
