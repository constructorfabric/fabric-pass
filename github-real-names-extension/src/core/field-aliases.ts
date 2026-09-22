/**
 * Table of field name synonyms.
 *
 * The goal: a hand-written JSON or CSV file not made for this extension should still
 * import without manual edits. `{"login":"x","fullName":"Y"}` must go through silently.
 *
 * Used by the JSON and CSV parsers (T2). YAML in contributors.yaml format doesn't need
 * synonyms — its field names are already canonical — but applying the table there too
 * is harmless.
 */

import type { RawRecord } from './types'

/** Canonical field name → list of accepted synonyms (including the canonical name itself). */
export const FIELD_ALIASES = {
  github_login: ['github_login', 'github', 'login', 'username', 'user', 'handle', 'nick'],
  github_id: ['github_id', 'gh_id'],
  github_name: ['github_name', 'gh_name'],
  name: ['name', 'real_name', 'realname', 'full_name', 'fullname', 'display_name', 'displayname', 'person'],
  discord_name: ['discord_name'],
  telegram_name: ['telegram_name'],
  linkedin_name: ['linkedin_name'],
  discord_username: ['discord_username', 'discord'],
  telegram_username: ['telegram_username', 'telegram'],
  company: ['company', 'org', 'organization', 'organisation', 'team'],
  email: ['email', 'mail', 'email_address', 'e_mail'],
  status: ['status'],
  alias_of_github_id: ['alias_of_github_id', 'alias_of'],
  is_agent: ['is_agent', 'agent', 'bot', 'is_bot'],
  is_admin: ['is_admin', 'admin'],
} as const satisfies Record<keyof Omit<RawRecord, '_index'>, readonly string[]>

export type CanonicalField = keyof typeof FIELD_ALIASES

/**
 * Reduces a field name to its canonical form.
 *
 * Key normalization before the lookup: lowercase and stripping `_`, `-`, spaces.
 * That's why `fullName`, `full_name`, `Full Name` and `full-name` are all the same thing.
 *
 * Returns `undefined` if the field is unknown; the caller must silently ignore such a
 * field rather than treat it as an error. Separately: keys starting with `_` are always
 * ignored — this is a way to write notes in JSON, which has no comments.
 */
export function canonicalField(key: string): CanonicalField | undefined {
  if (key.startsWith('_')) return undefined
  const normalized = normalizeKey(key)
  return LOOKUP.get(normalized)
}

/** Normalizes a field key: lowercase, no separators. */
export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[\s_-]+/g, '')
}

/** Reverse index, built once when the module loads. */
const LOOKUP: ReadonlyMap<string, CanonicalField> = (() => {
  const map = new Map<string, CanonicalField>()
  for (const [canonical, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases as readonly string[]) {
      map.set(normalizeKey(alias), canonical as CanonicalField)
    }
  }
  return map
})()

/**
 * Fields that exist in contributors.yaml but that the extension doesn't need.
 *
 * Parsers don't need this list: `canonicalField()` already returns `undefined` for all
 * of these keys, since none of them is listed as a synonym. The list exists for the
 * hand-written JSON UI (T7): it lets the code distinguish "a known registry field we
 * deliberately don't use" from "an unknown field — possibly a typo," and flag the
 * latter to the person without complaining about the former.
 */
export const IGNORED_FIELDS: ReadonlySet<string> = new Set(
  [
    'id',
    'github_email',
    'telegram_id',
    'telegram_phone',
    'discord_id',
    'linkedin_id',
    'email_confirmed_at',
    'profile_completeness',
    'created_at',
    'updated_at',
  ].map(normalizeKey),
)
