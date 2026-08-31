import { pool } from '@/lib/db'
import type { AppConfigSync } from '@/lib/app-config-registry'

export interface AppConfig {
  githubOrganization?: string
  /** IDEA-053 — org-wide default team every confirmed contributor is added
   * to on invite, distinct from any per-track team (IDEA-060). */
  githubContributorsTeam?: string
  /** IDEA-060 — e.g. `"{track}-contributors"`; lib/team-access.ts replaces
   * `{track}` with a track's own slug at grant time. */
  githubTrackTeamPattern?: string
  /** IDEA-063 — e.g. `"{track}-maintainers"`; same replacement, the
   * track's *maintainer* team instead of its contributor one. */
  githubTrackMaintainerTeamPattern?: string
  /** IDEA-115 — e.g. `"{track}-internal-readers"`; same replacement. Unlike
   * the contributor/maintainer teams, this one is never auto-created — it
   * only grants membership to a team an org owner already wired up with
   * its own repo permissions on GitHub's side. */
  githubTrackInternalReaderTeamPattern?: string
  discordGuildId?: string
  discordInviteUrl?: string
  /** IDEA-074 — track *names*, not slugs (array_position matches against
   * tracks.name in both listTracks and listTrackParticipation — see
   * migrations/030_preferred_track_order.sql). A name with no matching
   * track is silently inert; an unset/absent config falls back to
   * alphabetical order. */
  preferredTrackOrder?: string[]
}

interface Row {
  github_organization: string | null
  github_contributors_team: string | null
  github_track_team_pattern: string | null
  github_track_maintainer_team_pattern: string | null
  github_track_internal_reader_team_pattern: string | null
  discord_guild_id: string | null
  discord_invite_url: string | null
  preferred_track_order: string[] | null
}

function toAppConfig(row: Row): AppConfig {
  return {
    githubOrganization: row.github_organization ?? undefined,
    githubContributorsTeam: row.github_contributors_team ?? undefined,
    githubTrackTeamPattern: row.github_track_team_pattern ?? undefined,
    githubTrackMaintainerTeamPattern: row.github_track_maintainer_team_pattern ?? undefined,
    githubTrackInternalReaderTeamPattern: row.github_track_internal_reader_team_pattern ?? undefined,
    discordGuildId: row.discord_guild_id ?? undefined,
    discordInviteUrl: row.discord_invite_url ?? undefined,
    preferredTrackOrder: row.preferred_track_order ?? undefined,
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
    `INSERT INTO app_config (id, github_organization, github_contributors_team, github_track_team_pattern, github_track_maintainer_team_pattern, github_track_internal_reader_team_pattern, discord_guild_id, discord_invite_url, preferred_track_order, updated_at)
     VALUES (true, $1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (id) DO UPDATE
       SET github_organization = EXCLUDED.github_organization,
           github_contributors_team = EXCLUDED.github_contributors_team,
           github_track_team_pattern = EXCLUDED.github_track_team_pattern,
           github_track_maintainer_team_pattern = EXCLUDED.github_track_maintainer_team_pattern,
           github_track_internal_reader_team_pattern = EXCLUDED.github_track_internal_reader_team_pattern,
           discord_guild_id = EXCLUDED.discord_guild_id,
           discord_invite_url = EXCLUDED.discord_invite_url,
           preferred_track_order = EXCLUDED.preferred_track_order,
           updated_at = now()`,
    [
      config.githubOrganization ?? null,
      config.githubContributorsTeam ?? null,
      config.githubTrackTeamPattern ?? null,
      config.githubTrackMaintainerTeamPattern ?? null,
      config.githubTrackInternalReaderTeamPattern ?? null,
      config.discordGuildId ?? null,
      config.discordInviteUrl ?? null,
      config.preferredTrackOrder ?? null,
    ],
  )
}
