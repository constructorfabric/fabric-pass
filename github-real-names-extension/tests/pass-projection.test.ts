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

  it('drops an entry whose name is only whitespace', () => {
    const cache: PassCache = { erin: { name: '   ', fetchedAt: '2026-01-01T00:00:00.000Z' } }

    const { records } = projectPassCache(cache)

    expect(records).toHaveLength(0)
  })

  it('an ALL-CAPS name is kept as pass spells it, NOT converted to Title Case', () => {
    const cache: PassCache = { carol: { name: 'CAROL NG', fetchedAt: '2026-01-01T00:00:00.000Z' } }

    const { records } = projectPassCache(cache)

    expect(records[0]?.display_name).toBe('CAROL NG')
  })

  it('a name that collapses onto its login once spaces are stripped is still shown (IDEA-155)', () => {
    const cache: PassCache = { sanjeevsolanki: { name: 'Sanjeev SOLANKI', fetchedAt: '2026-01-01T00:00:00.000Z' } }

    const { records, stats } = projectPassCache(cache)

    expect(records).toHaveLength(1)
    expect(records[0]?.display_name).toBe('Sanjeev SOLANKI')
    expect(stats.skipped).toEqual([])
  })

  it('a name literally equal to its login is shown too — pass said so', () => {
    const cache: PassCache = { dave: { name: 'dave', fetchedAt: '2026-01-01T00:00:00.000Z' } }

    const { records, stats } = projectPassCache(cache)

    expect(records[0]?.display_name).toBe('dave')
    expect(stats.skipped).toEqual([])
  })

  it('counts only the names it holds, not the negative entries beside them', () => {
    const cache: PassCache = {
      alice: { name: 'Alice Smith', fetchedAt: '2026-01-01T00:00:00.000Z' },
      bob: { name: null, fetchedAt: '2026-01-01T00:00:00.000Z' },
    }

    const { stats } = projectPassCache(cache)

    expect(stats).toEqual({ total: 1, imported: 1, skipped: [] })
  })

  it('an empty cache gives an empty result', () => {
    const { records, stats } = projectPassCache({})

    expect(records).toEqual([])
    expect(stats.total).toBe(0)
  })
})
