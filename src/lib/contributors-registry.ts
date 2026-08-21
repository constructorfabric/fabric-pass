import { parse, stringify } from 'yaml'
import { z } from 'zod'
import { isRegistryWritableStatus, type AdminFieldsUpdate, type Contributor } from '@/lib/contributors'

/**
 * The full shape written to and read from cf-internal's pass/contributors.yaml
 * — every column of the `contributors` table. Four fields are owned by the
 * file (`status`, `alias_of_github_id`, `is_agent`, `is_admin` — an admin's
 * judgment call, not something a contributor sets about themselves);
 * everything else is owned by this app and overwritten on each export. See
 * the module doc below for exactly which fields flow which way. `status`
 * specifically also has a second writer — see contributors.ts's
 * setContributorStatus — but round-trips through this same file either way.
 * `github_id` and `alias_of_github_id` are quoted on the way out (explicit
 * strings, not bare YAML ints) for the same reason both are `text` in
 * Postgres: a real production id has already overflowed a 64-bit integer
 * once (see migrations/003_telegram_id_as_text.sql's telegram_id, the same
 * shape of bug).
 */
interface RegistryRow {
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
  // Deliberately the only email-confirmation field here — the confirmation
  // token itself (see migrations/007_email_confirmation.sql) is never
  // exported: it's a bearer credential, and the registry file is neither
  // private nor access-controlled the way the database is.
  email_confirmed_at: string | null
  company: string | null
  status: string
  alias_of_github_id: string | null
  is_agent: boolean
  is_admin: boolean
  // IDEA-034 — derived, exported for visibility the same way
  // email_confirmed_at is, and likewise never read back in (see
  // registryRowSchema below and contributors.ts's refreshProfileCompleteness).
  profile_completeness: string
  created_at: string
  updated_at: string
}

/**
 * DB → YAML. Every field is written fresh from the database on every
 * export. That includes `status`/`alias_of_github_id`/`is_agent` — they're
 * read from the DB only because the DB is itself already a synced mirror of
 * the file's own last values for those three (see
 * contributors.ts#syncContributorAdminFields), not because this export is
 * where they originate.
 */
export function toRegistryYaml(contributors: Contributor[]): string {
  const rows: RegistryRow[] = contributors.map((contributor) => ({
    id: contributor.id,
    github_id: contributor.githubId,
    github_login: contributor.githubLogin,
    github_name: contributor.githubName ?? null,
    github_email: contributor.githubEmail ?? null,
    telegram_id: contributor.telegramId ?? null,
    telegram_username: contributor.telegramUsername ?? null,
    telegram_phone: contributor.telegramPhone ?? null,
    telegram_name: contributor.telegramName ?? null,
    discord_id: contributor.discordId ?? null,
    discord_username: contributor.discordUsername ?? null,
    discord_name: contributor.discordName ?? null,
    linkedin_id: contributor.linkedinId ?? null,
    linkedin_name: contributor.linkedinName ?? null,
    name: contributor.name ?? null,
    email: contributor.email ?? null,
    email_confirmed_at: contributor.emailConfirmedAt?.toISOString() ?? null,
    company: contributor.company ?? null,
    status: contributor.status,
    alias_of_github_id: contributor.aliasOfGithubId ?? null,
    is_agent: contributor.isAgent,
    is_admin: contributor.isAdmin,
    profile_completeness: contributor.profileCompleteness,
    created_at: contributor.createdAt.toISOString(),
    updated_at: contributor.updatedAt.toISOString(),
  }))
  return stringify({ contributors: rows })
}

const registryRowSchema = z.object({
  // Accepts a bare YAML integer too — an admin hand-editing the file is not
  // guaranteed to keep the quotes this app always writes — and normalizes
  // either shape to a string before it ever reaches a query parameter.
  github_id: z.union([z.string(), z.number()]).transform(String),
  status: z.string(),
  // Both optional: an admin adding a brand-new row, or hand-trimming the
  // file, isn't required to spell these out. Absent means "not an alias"
  // and "not an agent" respectively — the same values a fresh row gets from
  // the database's own column defaults, so there's nothing to preserve by
  // treating "missing" differently from "explicitly the default".
  alias_of_github_id: z.union([z.string(), z.number()]).transform(String).nullish(),
  is_agent: z.boolean().nullish(),
  is_admin: z.boolean().nullish(),
})

const registryFileSchema = z.object({
  contributors: z.array(z.unknown()).default([]),
})

/**
 * YAML → admin field updates. Only `github_id`, `status`, `alias_of_github_id`,
 * `is_agent`, and `is_admin` are read — every other column in the file is this app's own
 * last export, round-tripped by whatever wrote the file, and not a value
 * this app should ever adopt back in (see the module doc above). A row
 * failing validation (missing `github_id`, or a `status` outside what the
 * registry may write — see isRegistryWritableStatus) is dropped, not thrown
 * on: one malformed hand-edit shouldn't block every other row's fields from
 * syncing. `revoke_pending`/`revoked` are deliberately excluded from what
 * this parser accepts, even though they're valid ContributorStatus values —
 * IDEA-071's two-Admin-approval Revoke workflow is the only path to either,
 * and a raw file edit must not be able to bypass it (see
 * isRegistryWritableStatus's own doc comment). A row whose
 * `alias_of_github_id` doesn't survive the database's own FK/CHECK
 * constraints is caught later, in contributors.ts#syncContributorAdminFields
 * — this function has no database connection to validate against.
 */
export function parseRegistryYaml(content: string): { updates: AdminFieldsUpdate[]; invalidRowCount: number } {
  const parsed = registryFileSchema.parse(parse(content) ?? {})
  const updates: AdminFieldsUpdate[] = []
  let invalidRowCount = 0

  for (const raw of parsed.contributors) {
    const row = registryRowSchema.safeParse(raw)
    if (!row.success || !isRegistryWritableStatus(row.data.status)) {
      invalidRowCount += 1
      continue
    }
    updates.push({
      githubId: row.data.github_id,
      status: row.data.status,
      aliasOfGithubId: row.data.alias_of_github_id ?? null,
      isAgent: row.data.is_agent ?? false,
      isAdmin: row.data.is_admin ?? false,
    })
  }

  return { updates, invalidRowCount }
}
