import { describe, expect, it } from 'vitest'

import {
  PASS_BATCH_SIZE,
  PASS_ENTRY_TTL_MS,
  PASS_MAX_BATCHES_PER_REQUEST,
  PASS_MAX_CACHE_AGE_MS,
  PASS_MIN_NETWORK_INTERVAL_MS,
  PASS_MISS_TTL_MS,
  PASS_ORIGIN,
  parseOrigin,
  parsePositiveNumber,
} from '../src/core/config'

describe('parsePositiveNumber', () => {
  it('undefined falls back', () => {
    expect(parsePositiveNumber(undefined, 42)).toBe(42)
  })

  it('an empty string falls back', () => {
    expect(parsePositiveNumber('', 42)).toBe(42)
  })

  it('whitespace only falls back', () => {
    expect(parsePositiveNumber('   ', 42)).toBe(42)
  })

  it('non-numeric garbage falls back', () => {
    expect(parsePositiveNumber('abc', 42)).toBe(42)
  })

  it('zero falls back', () => {
    expect(parsePositiveNumber('0', 42)).toBe(42)
  })

  it('a negative number falls back', () => {
    expect(parsePositiveNumber('-5', 42)).toBe(42)
  })

  it('the literal string "NaN" falls back', () => {
    expect(parsePositiveNumber('NaN', 42)).toBe(42)
  })

  it('the literal string "Infinity" falls back', () => {
    expect(parsePositiveNumber('Infinity', 42)).toBe(42)
  })

  it('a plain positive integer is used as-is', () => {
    expect(parsePositiveNumber('3', 42)).toBe(3)
  })

  it('surrounding whitespace is trimmed', () => {
    expect(parsePositiveNumber(' 7 ', 42)).toBe(7)
  })

  it('a fractional value is used as-is', () => {
    expect(parsePositiveNumber('2.5', 42)).toBe(2.5)
  })
})

describe('parseOrigin', () => {
  it('undefined falls back', () => {
    expect(parseOrigin(undefined, 'https://fallback.example')).toBe('https://fallback.example')
  })

  it('an empty string falls back', () => {
    expect(parseOrigin('', 'https://fallback.example')).toBe('https://fallback.example')
  })

  it('garbage that is not a URL falls back', () => {
    expect(parseOrigin('not a url', 'https://fallback.example')).toBe('https://fallback.example')
  })

  it('a bare origin is kept as-is', () => {
    expect(parseOrigin('http://localhost:3000', 'https://fallback.example')).toBe('http://localhost:3000')
  })

  it('a path is normalized away, keeping only the origin', () => {
    expect(parseOrigin('https://pass.cfabric.org/api/names', 'https://fallback.example')).toBe(
      'https://pass.cfabric.org',
    )
  })

  it('a trailing slash is normalized away', () => {
    expect(parseOrigin('https://pass.cfabric.org/', 'https://fallback.example')).toBe('https://pass.cfabric.org')
  })
})

describe('default constants — no env set in the test environment', () => {
  it('PASS_ORIGIN falls back to the production pass', () => {
    expect(PASS_ORIGIN).toBe('https://pass.cfabric.org')
  })

  it('PASS_MAX_CACHE_AGE_MS falls back to 3 days', () => {
    expect(PASS_MAX_CACHE_AGE_MS).toBe(3 * 24 * 60 * 60 * 1000)
  })

  it('PASS_ENTRY_TTL_MS falls back to 24 hours', () => {
    expect(PASS_ENTRY_TTL_MS).toBe(24 * 60 * 60 * 1000)
  })

  it('PASS_MISS_TTL_MS falls back to 24 hours', () => {
    expect(PASS_MISS_TTL_MS).toBe(24 * 60 * 60 * 1000)
  })

  it('PASS_BATCH_SIZE matches the endpoint limit', () => {
    expect(PASS_BATCH_SIZE).toBe(100)
  })

  it('PASS_MAX_BATCHES_PER_REQUEST', () => {
    expect(PASS_MAX_BATCHES_PER_REQUEST).toBe(3)
  })

  it('PASS_MIN_NETWORK_INTERVAL_MS', () => {
    expect(PASS_MIN_NETWORK_INTERVAL_MS).toBe(1000)
  })
})
