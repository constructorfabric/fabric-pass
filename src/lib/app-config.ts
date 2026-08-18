import { pool } from '@/lib/db'
import type { AppConfigSync } from '@/lib/app-config-registry'

export interface AppConfig {
  githubOrganization?: string
  /** IDEA-053 — org-wide default team every confirmed contributor is added
   * to on invite, distinct from any per-track team (IDEA-042). */
  githubContributorsTeam?: string
  discordGuildId?: string
  discordInviteUrl?: string
}

interface Row {
  github_organization: string | null
  github_contributors_team: string | null
  discord_guild_id: string | null
  discord_invite_url: string | null
}

function toAppConfig(row: Row): AppConfig {
  return {
    githubOrganization: row.github_organization ?? undefined,
    githubContributorsTeam: row.github_contributors_team ?? undefined,
    discordGuildId: row.discord_guild_id ?? undefined,
    discordInviteUrl: row.discord_invite_url ?? undefined,
  }
}

/** IDEA-040 — the org/guild identity IDEA-041/042's invite calls target.
 * `null` before the first sync has ever landed (same "singleton row,
 * possibly absent" shape as track-page-template.ts's getTrackPageTemplate). */
export async function getAppConfig(): Promise<AppConfig | null> {
  const { rows } = await pool.query<Row>('SELECT * FROM app_config WHERE id = true')
  return rows[0] ? toAppConfig(rows[0]) : null
}

/** pass/config.yaml -> DB, one-way, same reasoning as every other cf-internal
 * sync in this app — nothing here is self-reported by any one contributor.
 * Upsert against the singleton row, same as track-page-template.ts. */
export async function syncAppConfig(config: AppConfigSync): Promise<void> {
  await pool.query(
    `INSERT INTO app_config (id, github_organization, github_contributors_team, discord_guild_id, discord_invite_url, updated_at)
     VALUES (true, $1, $2, $3, $4, now())
     ON CONFLICT (id) DO UPDATE
       SET github_organization = EXCLUDED.github_organization,
           github_contributors_team = EXCLUDED.github_contributors_team,
           discord_guild_id = EXCLUDED.discord_guild_id,
           discord_invite_url = EXCLUDED.discord_invite_url,
           updated_at = now()`,
    [
      config.githubOrganization ?? null,
      config.githubContributorsTeam ?? null,
      config.discordGuildId ?? null,
      config.discordInviteUrl ?? null,
    ],
  )
}
