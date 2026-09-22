/**
 * Contracts for the GitHub Real Names extension.
 *
 * This is a blocking artifact: types from here are used by the parsers (T2),
 * normalization (T3), layers and storage (T4), content script (T5), and UI
 * (T6/T7/T8). They can only be changed in a coordinated way — if it turns out during
 * implementation that a type is awkward, report it rather than silently changing it
 * for your own task.
 *
 * `noUncheckedIndexedAccess` is enabled in tsconfig, so indexing into the dictionaries
 * below gives `T | undefined` — this is intentional.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Data sources (layers)
// ─────────────────────────────────────────────────────────────────────────────

export type SourceKind = 'yaml' | 'json' | 'csv' | 'url' | 'manual' | 'pass'

/** Reserved id of the manual edits layer. Created on install and undeletable. */
export const MANUAL_SOURCE_ID = 'manual'

/**
 * Reserved id of the Fabric Pass layer. Created on install, undeletable — can only
 * be disabled.
 */
export const PASS_SOURCE_ID = 'pass'

/**
 * A data layer. The order of elements in `StoredState.sources` sets the priority:
 * index 0 is highest. On merge, the higher-priority layer wins.
 */
export interface Source {
  id: string
  kind: SourceKind
  /** File name or a user-provided label. Shown in the UI. */
  label: string
  /** A disabled layer doesn't participate in the merge, but its records are kept. */
  enabled: boolean
  /** ISO 8601. */
  importedAt: string
  /**
   * Raw source text. Stored ONLY for editable layers (`manual` and manually pasted
   * JSON), so the editor can show exactly what the user saved — with their key order
   * and `_note` fields. Not stored for imported files: no reason to keep a megabyte in
   * storage.
   */
  rawText?: string
  /** Only for kind === 'url'. */
  url?: string
  /** Stats from this layer's last import. */
  stats: ImportStats
}

// ─────────────────────────────────────────────────────────────────────────────
// Records
// ─────────────────────────────────────────────────────────────────────────────

/** A normalized record, ready to be shown. Result of resolve.ts (T3). */
export interface Contributor {
  /** Login as in the source — shown to the user in this form. */
  github_login: string
  /** `github_login.toLowerCase()`. Index key and DOM matching key. */
  login_key: string
  /** A string, not a number. Key for resolving aliases. */
  github_id?: string
  /** Computed display name, already converted to Title Case if needed. */
  display_name: string
  /** Original name value before Title Case. Needed for export and debugging. */
  raw_name?: string
  company?: string
  email?: string
  discord_username?: string
  telegram_username?: string
  is_agent?: boolean
  is_admin?: boolean
  status?: ContributorStatus
}

export type ContributorStatus = 'confirmed' | 'draft'

/**
 * A record pulled from a file but NOT yet normalized.
 * All fields are optional: a hand-written JSON may only contain a login and a name.
 * `null` is a meaningful value (this is how empty fields arrive from
 * contributors.yaml); there's no need to distinguish it from `undefined` (the field
 * was absent) — treat both as "empty".
 */
export interface RawRecord {
  github_login?: string | null
  github_id?: string | null
  github_name?: string | null
  name?: string | null
  discord_name?: string | null
  telegram_name?: string | null
  linkedin_name?: string | null
  discord_username?: string | null
  telegram_username?: string | null
  company?: string | null
  email?: string | null
  status?: string | null
  alias_of_github_id?: string | null
  is_agent?: boolean | null
  is_admin?: boolean | null
  /** Record's position in the source file, 0-based. Needed for error messages. */
  _index: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Import diagnostics
// ─────────────────────────────────────────────────────────────────────────────

export type SkipReason =
  /** None of the name fields are filled in. */
  | 'no_name'
  /** The name, after normalization, matches the login — nothing to show. */
  | 'name_equals_login'
  /** No github_login — the record has nothing to match against. */
  | 'no_login'
  /** status: draft while showing drafts is disabled. */
  | 'draft'
  /** is_agent: true. */
  | 'agent'
  /** Structurally malformed record (not an object, login not a string, etc.). */
  | 'invalid_record'
  /** This login_key has already been seen in this same source. */
  | 'duplicate_login'

/**
 * Order in which skip reasons are checked IN `resolve.ts`. A record can match several
 * at once, so the reason is fixed by the FIRST match in this list — otherwise
 * different parts of the code would report the same record differently.
 *
 * Only IRREPARABLE reasons live here — the ones that don't depend on settings and
 * can't change without editing the data itself. `agent` and `draft` are deliberately
 * not included: those are PREFERENCE filters, applied in `sources.ts#mergeIntoIndex`,
 * which is rebuilt on every settings change — unlike `resolve.ts`, whose result is
 * stored and not recomputed. The `SkipReason` values `'agent'`/`'draft'` themselves
 * remain in the type: they're set by the merge, and the UI shows them too.
 */
export const SKIP_REASON_PRECEDENCE: readonly SkipReason[] = [
  'invalid_record',
  'no_login',
  'duplicate_login',
  'no_name',
  'name_equals_login',
]

export interface SkippedRecord {
  /** Position in the source file, 0-based. */
  index: number
  login?: string
  reason: SkipReason
  /** Human-readable explanation, if the reason isn't self-evident. */
  detail?: string
}

export interface ImportStats {
  /** How many records were in the file. */
  total: number
  /** How many made it into the index. */
  imported: number
  skipped: SkippedRecord[]
}

/** A structural error parsing the file (not a specific record). */
export interface ParseError {
  /** 1-based. */
  line?: number
  /** 1-based. */
  column?: number
  message: string
}

/**
 * Result of a parser's work (T2). The parser does NOT normalize names and does NOT
 * filter out records — that's handled by resolve.ts (T3).
 *
 * Important: the presence of errors in `errors` doesn't mean `records` is empty.
 * Import isn't all-or-nothing: if the file parsed but some records are malformed, the
 * valid records are returned and the malformed ones go into `errors`. A fully empty
 * `records` with a non-empty `errors` means the file didn't parse at all.
 */
export interface ParseResult {
  records: RawRecord[]
  errors: ParseError[]
  /** Which format the parser ended up applying. Shown in the UI after import. */
  format: SourceKind
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────────────

/**
 * parens:            anatolyb (Anatoly Bobrov)
 * brackets:          anatolyb [Anatoly Bobrov]
 * brackets-reversed: Anatoly Bobrov [anatolyb]
 */
export type DisplayFormat = 'parens' | 'brackets' | 'brackets-reversed'

export interface Settings {
  displayFormat: DisplayFormat
  /** Show records with status: draft. */
  showDraft: boolean
  showAgentBadge: boolean
  showAdminBadge: boolean
  /** Global switch: false → the content script doesn't touch the DOM. */
  enabled: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  displayFormat: 'parens',
  showDraft: false,
  showAgentBadge: false,
  showAdminBadge: false,
  enabled: true,
}

// ─────────────────────────────────────────────────────────────────────────────
// Fabric Pass cache
// ─────────────────────────────────────────────────────────────────────────────

/**
 * State of the extension's relationship with Fabric Pass.
 * `never` — no request has ever been made; `unauthenticated` — pass answered 401
 * (the person simply isn't logged in, not an error); `expired` — the cache was wiped
 * because it aged out (see sweepExpired).
 */
export type PassStatus = 'never' | 'ok' | 'unauthenticated' | 'network-error' | 'expired'

/** `name: null` is the negative cache — pass was asked about this login and does not know it. */
export interface PassCacheEntry {
  name: string | null
  fetchedAt: string
}

/** Keyed by `login_key` (lower case), like everything else that matches logins. */
export type PassCache = Record<string, PassCacheEntry>

export interface PassMeta {
  /** ISO 8601, the last SUCCESSFUL authorized response. This — and only this — is what ages the cache out. */
  lastAuthOkAt?: string
  lastStatus: PassStatus
  lastError?: string
}

export const DEFAULT_PASS_META: PassMeta = { lastStatus: 'never' }

// ─────────────────────────────────────────────────────────────────────────────
// Storage
// ─────────────────────────────────────────────────────────────────────────────

export const SCHEMA_VERSION = 2

/**
 * Index value: [display name, winning layer's id].
 * A tuple rather than an object — at 10,000 records that's noticeably less JSON.
 */
export type IndexEntry = readonly [displayName: string, sourceId: string]

/** Flat merged index: login_key → record. The only thing the content script reads. */
export type MergedIndex = Record<string, IndexEntry>

export interface StoredState {
  schemaVersion: number
  settings: Settings
  /** Order = priority, [0] is highest. */
  sources: Source[]
  /** Normalized records per layer. */
  records: Record<string, Contributor[]>
  idx: MergedIndex
}

/**
 * Everything the extension persists. `StoredState` is the subset the layer machinery
 * works with; the pass cache is kept out of it so `readState` doesn't have to read it.
 * Only the schema migration, which rewrites storage wholesale, deals in this type.
 */
export interface PersistedState extends StoredState {
  passCache: PassCache
  passMeta: PassMeta
}

/**
 * Top-level keys in browser.storage.local.
 * Split by key rather than one object, so the content script can read only `idx` and
 * `settings`, without pulling out all layers' records — and so it, and the rest of the
 * layer machinery, doesn't have to pull out the (potentially large) pass cache either.
 */
export const STORAGE_KEYS = {
  schemaVersion: 'schemaVersion',
  settings: 'settings',
  sources: 'sources',
  records: 'records',
  idx: 'idx',
  passCache: 'passCache',
  passMeta: 'passMeta',
} as const

// ─────────────────────────────────────────────────────────────────────────────
// Conflict inspector
// ─────────────────────────────────────────────────────────────────────────────

/** Response of `sources.explain(login)` for the UI: who won and what the other layers offered. */
export interface ConflictExplanation {
  login_key: string
  winner?: { sourceId: string; sourceLabel: string; contributor: Contributor }
  losers: Array<{ sourceId: string; sourceLabel: string; contributor: Contributor }>
  /** Layers that contain this login but are disabled. */
  disabled: Array<{ sourceId: string; sourceLabel: string; contributor: Contributor }>
  /**
   * Enabled layers whose record was filtered out by the preference filter
   * (`isFilteredByPreference` — `is_agent`, `status: draft` while `showDraft` is
   * disabled) and therefore can't be the winner, even if it's higher priority than the
   * actual winner.
   */
  filteredByPreference: Array<{ sourceId: string; sourceLabel: string; contributor: Contributor }>
}
