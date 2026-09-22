import { describe, expect, it, vi } from 'vitest'

import en from '../public/_locales/en/messages.json'
import ru from '../public/_locales/ru/messages.json'
import { t, uiLocale } from '../src/core/i18n'

type MessagesFile = Record<string, { message: string; placeholders?: Record<string, { content: string }> }>

const enMessages = en as MessagesFile
const ruMessages = ru as MessagesFile

/** Matches Cyrillic letters (U+0430–U+044F, U+0410–U+042F, plus U+0451/U+0401), but not punctuation like em dash or guillemets. */
const CYRILLIC = /[\u0430-\u044f\u0410-\u042f\u0451\u0401]/

function placeholderCount(entry: MessagesFile[string]): number {
  return entry.placeholders ? Object.keys(entry.placeholders).length : 0
}

describe('en/ru messages.json — key sets match', () => {
  const enKeys = Object.keys(enMessages).sort()
  const ruKeys = Object.keys(ruMessages).sort()

  it('every key from en exists in ru', () => {
    const missing = enKeys.filter((k) => !ruKeys.includes(k))
    expect(missing).toEqual([])
  })

  it('every key from ru exists in en', () => {
    const missing = ruKeys.filter((k) => !enKeys.includes(k))
    expect(missing).toEqual([])
  })
})

describe('en/ru messages.json — value quality', () => {
  it('no en value contains Cyrillic', () => {
    const withCyrillic = Object.entries(enMessages).filter(([, entry]) => CYRILLIC.test(entry.message))
    expect(withCyrillic.map(([key]) => key)).toEqual([])
  })

  it('no ru value has an accidentally left English TODO placeholder', () => {
    const withTodo = Object.entries(ruMessages).filter(([, entry]) => /\bTODO\b/.test(entry.message))
    expect(withTodo.map(([key]) => key)).toEqual([])
  })

  it('the number of placeholders for a key matches between en and ru', () => {
    const mismatched = Object.keys(enMessages).filter((key) => {
      const enEntry = enMessages[key]
      const ruEntry = ruMessages[key]
      if (!enEntry || !ruEntry) return false
      return placeholderCount(enEntry) !== placeholderCount(ruEntry)
    })
    expect(mismatched).toEqual([])
  })
})

describe('t() — falls back to en without browser.i18n', () => {
  it('typeof browser === "undefined" (test stubbed nothing) — sanity check of the environment', () => {
    expect(typeof browser).toBe('undefined')
  })

  it('returns text from en for a key without placeholders', () => {
    expect(t('tabSources')).toBe(en.tabSources.message)
  })

  it('returns en, even if the message has placeholders but none were passed', () => {
    expect(t('sourcesMetaOutOf', '5')).toBe('of 5')
  })
})

describe('t() — argument substitution', () => {
  it('a single substitution (string)', () => {
    expect(t('sourcesReadFileFailed', 'contributors.yaml')).toBe("Couldn't read file «contributors.yaml».")
  })

  it('multiple substitutions (array)', () => {
    expect(t('importSummaryErrors', ['2', 'boom'])).toBe('Parse errors (2): boom')
  })

  it('a placeholder for which no value was passed is replaced with an empty string', () => {
    expect(t('importSummaryErrors', '2')).toBe('Parse errors (2): ')
  })
})

describe('uiLocale() — falls back to en without browser.i18n', () => {
  it('returns "en"', () => {
    expect(uiLocale()).toBe('en')
  })
})

describe('t() — uses browser.i18n.getMessage when available', () => {
  it('calls browser.i18n.getMessage with the key and substitutions', () => {
    const getMessage = vi.fn(() => 'stubbed result')
    vi.stubGlobal('browser', { i18n: { getMessage } })

    const result = t('sourcesReadFileFailed', 'a.json')

    expect(getMessage).toHaveBeenCalledWith('sourcesReadFileFailed', 'a.json')
    expect(result).toBe('stubbed result')

    vi.unstubAllGlobals()
  })

  it('falls back to en if browser.i18n.getMessage returned an empty string', () => {
    vi.stubGlobal('browser', { i18n: { getMessage: () => '' } })

    expect(t('tabSources')).toBe(en.tabSources.message)

    vi.unstubAllGlobals()
  })
})
