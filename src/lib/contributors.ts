import { randomBytes } from 'node:crypto'
import { pool } from '@/lib/db'
import { EMAIL_CONFIRMATION_TTL_MS, sendConfirmationEmail } from '@/lib/email'
import { isProviderConfigured } from '@/lib/providers'
import type { Identity, ProviderName } from '@/lib/providers/types'
import { computeProfileCompleteness, type ProfileCompleteness } from '@/lib/profile-completeness'

/**
 * `draft`/`confirmed` are owned by cf-internal's pass/contributors.yaml, not
 * by this app — see migrations/005_contributor_status.sql. A contributor
 * reaches 'draft' on their own, the moment they sign in with GitHub; only an
 * admin editing the registry file can promote one to 'confirmed', via
 * /internal/contributors/sync. `blocked` (migrations/011_blocked_status.sql,
 * displayed "Ignored" — see contributor-status-labels.ts) is different: an
 * Admin sets it directly from /admin (see setContributorStatus below), not
 * via the registry file.
 *
 * IDEA-071 — `revoke_pending`/`revoked` (migrations/029_contributor_revoke.sql)
 * are the two-Admin-approval path for pulling access from an already-
 * `confirmed` contributor: the first Admin's Revoke only requests it
 * (`revoke_pending`); a second Admin approving is what actually removes
 * GitHub access and lands on the terminal `revoked` — see requestRevoke/
 * approveRevoke/cancelRevoke below. Deliberately its own terminal value, not
 * a reuse of `blocked` — a former contributor's history reads differently
 * from a stranger who was never confirmed.
 */
export const CONTRIBUTOR_STATUSES = ['draft', 'confirmed', 'blocked', 'revoke_pending', 'revoked'] as const
export type ContributorStatus = (typeof CONTRIBUTOR_STATUSES)[number]

export function isContributorStatus(value: string): value is ContributorStatus {
  return (CONTRIBUTOR_STATUSES as readonly string[]).includes(value)
}

const REGISTRY_WRITABLE_STATUSES = ['draft', 'confirmed', 'blocked'] as const

/**
 * IDEA-071 — narrower than isContributorStatus above, for exactly one
 * caller: contributors-registry.ts's parseRegistryYaml. The registry file's
 * `status` column writes directly, with no requester, no reason, and no
 * second-Admin approval — exactly what requestRevoke/approveRevoke's
 * two-person gate exists to require. Excluding `revoke_pending`/`revoked`
 * from what the file can set keeps that gate the only way to reach them;
 * `draft`/`confirmed`/`blocked` were already writable this way before this
 * status existed and stay so.
 */
export function isRegistryWritableStatus(value: string): value is (typeof REGISTRY_WRITABLE_STATUSES)[number] {
  return (REGISTRY_WRITABLE_STATUSES as readonly string[]).includes(value)
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
  /** No `linkedinUsername`: unlike Discord/Telegram, LinkedIn's OIDC payload
   * carries no username or vanity-URL claim (see providers/linkedin.ts) —
   * `linkedinName` is the only label there is. */
  linkedinId?: string
  linkedinName?: string
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
  /** IDEA-071 — set only while `status = 'revoke_pending'` (kept, not
   * cleared, once `status = 'revoked'` — a visible "who/why" record on the
   * row itself); `undefined` otherwise. `revokeRequestedByGithubId` is who
   * clicked Revoke, checked server-side so that same Admin can't also
   * Approve their own request. */
  revokeRequestedByGithubId?: string
  revokeReason?: string
  revokeRequestedAt?: Date
  /** Another contributor's `githubId` — this row is the same real person,
   * registered a second time. Empty means this is a primary contributor,
   * not an alias of anyone. Owned by the registry file, same as `status`. */
  aliasOfGithubId?: string
  /** A bot/agent account rather than a human. Owned by the registry file,
   * same as `status`. */
  isAgent: boolean
  /** Grants the global Admin role (see lib/roles.ts) — owned by the
   * registry file, same as `status`/`isAgent`. `isRootUser` (lib/root-user.ts)
   * is a separate, env-configured admin that isn't stored here at all. */
  isAdmin: boolean
  /** IDEA-034 — derived, not self-reported; see refreshProfileCompleteness.
   * Exported to pass/contributors.yaml for visibility, same as
   * emailConfirmedAt, but never read back in from the file. */
  profileCompleteness: ProfileCompleteness
  /** IDEA-041 — last time this app attempted to invite this contributor to
   * the GitHub org / send them the Discord server invite, stamped on
   * attempt (not just success) so the Admin list's Re-invite cooldown
   * can't be bypassed by a run of failures. `undefined` means never
   * attempted. See lib/invites.ts. */
  githubOrgInvitedAt?: Date
  discordInvitedAt?: Date
  /** IDEA-053 — last time this app attempted to add this contributor to
   * the default org-wide GitHub Contributors team, stamped on attempt
   * the same way the two fields above are. `undefined` means never
   * attempted — either never invited, or `github_contributors_team` isn't
   * configured. See lib/invites.ts. */
  githubContributorsTeamAddedAt?: Date
  /** IDEA-047 — set the moment this contributor clicks through to a policy
   * document from the Policies page (see policies/visit's redirect
   * route), never just from visiting the page itself. The "read the
   * community policies" checklist item's done signal. */
  policyLinkClickedAt?: Date
  /** IDEA-047 — each of the checklist's three items can be individually
   * hidden once done, independent of the item's own completion signal
   * above (profileCompleteness, this field, and track membership
   * respectively). `undefined` means still shown. */
  checklistProfileHiddenAt?: Date
  checklistPoliciesHiddenAt?: Date
  checklistTrackHiddenAt?: Date
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
  linkedin_id: string | null
  linkedin_name: string | null
  name: string | null
  email: string | null
  email_confirmed_at: Date | null
  email_confirmation_sent_at: Date | null
  company: string | null
  status: ContributorStatus
  revoke_requested_by_github_id: string | null
  revoke_reason: string | null
  revoke_requested_at: Date | null
  alias_of_github_id: string | null
  is_agent: boolean
  is_admin: boolean
  profile_completeness: ProfileCompleteness
  github_org_invited_at: Date | null
  discord_invited_at: Date | null
  github_contributors_team_added_at: Date | null
  policy_link_clicked_at: Date | null
  checklist_profile_hidden_at: Date | null
  checklist_policies_hidden_at: Date | null
  checklist_track_hidden_at: Date | null
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
    linkedinId: row.linkedin_id ?? undefined,
    linkedinName: row.linkedin_name ?? undefined,
    name: row.name ?? undefined,
    email: row.email ?? undefined,
    emailConfirmedAt: row.email_confirmed_at ?? undefined,
    emailConfirmationSentAt: row.email_confirmation_sent_at ?? undefined,
    company: row.company ?? undefined,
    status: row.status,
    revokeRequestedByGithubId: row.revoke_requested_by_github_id ?? undefined,
    revokeReason: row.revoke_reason ?? undefined,
    revokeRequestedAt: row.revoke_requested_at ?? undefined,
    aliasOfGithubId: row.alias_of_github_id ?? undefined,
    isAgent: row.is_agent,
    isAdmin: row.is_admin,
    profileCompleteness: row.profile_completeness,
    githubOrgInvitedAt: row.github_org_invited_at ?? undefined,
    discordInvitedAt: row.discord_invited_at ?? undefined,
    githubContributorsTeamAddedAt: row.github_contributors_team_added_at ?? undefined,
    policyLinkClickedAt: row.policy_link_clicked_at ?? undefined,
    checklistProfileHiddenAt: row.checklist_profile_hidden_at ?? undefined,
    checklistPoliciesHiddenAt: row.checklist_policies_hidden_at ?? undefined,
    checklistTrackHiddenAt: row.checklist_track_hidden_at ?? undefined,
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
 * One entry per linkable provider, keyed by `Exclude<ProviderName,
 * 'github'>`. `idColumn` is also what `recordAliasFromSharedIdentity` reads
 * to find a conflicting row — kept alongside `sql`/`params` rather than in a
 * second, separately-maintained lookup, since it's the same column named
 * twice either way. LinkedIn has no `params` entry for username/phone: its
 * OIDC payload carries neither claim (see providers/linkedin.ts), so its SQL
 * only ever sets `linkedin_id`/`linkedin_name`.
 */
const PROVIDER_LINK_QUERIES: Record<
  Exclude<ProviderName, 'github'>,
  { idColumn: string; sql: string; params: (identity: Identity) => unknown[] }
> = {
  telegram: {
    idColumn: 'telegram_id',
    sql: `UPDATE contributors
            SET telegram_id = $2, telegram_username = $3, telegram_phone = $4, telegram_name = $5, updated_at = now()
          WHERE github_id = $1`,
    params: (identity) => [identity.providerId, identity.username ?? null, identity.phone ?? null, identity.name ?? null],
  },
  discord: {
    idColumn: 'discord_id',
    sql: `UPDATE contributors
            SET discord_id = $2, discord_username = $3, discord_name = $4, updated_at = now()
          WHERE github_id = $1`,
    params: (identity) => [identity.providerId, identity.username ?? null, identity.name ?? null],
  },
  linkedin: {
    idColumn: 'linkedin_id',
    sql: `UPDATE contributors
            SET linkedin_id = $2, linkedin_name = $3, updated_at = now()
          WHERE github_id = $1`,
    params: (identity) => [identity.providerId, identity.name ?? null],
  },
}

/**
 * Writes one provider's whole identity as a unit — id together with
 * whichever of username/phone/name that provider carries — the moment its
 * OAuth callback returns, so a value left over from a *different* linked
 * account cannot survive beside the new one. Telegram's username and phone
 * are mutually exclusive by construction (see providers/telegram.ts's
 * toIdentity), so re-linking a username-bearing account after a phone-only
 * one has to clear the phone rather than keep it: the project has no basis
 * to hold a number that no longer belongs to the linked account.
 *
 * A provider account that's already linked to a *different* contributor row
 * is not refused. Successfully completing that provider's OAuth flow is the
 * strongest proof this app ever gets that two rows are the same real person
 * — only that person could have authenticated as that Telegram/Discord/
 * LinkedIn account — so this records the row attempting to link as an alias
 * of whichever one already holds the identity (see
 * recordAliasFromSharedIdentity) instead of erroring. The identity itself is
 * never duplicated onto the new row: the unique constraint on
 * telegram_id/discord_id/linkedin_id stays intact, and resolveProviderLabels
 * is what makes an alias's inherited link visible on its own profile page.
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
  const { sql, params } = PROVIDER_LINK_QUERIES[provider]

  let result
  try {
    result = await pool.query(sql, [githubId, ...params(identity)])
  } catch (error) {
    const violation = error as { code?: string; constraint?: string }
    if (violation.code === '23505') {
      await recordAliasFromSharedIdentity(githubId, provider, identity.providerId)
      return
    }
    throw error
  }
  if (result.rowCount === 0) throw new ContributorNotFoundError(githubId)
  // Discord/Telegram/LinkedIn all factor into completeness (mandatory for
  // Discord, optional for the other two) — not run in the alias-conflict
  // branch above, since that path never touches this row's own provider
  // columns, only alias_of_github_id (see missingForCompleteness's doc
  // comment on why alias-inherited links don't count here, matching the
  // existing mandatory-field check's own precedent).
  await refreshProfileCompleteness(githubId)
}

/**
 * IDEA-034's persisted `profile_completeness` recomputed from this row's own
 * current columns — called after every write that could change it
 * (saveField/saveEmail, confirmEmail, linkProvider). A plain re-read-then-
 * write rather than folding the computation into each caller's own UPDATE:
 * one place to keep in sync with computeProfileCompleteness, at the cost of
 * one extra round-trip per write, which is fine at this app's scale (see
 * syncTracks's own "a loop is fine here" reasoning). A no-op if the row
 * doesn't exist — every caller already has its own ContributorNotFoundError
 * check on the write that precedes this.
 */
async function refreshProfileCompleteness(githubId: string): Promise<void> {
  const { rows } = await pool.query<{
    name: string | null
    email: string | null
    email_confirmed_at: Date | null
    company: string | null
    discord_username: string | null
    telegram_username: string | null
    telegram_phone: string | null
    linkedin_name: string | null
  }>(
    `SELECT name, email, email_confirmed_at, company, discord_username, telegram_username, telegram_phone, linkedin_name
       FROM contributors WHERE github_id = $1`,
    [githubId],
  )
  const row = rows[0]
  if (!row) return

  const completeness = computeProfileCompleteness({
    name: row.name ?? undefined,
    email: row.email ?? undefined,
    company: row.company ?? undefined,
    discordLinked: Boolean(row.discord_username),
    emailConfirmed: Boolean(row.email_confirmed_at),
    telegramLinked: Boolean(row.telegram_username || row.telegram_phone),
    linkedinLinked: Boolean(row.linkedin_name),
    linkedinEnabled: isProviderConfigured('linkedin'),
  })
  await pool.query('UPDATE contributors SET profile_completeness = $2 WHERE github_id = $1', [githubId, completeness])
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
  const column = PROVIDER_LINK_QUERIES[provider].idColumn
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
 * The label to show for a contributor's Telegram/Discord/LinkedIn link on
 * their own profile page. A contributor with no direct link of their own,
 * but who is an alias of another row that does have one, inherits that link
 * for display — set by recordAliasFromSharedIdentity precisely because a
 * successful OAuth login proved the two rows share the same linked account.
 */
export async function resolveProviderLabels(
  contributor: Contributor,
): Promise<{ telegramLabel: string | null; discordLabel: string | null; linkedinLabel: string | null }> {
  const hasOwnTelegram = Boolean(contributor.telegramUsername || contributor.telegramPhone)
  const hasOwnDiscord = Boolean(contributor.discordUsername)
  const hasOwnLinkedin = Boolean(contributor.linkedinName)

  const aliasTarget =
    contributor.aliasOfGithubId && (!hasOwnTelegram || !hasOwnDiscord || !hasOwnLinkedin)
      ? await findByGithubId(contributor.aliasOfGithubId)
      : null

  const telegramSource = hasOwnTelegram ? contributor : (aliasTarget ?? contributor)
  const discordSource = hasOwnDiscord ? contributor : (aliasTarget ?? contributor)
  const linkedinSource = hasOwnLinkedin ? contributor : (aliasTarget ?? contributor)

  return {
    telegramLabel: telegramSource.telegramUsername
      ? `@${telegramSource.telegramUsername}`
      : (telegramSource.telegramPhone ?? null),
    discordLabel: discordSource.discordUsername ?? null,
    linkedinLabel: linkedinSource.linkedinName ?? null,
  }
}

/**
 * The whole "same real person" cluster around a contributor — the row
 * itself, whichever row it's an alias of (if any), and every other row
 * that's an alias of that same primary. IDEA-004's "merges in everything
 * recorded under any of that contributor's aliases" needs both directions:
 * opening an alias's own page should show the primary's providers, and
 * opening the primary's page should show an alias's providers too —
 * resolveProviderLabels above only ever handles the first direction, for
 * the signed-in contributor's own page.
 */
async function resolveProfileCluster(contributor: Contributor): Promise<Contributor[]> {
  const primaryId = contributor.aliasOfGithubId ?? contributor.githubId
  const { rows } = await pool.query<Row>('SELECT * FROM contributors WHERE github_id = $1 OR alias_of_github_id = $1', [
    primaryId,
  ])
  return rows.map(toContributor)
}

export interface PublicProfile {
  hash: string
  /** Not displayed — only used to detect "this is the signed-in viewer's
   * own row" and redirect to the editable /profile instead. */
  githubId: string
  githubLogin: string
  name: string
  company?: string
  /** Only set when the contributing row's email is confirmed — an
   * unconfirmed, self-typed address might not even belong to this person,
   * so it's never handed out as a contact link. */
  emailLabel?: string
  discordId?: string
  discordLabel?: string
  telegramUsername?: string
  telegramPhone?: string
  /** Name only — LinkedIn's OIDC profile carries no username or vanity-URL
   * claim (see providers/linkedin.ts), so there's nothing to link to. */
  linkedinLabel?: string
}

/**
 * A contributor's public, read-only profile, keyed by `md5(id)` rather than
 * `id` itself or `github_id` — short, and stable even if the underlying row
 * is ever looked up a different way. Computed at query time (no stored
 * column, no migration): this table is small enough that a plain scan costs
 * nothing worth optimizing for. `confirmed` only — a `draft` signup has no
 * public page yet, matching how the registry sync already treats
 * `confirmed` as the "real directory entry" status.
 */
export async function getPublicProfile(hash: string): Promise<PublicProfile | null> {
  const { rows } = await pool.query<Row>(`SELECT * FROM contributors WHERE md5(id::text) = $1 AND status = 'confirmed'`, [
    hash,
  ])
  const row = rows[0]
  if (!row) return null

  const contributor = toContributor(row)
  const cluster = await resolveProfileCluster(contributor)
  // The opened row's own values win first — its own name/company, if it has
  // one, over the primary's — falling back to the rest of the cluster only
  // when it doesn't.
  const candidates = [contributor, ...cluster.filter((c) => c.githubId !== contributor.githubId)]

  const name = candidates.map((c) => c.name).find(Boolean) ?? contributor.githubLogin
  const company = candidates.map((c) => c.company).find(Boolean)
  const emailSource = candidates.find((c) => c.email && c.emailConfirmedAt)
  const discordSource = candidates.find((c) => c.discordUsername)
  const telegramSource = candidates.find((c) => c.telegramUsername || c.telegramPhone)
  const linkedinSource = candidates.find((c) => c.linkedinName)

  return {
    hash,
    githubId: contributor.githubId,
    githubLogin: contributor.githubLogin,
    name,
    company,
    emailLabel: emailSource?.email,
    discordId: discordSource?.discordId,
    discordLabel: discordSource?.discordUsername,
    telegramUsername: telegramSource?.telegramUsername,
    telegramPhone: telegramSource?.telegramPhone,
    linkedinLabel: linkedinSource?.linkedinName,
  }
}

export interface ContributorSearchResult {
  hash: string
  name: string
  company?: string
}

/**
 * `confirmed` contributors only, same reasoning as getPublicProfile above.
 * Ranked so a match at the *start* of a field sorts above one merely
 * containing the query somewhere inside it; alphabetical by display name
 * breaks ties. Capped at 5 — a quick "which of these did you mean," not a
 * full results page. Below `MIN_QUERY_LENGTH` characters this returns
 * nothing rather than the whole (small but growing) contributor table.
 */
const MIN_SEARCH_QUERY_LENGTH = 3

export async function searchContributors(query: string): Promise<ContributorSearchResult[]> {
  const trimmed = query.trim()
  if (trimmed.length < MIN_SEARCH_QUERY_LENGTH) return []

  const contains = `%${trimmed}%`
  const startsWith = `${trimmed}%`
  const { rows } = await pool.query<{ hash: string; name: string | null; github_login: string; company: string | null }>(
    `SELECT md5(id::text) AS hash, name, github_login, company
       FROM contributors
      WHERE status = 'confirmed'
        AND (name ILIKE $1 OR email ILIKE $1 OR github_login ILIKE $1 OR github_email ILIKE $1
             OR discord_username ILIKE $1 OR telegram_username ILIKE $1 OR linkedin_name ILIKE $1)
      ORDER BY
        CASE WHEN name ILIKE $2 OR email ILIKE $2 OR github_login ILIKE $2 OR github_email ILIKE $2
                  OR discord_username ILIKE $2 OR telegram_username ILIKE $2 OR linkedin_name ILIKE $2
             THEN 0 ELSE 1 END,
        COALESCE(name, github_login)
      LIMIT 5`,
    [contains, startsWith],
  )
  return rows.map((r) => ({ hash: r.hash, name: r.name ?? r.github_login, company: r.company ?? undefined }))
}

/** IDEA-046's People tile — a plain count, not a fetch of every row
 * (listContributorsForRegistry exists for that, but would be wasteful here
 * for a number nobody reads past). `confirmed` only, same population
 * searchContributors and getPublicProfile already limit themselves to. */
export async function countConfirmedContributors(): Promise<number> {
  const { rows } = await pool.query<{ count: string }>("SELECT COUNT(*) FROM contributors WHERE status = 'confirmed'")
  return Number(rows[0].count)
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
  await refreshProfileCompleteness(githubId)
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
  await refreshProfileCompleteness(githubId)
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
  await refreshProfileCompleteness(row.github_id)
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

/**
 * IDEA-066's Admin mailing-list export — every contributor an Admin is
 * actually allowed to reach: `status = 'confirmed'` (an Admin's own
 * judgment call, not the contributor's) *and* a confirmed email address (the
 * contributor's own claim on it, verified). A `draft`/`blocked` contributor,
 * or a `confirmed` one who never finished the confirm-my-email step, is
 * never in this list even though `email` itself might be non-null in either
 * case.
 */
export async function listConfirmedContributorEmails(): Promise<string[]> {
  const { rows } = await pool.query<{ email: string }>(
    `SELECT email FROM contributors
      WHERE status = 'confirmed' AND email_confirmed_at IS NOT NULL AND email IS NOT NULL
      ORDER BY email`,
  )
  return rows.map((row) => row.email)
}

export interface AdminFieldsUpdate {
  githubId: string
  status: ContributorStatus
  aliasOfGithubId: string | null
  isAgent: boolean
  isAdmin: boolean
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
 * Applies the registry file's admin-owned columns (status, aliasOfGithubId,
 * isAgent, isAdmin), one row at a time — this app's whole contributor set
 * fits comfortably in a loop, and a plain per-row UPDATE is far easier to
 * reason about than a bulk statement for something this infrequent (an
 * hourly sync at most). A `github_id` with no matching row is reported back
 * rather than silently dropped: the registry file can describe a
 * contributor this app doesn't know about (a typo, a stale entry), and the
 * caller decides what to log. Likewise a row whose `aliasOfGithubId`
 * violates the FK or the not-self CHECK (see
 * migrations/006_alias_and_agent_fields.sql) is reported rather than
 * aborting every other row's update.
 *
 * This is also the path setContributorStatus's direct writes (below) get
 * folded back through the registry file: an export reads `status` straight
 * from the DB (contributors-registry.ts's toRegistryYaml), so an Admin's
 * Confirm/Block shows up in the file on the next scheduled export, and
 * round-trips back in here unchanged on the sync that follows.
 */
export async function syncContributorAdminFields(updates: AdminFieldsUpdate[]): Promise<SyncResult> {
  const updated: string[] = []
  const notFound: string[] = []
  const rejected: string[] = []

  for (const { githubId, status, aliasOfGithubId, isAgent, isAdmin } of updates) {
    let result
    try {
      result = await pool.query(
        'UPDATE contributors SET status = $2, alias_of_github_id = $3, is_agent = $4, is_admin = $5, updated_at = now() WHERE github_id = $1',
        [githubId, status, aliasOfGithubId, isAgent, isAdmin],
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

/**
 * IDEA-012's Confirm/Block, called from /admin — the one place this app
 * writes `status` directly rather than only through the registry-file sync
 * above. `blocked` behaves exactly like `draft` everywhere status already
 * gates something (search, the public profile — both already require
 * `confirmed`): hidden, not additionally locked out of signing in or
 * editing their own profile. See syncContributorAdminFields's doc comment
 * for how this folds back through the registry file on the next export.
 */
export async function setContributorStatus(githubId: string, status: 'confirmed' | 'blocked'): Promise<void> {
  const result = await pool.query('UPDATE contributors SET status = $2, updated_at = now() WHERE github_id = $1', [
    githubId,
    status,
  ])
  if (result.rowCount === 0) throw new ContributorNotFoundError(githubId)
}

export class NotConfirmedError extends Error {}
export class NotRevokePendingError extends Error {}

/**
 * IDEA-071's Revoke request — the first of the two Admin actions a full
 * revoke needs. Only a currently-`confirmed` contributor can have one
 * requested (mirrors decideJoinRequest/removeTrackMember's own "only from
 * one specific starting status" guard) — this alone doesn't touch GitHub at
 * all, that's deferred to approveRevoke, the entire point of the two-person
 * gate.
 */
export async function requestRevoke(githubId: string, requestedByGithubId: string, reason: string): Promise<void> {
  const result = await pool.query(
    `UPDATE contributors
        SET status = 'revoke_pending', revoke_requested_by_github_id = $2, revoke_reason = $3,
            revoke_requested_at = now(), updated_at = now()
      WHERE github_id = $1 AND status = 'confirmed'`,
    [githubId, requestedByGithubId, reason],
  )
  if (result.rowCount === 0) throw new NotConfirmedError(githubId)
}

/**
 * IDEA-071's Cancel — any Admin (not just the original requester) can back
 * a pending revoke out, reverting to `confirmed` and clearing the three
 * revoke columns so a later request starts fresh. Only valid from
 * `revoke_pending` — same guard shape as requestRevoke above.
 */
export async function cancelRevoke(githubId: string): Promise<void> {
  const result = await pool.query(
    `UPDATE contributors
        SET status = 'confirmed', revoke_requested_by_github_id = NULL, revoke_reason = NULL,
            revoke_requested_at = NULL, updated_at = now()
      WHERE github_id = $1 AND status = 'revoke_pending'`,
    [githubId],
  )
  if (result.rowCount === 0) throw new NotRevokePendingError(githubId)
}

/**
 * IDEA-071's Approve Revoking — the second Admin's sign-off. Only valid
 * from `revoke_pending`. The revoke columns are deliberately *not* cleared
 * here (contrast cancelRevoke) — they stay as a visible "who requested
 * this, and why" record directly on the row once `revoked` is terminal.
 * The actual GitHub removal (team + org) happens in the caller
 * (admin/actions.ts's approveRevokeAction), after this DB write commits —
 * same "persist the decision first" ordering every other admin action in
 * this app already follows.
 *
 * `approvedByGithubId` is checked in the `WHERE` clause itself, not just by
 * the caller beforehand — the caller's own pre-read-then-compare has a gap
 * between the read and this write (the requester could cancel and re-request
 * under the same approver in between), and the `WHERE` clause is the only
 * place a check is atomic with the write. A self-approval attempt now simply
 * matches no row and throws NotRevokePendingError, same as any other
 * no-longer-pending case.
 */
export async function approveRevoke(githubId: string, approvedByGithubId: string): Promise<void> {
  const result = await pool.query(
    `UPDATE contributors SET status = 'revoked', updated_at = now()
      WHERE github_id = $1 AND status = 'revoke_pending' AND revoke_requested_by_github_id IS DISTINCT FROM $2`,
    [githubId, approvedByGithubId],
  )
  if (result.rowCount === 0) throw new NotRevokePendingError(githubId)
}

/** IDEA-041 — stamped on attempt (see lib/invites.ts's inviteConfirmedContributor,
 * the only caller), backing the Admin list's 15-minute Re-invite cooldown. */
export async function markGithubOrgInvited(githubId: string): Promise<void> {
  await pool.query('UPDATE contributors SET github_org_invited_at = now() WHERE github_id = $1', [githubId])
}

export async function markDiscordInvited(githubId: string): Promise<void> {
  await pool.query('UPDATE contributors SET discord_invited_at = now() WHERE github_id = $1', [githubId])
}

/** IDEA-053 — stamped on attempt, same discipline as markGithubOrgInvited
 * above (see lib/invites.ts's inviteConfirmedContributor, the only caller). */
export async function markGithubContributorsTeamAdded(githubId: string): Promise<void> {
  await pool.query('UPDATE contributors SET github_contributors_team_added_at = now() WHERE github_id = $1', [githubId])
}

/** IDEA-047 — the "read the community policies" checklist item's done
 * signal. Called only from policies/visit's redirect route, never
 * from the Policies page itself — landing on the page isn't enough, only
 * following a link off it counts. Idempotent: a second, third, ... click
 * just re-stamps the same moment, not an error. */
export async function markPolicyLinkClicked(githubId: string): Promise<void> {
  await pool.query('UPDATE contributors SET policy_link_clicked_at = now() WHERE github_id = $1', [githubId])
}

/** IDEA-047's three checklist items, named the same way OnboardingChecklist's
 * own props already do (profileComplete / readPolicies / trackMembership),
 * mapped here to the one column each actually owns. */
export type ChecklistItem = 'profile' | 'policies' | 'track'

const CHECKLIST_HIDDEN_COLUMNS: Record<ChecklistItem, string> = {
  profile: 'checklist_profile_hidden_at',
  policies: 'checklist_policies_hidden_at',
  track: 'checklist_track_hidden_at',
}

/** A contributor hiding a checklist item they've already completed — see
 * OnboardingChecklist's "Hide" control, only ever shown on a done item.
 * Nothing re-checks that server-side: hiding an item that's still `todo`
 * is a client bug, not a security boundary, since it only ever removes
 * something from that same contributor's own view of their own checklist. */
export async function hideChecklistItem(githubId: string, item: ChecklistItem): Promise<void> {
  const column = CHECKLIST_HIDDEN_COLUMNS[item]
  await pool.query(`UPDATE contributors SET ${column} = now() WHERE github_id = $1`, [githubId])
}
