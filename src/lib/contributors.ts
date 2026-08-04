import { randomBytes } from 'node:crypto'
import { pool } from '@/lib/db'
import { EMAIL_CONFIRMATION_TTL_MS, sendConfirmationEmail } from '@/lib/email'
import type { Identity, ProviderName } from '@/lib/providers/types'

/**
 * Owned by cf-internal's pass/contributors.yaml, not by this app — see
 * migrations/005_contributor_status.sql. A contributor reaches 'draft' on
 * their own, the moment they sign in with GitHub; only an admin editing the
 * registry file can promote one to 'confirmed', via /internal/contributors/sync.
 */
export const CONTRIBUTOR_STATUSES = ['draft', 'confirmed'] as const
export type ContributorStatus = (typeof CONTRIBUTOR_STATUSES)[number]

export function isContributorStatus(value: string): value is ContributorStatus {
  return (CONTRIBUTOR_STATUSES as readonly string[]).includes(value)
}

export interface Contributor {
  id: string
  githubId: string
  githubLogin: string
  githubName?: string
  githubEmail?: string
  telegramId?: string
  telegramUsername?: string
  telegramPhone?: string
  telegramName?: string
  discordId?: string
  discordUsername?: string
  discordName?: string
  name?: string
  email?: string
  /** Set the moment `email` is confirmed — by clicking the emailed link for
   * a typed address, or immediately for one prefilled from GitHub's own
   * already-verified public profile (see ensureContributor). Cleared
   * whenever `email` changes to a new, not-yet-confirmed value. */
  emailConfirmedAt?: Date
  /** When the current confirmation email was sent — undefined once
   * confirmed. Used only to compute whether that link has expired; the
   * token itself is never exposed on this type (see the module doc). */
  emailConfirmationSentAt?: Date
  company?: string
  status: ContributorStatus
  /** Another contributor's `githubId` — this row is the same real person,
   * registered a second time. Empty means this is a primary contributor,
   * not an alias of anyone. Owned by the registry file, same as `status`. */
  aliasOfGithubId?: string
  /** A bot/agent account rather than a human. Owned by the registry file,
   * same as `status`. */
  isAgent: boolean
  createdAt: Date
  updatedAt: Date
}

/** The three fields a contributor types, saved one at a time as they autosave. */
export const DETAIL_FIELDS = ['name', 'email', 'company'] as const
export type DetailField = (typeof DETAIL_FIELDS)[number]

/**
 * The real boundary check for `DetailField`: `saveField` (here and the
 * `'use server'` action wrapping it in app/actions.ts) is reachable as a
 * plain HTTP endpoint, where `DetailField` is erased to `string` before this
 * function ever sees it. Compile-time typing alone would let an arbitrary
 * field name through to the query below.
 */
export function isDetailField(value: string): value is DetailField {
  return (DETAIL_FIELDS as readonly string[]).includes(value)
}

/**
 * Thrown when a github id names no contributor row — distinct from a
 * transient database error so callers can tell the two apart: a stale
 * session cookie outliving its row can never be fixed by retrying, only by
 * signing in again, while a connection blip is worth retrying as-is.
 */
export class ContributorNotFoundError extends Error {
  constructor(readonly githubId: string) {
    super(`no contributor row for github id ${githubId}`)
    this.name = 'ContributorNotFoundError'
  }
}

interface Row {
  id: string
  github_id: string
  github_login: string
  github_name: string | null
  github_email: string | null
  telegram_id: string | null
  telegram_username: string | null
  telegram_phone: string | null
  telegram_name: string | null
  discord_id: string | null
  discord_username: string | null
  discord_name: string | null
  name: string | null
  email: string | null
  email_confirmed_at: Date | null
  email_confirmation_sent_at: Date | null
  company: string | null
  status: ContributorStatus
  alias_of_github_id: string | null
  is_agent: boolean
  created_at: Date
  updated_at: Date
}

/** `pg` hands back bigint as string and NULL as null; the domain type uses undefined. */
function toContributor(row: Row): Contributor {
  return {
    id: row.id,
    githubId: row.github_id,
    githubLogin: row.github_login,
    githubName: row.github_name ?? undefined,
    githubEmail: row.github_email ?? undefined,
    telegramId: row.telegram_id ?? undefined,
    telegramUsername: row.telegram_username ?? undefined,
    telegramPhone: row.telegram_phone ?? undefined,
    telegramName: row.telegram_name ?? undefined,
    discordId: row.discord_id ?? undefined,
    discordUsername: row.discord_username ?? undefined,
    discordName: row.discord_name ?? undefined,
    name: row.name ?? undefined,
    email: row.email ?? undefined,
    emailConfirmedAt: row.email_confirmed_at ?? undefined,
    emailConfirmationSentAt: row.email_confirmation_sent_at ?? undefined,
    company: row.company ?? undefined,
    status: row.status,
    aliasOfGithubId: row.alias_of_github_id ?? undefined,
    isAgent: row.is_agent,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function findByGithubId(githubId: string): Promise<Contributor | null> {
  const { rows } = await pool.query<Row>('SELECT * FROM contributors WHERE github_id = $1', [githubId])
  return rows[0] ? toContributor(rows[0]) : null
}

/**
 * Creates the row the instant a contributor signs in with GitHub — the point
 * where autosave begins — or, for a returning contributor, refreshes the one
 * GitHub fact that can change under a stable account id. Every other write in
 * this module (linkProvider, saveField) targets a row this function has
 * already created: the page only offers a link button or a typed field once
 * signed in, so by the time either fires this insert has already happened.
 *
 * `name`/`email` — the contributor's own typed fields — get GitHub's values
 * as a starting point exactly once, on the insert that creates the row (or
 * whenever the typed field is still empty on a later sign-in); a value the
 * contributor has since typed is never overwritten by a freshly-changed
 * GitHub name or email.
 *
 * An email prefilled this way is marked confirmed immediately, with no
 * emailed link required — GitHub's public-profile email is already the
 * account holder's own verified address, which is exactly the thing the
 * confirmation flow (see saveEmail) exists to establish for an address the
 * contributor typed themselves. `email_confirmed_at` transitions alongside
 * `email`, from the same null-to-GitHub's-value edge — not on every sign-in,
 * and never once the contributor has typed their own address over it.
 */
export async function ensureContributor(
  githubId: string,
  githubLogin: string,
  githubName?: string,
  githubEmail?: string,
): Promise<Contributor> {
  const { rows } = await pool.query<Row>(
    `INSERT INTO contributors (github_id, github_login, github_name, github_email, name, email, email_confirmed_at)
          VALUES ($1, $2, $3, $4, $3, $4, CASE WHEN $4::text IS NOT NULL THEN now() END)
     ON CONFLICT (github_id) DO UPDATE
       SET github_login = EXCLUDED.github_login,
           github_name = EXCLUDED.github_name,
           github_email = EXCLUDED.github_email,
           name = COALESCE(contributors.name, EXCLUDED.name),
           email = COALESCE(contributors.email, EXCLUDED.email),
           email_confirmed_at = CASE
             WHEN contributors.email IS NULL AND EXCLUDED.email IS NOT NULL THEN now()
             ELSE contributors.email_confirmed_at
           END,
           updated_at = now()
       RETURNING *`,
    [githubId, githubLogin, githubName ?? null, githubEmail ?? null],
  )
  return toContributor(rows[0])
}

/**
 * Writes one provider's whole identity as a unit — id together with username
 * and phone — the moment its OAuth callback returns, so a value left over
 * from a *different* linked account cannot survive beside the new one.
 * Telegram's username and phone are mutually exclusive by construction (see
 * providers/telegram.ts's toIdentity), so re-linking a username-bearing
 * account after a phone-only one has to clear the phone rather than keep it:
 * the project has no basis to hold a number that no longer belongs to the
 * linked account.
 *
 * A provider account that's already linked to a *different* contributor row
 * is not refused. Successfully completing that provider's OAuth flow is the
 * strongest proof this app ever gets that two rows are the same real person
 * — only that person could have authenticated as that Telegram/Discord
 * account — so this records the row attempting to link as an alias of
 * whichever one already holds the identity (see
 * recordAliasFromSharedIdentity) instead of erroring. The identity itself is
 * never duplicated onto the new row: the unique constraint on
 * telegram_id/discord_id stays intact, and resolveProviderLabels is what
 * makes an alias's inherited link visible on its own profile page.
 *
 * Throws if `githubId` names no row — every caller reaches this only after
 * `ensureContributor`, so a miss here means that invariant broke rather than
 * something worth silently ignoring.
 */
export async function linkProvider(
  githubId: string,
  provider: Exclude<ProviderName, 'github'>,
  identity: Identity,
): Promise<void> {
  const sql =
    provider === 'telegram'
      ? `UPDATE contributors
            SET telegram_id = $2, telegram_username = $3, telegram_phone = $4, telegram_name = $5, updated_at = now()
          WHERE github_id = $1`
      : `UPDATE contributors
            SET discord_id = $2, discord_username = $3, discord_name = $4, updated_at = now()
          WHERE github_id = $1`

  const params =
    provider === 'telegram'
      ? [githubId, identity.providerId, identity.username ?? null, identity.phone ?? null, identity.name ?? null]
      : [githubId, identity.providerId, identity.username ?? null, identity.name ?? null]

  let result
  try {
    result = await pool.query(sql, params)
  } catch (error) {
    const violation = error as { code?: string; constraint?: string }
    if (violation.code === '23505') {
      await recordAliasFromSharedIdentity(githubId, provider, identity.providerId)
      return
    }
    throw error
  }
  if (result.rowCount === 0) throw new ContributorNotFoundError(githubId)
}

/**
 * Only sets the alias when this row doesn't already point somewhere else —
 * an existing alias (admin-set, or proven by an earlier shared identity) is
 * left alone rather than silently overwritten by a conflicting new claim; an
 * admin can sort out a genuine conflict by hand, via the registry file. The
 * calling OAuth flow still reads as a success to the contributor either way
 * — there was never anything wrong with the login itself.
 */
async function recordAliasFromSharedIdentity(
  githubId: string,
  provider: Exclude<ProviderName, 'github'>,
  providerId: string,
): Promise<void> {
  const column = provider === 'telegram' ? 'telegram_id' : 'discord_id'
  const { rows } = await pool.query<{ github_id: string }>(`SELECT github_id FROM contributors WHERE ${column} = $1`, [
    providerId,
  ])
  const ownerGithubId = rows[0]?.github_id
  if (!ownerGithubId || ownerGithubId === githubId) return

  await pool.query(
    'UPDATE contributors SET alias_of_github_id = $2, updated_at = now() WHERE github_id = $1 AND alias_of_github_id IS NULL',
    [githubId, ownerGithubId],
  )
}

/**
 * The label to show for a contributor's Telegram/Discord link on their own
 * profile page. A contributor with no direct link of their own, but who is
 * an alias of another row that does have one, inherits that link for
 * display — set by recordAliasFromSharedIdentity precisely because a
 * successful OAuth login proved the two rows share the same linked account.
 */
export async function resolveProviderLabels(
  contributor: Contributor,
): Promise<{ telegramLabel: string | null; discordLabel: string | null }> {
  const hasOwnTelegram = Boolean(contributor.telegramUsername || contributor.telegramPhone)
  const hasOwnDiscord = Boolean(contributor.discordUsername)

  const aliasTarget =
    contributor.aliasOfGithubId && (!hasOwnTelegram || !hasOwnDiscord)
      ? await findByGithubId(contributor.aliasOfGithubId)
      : null

  const telegramSource = hasOwnTelegram ? contributor : (aliasTarget ?? contributor)
  const discordSource = hasOwnDiscord ? contributor : (aliasTarget ?? contributor)

  return {
    telegramLabel: telegramSource.telegramUsername
      ? `@${telegramSource.telegramUsername}`
      : (telegramSource.telegramPhone ?? null),
    discordLabel: discordSource.discordUsername ?? null,
  }
}

/**
 * IDEA-000's two mandatory fields, checked against what's actually stored —
 * the server-side counterpart to mandatory-fields.ts's missingMandatoryFields,
 * which enforces the same Name-and-Email rule against a form's live draft
 * values so Save can't leave edit mode early. This is what IDEA-001's
 * sign-in redirect (Main vs. Profile-in-edit-mode) and IDEA-015's onboarding
 * checklist both key off, so the one reading of "complete" lives here rather
 * than in either of those callers.
 */
export function isProfileComplete(contributor: Pick<Contributor, 'name' | 'email'>): boolean {
  return Boolean(contributor.name?.trim()) && Boolean(contributor.email?.trim())
}

function randomConfirmationToken(): string {
  return randomBytes(32).toString('hex')
}

/**
 * `email` is the one typed field with side effects beyond its own column —
 * every save that actually changes the value clears the confirmation flow,
 * since a contributor can type any address at all here, unlike GitHub's own
 * prefill (see ensureContributor), which the provider has already verified.
 * A save that repeats the address already on file is a no-op on the
 * confirmation fields — re-focusing and blurring the field without changing
 * it must not reset an already-earned confirmation. Sending itself is a
 * separate, deliberate action (see resendConfirmationEmail) triggered by the
 * Send/Resend button — this never sends anything on its own, so a still-
 * unconfirmed address left over from before a save just stays unsent until
 * the contributor asks for it.
 */
async function saveEmail(githubId: string, value: string | undefined): Promise<void> {
  const normalized = value || null
  const current = await pool.query<{ email: string | null }>('SELECT email FROM contributors WHERE github_id = $1', [
    githubId,
  ])
  if (current.rows.length === 0) throw new ContributorNotFoundError(githubId)
  if (current.rows[0].email === normalized) return

  const result = await pool.query(
    `UPDATE contributors
        SET email = $2, email_confirmed_at = NULL, email_confirmation_token = NULL, email_confirmation_sent_at = NULL,
            updated_at = now()
      WHERE github_id = $1`,
    [githubId, normalized],
  )
  if (result.rowCount === 0) throw new ContributorNotFoundError(githubId)
}

/**
 * Saves one typed field exactly as given, including empty (stored as null) —
 * clearing a field is as deliberate an edit as filling one, and with no Save
 * button this is the only path a keystroke has to the database. Each field
 * autosaves independently so that, say, a still-invalid email in progress
 * never blocks a finished name from persisting. `email` specifically also
 * drives the confirmation flow — see saveEmail.
 */
export async function saveField(githubId: string, field: DetailField, value: string | undefined): Promise<void> {
  // `field` is typed `DetailField` for every in-repo caller, but this is the
  // one place the column name reaches a query string, so the closed set is
  // re-checked here too rather than trusting the type alone (see
  // isDetailField's doc comment).
  if (!isDetailField(field)) throw new Error(`saveField: not a recognized field: ${field}`)
  if (field === 'email') return saveEmail(githubId, value)
  const column = { name: 'name', company: 'company' }[field]
  const result = await pool.query(`UPDATE contributors SET ${column} = $2, updated_at = now() WHERE github_id = $1`, [
    githubId,
    value ?? null,
  ])
  if (result.rowCount === 0) throw new ContributorNotFoundError(githubId)
}

export type EmailConfirmationResult = 'confirmed' | 'expired' | 'invalid'

/**
 * Idempotent: the token survives a successful confirmation, and a repeat
 * visit to the same link reports 'confirmed' again without writing anything.
 * The first request to arrive is routinely not the contributor's own click —
 * corporate mail scanners detonate links before delivery, browsers prefetch,
 * people double-click — so "first touch wins, everyone else sees an error"
 * turned a working confirmation into a red "not valid" banner in production.
 * A replayed (leaked, logged, forwarded) link gains nothing from surviving:
 * it only ever re-reports an outcome, never identifies the contributor.
 * The token is only destroyed on paths where it must stop working: expiry
 * (here), and the address changing (see saveEmail).
 */
export async function confirmEmail(token: string): Promise<EmailConfirmationResult> {
  const { rows } = await pool.query<{
    github_id: string
    email_confirmation_sent_at: Date | null
    email_confirmed_at: Date | null
  }>(
    'SELECT github_id, email_confirmation_sent_at, email_confirmed_at FROM contributors WHERE email_confirmation_token = $1',
    [token],
  )
  const row = rows[0]
  if (!row) return 'invalid'
  if (row.email_confirmed_at) return 'confirmed'

  const sentAt = row.email_confirmation_sent_at
  if (!sentAt || Date.now() - sentAt.getTime() > EMAIL_CONFIRMATION_TTL_MS) {
    await pool.query('UPDATE contributors SET email_confirmation_token = NULL, updated_at = now() WHERE github_id = $1', [
      row.github_id,
    ])
    return 'expired'
  }

  await pool.query('UPDATE contributors SET email_confirmed_at = now(), updated_at = now() WHERE github_id = $1', [
    row.github_id,
  ])
  return 'confirmed'
}

/**
 * Sends a confirmation email, reusing the pending token if it's still live —
 * a fresh token on every send would silently kill the link in every email
 * already delivered, so a contributor who pressed the button twice and
 * opened the *older* of the two emails would hit "not valid" for no reason.
 * Only an expired (or absent) token is replaced. The 24h clock restarts on
 * every send either way, since each email promises a full 24 hours. For an
 * address that's already confirmed, or for a contributor with no email on
 * file at all, this is a deliberate no-op: there's nothing to send for
 * either case, and sending would otherwise let a stale "pending
 * confirmation" UI state silently re-arm an already-settled address.
 */
export async function resendConfirmationEmail(githubId: string): Promise<void> {
  const contributor = await findByGithubId(githubId)
  if (!contributor?.email || contributor.emailConfirmedAt) return

  const { rows } = await pool.query<{ email_confirmation_token: string | null; email_confirmation_sent_at: Date | null }>(
    'SELECT email_confirmation_token, email_confirmation_sent_at FROM contributors WHERE github_id = $1',
    [githubId],
  )
  const pending = rows[0]
  const stillLive =
    pending?.email_confirmation_token &&
    pending.email_confirmation_sent_at &&
    Date.now() - pending.email_confirmation_sent_at.getTime() <= EMAIL_CONFIRMATION_TTL_MS
  const token = stillLive ? pending.email_confirmation_token! : randomConfirmationToken()

  await pool.query(
    'UPDATE contributors SET email_confirmation_token = $2, email_confirmation_sent_at = now(), updated_at = now() WHERE github_id = $1',
    [githubId, token],
  )
  await sendConfirmationEmail(contributor.email, token)
}

/** Every field the cf-internal registry export is willing to publish — see
 * contributors-registry.ts's toRegistryYaml. */
export async function listContributorsForRegistry(): Promise<Contributor[]> {
  const { rows } = await pool.query<Row>('SELECT * FROM contributors ORDER BY github_login')
  return rows.map(toContributor)
}

export interface AdminFieldsUpdate {
  githubId: string
  status: ContributorStatus
  aliasOfGithubId: string | null
  isAgent: boolean
}

export interface SyncResult {
  updated: string[]
  notFound: string[]
  /** Applied to no row because `aliasOfGithubId` failed a DB constraint —
   * pointed at a `github_id` this app has never seen, or at the row's own
   * `github_id`. Distinct from `notFound`: here the *update's own subject*
   * exists, but the value it tried to write does not. */
  rejected: string[]
}

/**
 * Applies the registry file's three admin-owned columns (status,
 * aliasOfGithubId, isAgent), one row at a time — this app's whole
 * contributor set fits comfortably in a loop, and a plain per-row UPDATE is
 * far easier to reason about than a bulk statement for something this
 * infrequent (an hourly sync at most). A `github_id` with no matching row is
 * reported back rather than silently dropped: the registry file can
 * describe a contributor this app doesn't know about (a typo, a stale
 * entry), and the caller decides what to log. Likewise a row whose
 * `aliasOfGithubId` violates the FK or the not-self CHECK (see
 * migrations/006_alias_and_agent_fields.sql) is reported rather than
 * aborting every other row's update.
 */
export async function syncContributorAdminFields(updates: AdminFieldsUpdate[]): Promise<SyncResult> {
  const updated: string[] = []
  const notFound: string[] = []
  const rejected: string[] = []

  for (const { githubId, status, aliasOfGithubId, isAgent } of updates) {
    let result
    try {
      result = await pool.query(
        'UPDATE contributors SET status = $2, alias_of_github_id = $3, is_agent = $4, updated_at = now() WHERE github_id = $1',
        [githubId, status, aliasOfGithubId, isAgent],
      )
    } catch (error) {
      const violation = error as { code?: string }
      // 23503 foreign_key_violation, 23514 check_violation (alias_of_not_self).
      if (violation.code === '23503' || violation.code === '23514') {
        rejected.push(githubId)
        continue
      }
      throw error
    }
    if (result.rowCount) updated.push(githubId)
    else notFound.push(githubId)
  }

  return { updated, notFound, rejected }
}
