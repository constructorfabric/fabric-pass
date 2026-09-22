/**
 * Type-safe wrapper over `browser.i18n` (WebExtensions `_locales/<lang>/messages.json`).
 *
 * The key is typed via `keyof typeof en` — a typo in a key becomes a compile error
 * instead of an empty string in the UI.
 *
 * `browser.i18n` isn't available in tests (vitest/happy-dom doesn't provide the
 * WebExtension API unless the test itself did `vi.stubGlobal('browser', ...)`), and in
 * that case `browser` may not be declared at all — referencing it directly would throw
 * a `ReferenceError`. `typeof browser === 'undefined'` is the only safe way to check
 * this without an exception. That's why `t()` and `uiLocale()` always fall back to the
 * English text from the imported `en` when `browser.i18n` is unavailable or returned an
 * empty string.
 */

import en from '../../public/_locales/en/messages.json'

export type MessageKey = keyof typeof en

type MessageEntry = (typeof en)[MessageKey]

/**
 * WXT only types `browser.i18n.getMessage` for the built-in `@@` keys (see
 * `.wxt/types/i18n.d.ts`) — it doesn't know about our own keys from `_locales`.
 * We pull out the signature actually described by the WebExtensions API (`I18n.Static`
 * from `webextension-polyfill`), which any `messageName: string` fits.
 */
type GetMessage = (messageName: string, substitutions?: string | string[]) => string

function hasI18n(): boolean {
  return typeof browser !== 'undefined' && typeof browser.i18n?.getMessage === 'function'
}

/** `$NAME$` (case-insensitive) → substitution value from `placeholders[name].content` (`"$1"`, `"$2"`, ...). */
function applyPlaceholders(entry: MessageEntry, substitutions?: string | string[]): string {
  const placeholders = 'placeholders' in entry ? entry.placeholders : undefined
  if (!placeholders) return entry.message

  const subs = substitutions === undefined ? [] : Array.isArray(substitutions) ? substitutions : [substitutions]

  let message = entry.message
  for (const [name, def] of Object.entries(placeholders)) {
    const indexMatch = /^\$(\d+)$/.exec((def as { content: string }).content)
    const index = indexMatch?.[1] !== undefined ? Number(indexMatch[1]) - 1 : undefined
    const value = index !== undefined ? (subs[index] ?? '') : ''
    message = message.replace(new RegExp(`\\$${name}\\$`, 'gi'), value)
  }
  return message
}

function fallback(key: MessageKey, substitutions?: string | string[]): string {
  return applyPlaceholders(en[key], substitutions)
}

/** Text for `key`, with substitutions if the message has `placeholders`. Never an empty string. */
export function t(key: MessageKey, substitutions?: string | string[]): string {
  if (hasI18n()) {
    const getMessage = browser.i18n.getMessage as GetMessage
    const result = getMessage(key, substitutions)
    if (result) return result
  }
  return fallback(key, substitutions)
}

/** Browser UI language, falling back to `'en'` outside the extension (tests, happy-dom). */
export function uiLocale(): string {
  if (hasI18n() && typeof browser.i18n.getUILanguage === 'function') {
    const locale = browser.i18n.getUILanguage()
    if (locale) return locale
  }
  return 'en'
}

export interface PluralForms {
  /** Form for `n === 1` in English and for `n % 10 === 1 && n % 100 !== 11` in Russian. */
  one: string
  /** Russian form for `n % 10` in 2..4 (except 12..14). Not used in English. */
  few: string
  /** Russian form for the remaining cases. In English, the only plural form. */
  many: string
}

/**
 * A number + noun, honoring the current locale's plural forms.
 * English only has `one`/`other` (here `other` is `forms.many`), while Russian has
 * three forms based on modulo 10/100. The locale is determined via `uiLocale()` rather
 * than hardcoded, so a UI switched to English doesn't get Russian grammar by mistake.
 */
export function pluralize(n: number, forms: PluralForms): string {
  if (uiLocale().toLowerCase().startsWith('ru')) {
    const mod10 = n % 10
    const mod100 = n % 100
    if (mod10 === 1 && mod100 !== 11) return forms.one
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms.few
    return forms.many
  }
  return n === 1 ? forms.one : forms.many
}
