import { parse } from 'yaml'
import { z } from 'zod'

const configSchema = z.object({
  github_organization: z.string().min(1).optional(),
  github_contributors_team: z.string().min(1).optional(),
  github_track_team_pattern: z.string().min(1).optional(),
  github_track_maintainer_team_pattern: z.string().min(1).optional(),
  discord_guild_id: z.string().min(1).optional(),
  discord_invite_url: z.string().min(1).optional(),
})

export interface AppConfigSync {
  githubOrganization?: string
  /** IDEA-053 — a team slug every confirmed contributor is added to on
   * invite, independent of any per-track team (see githubTrackTeamPattern
   * below). */
  githubContributorsTeam?: string
  /** IDEA-060 — the naming convention for a track's own GitHub team, e.g.
   * `"{track}-contributors"`. The `{track}` token is replaced with the
   * track's own slug at grant time (lib/team-access.ts) — this is a
   * pattern, not a literal team name, unlike githubContributorsTeam above. */
  githubTrackTeamPattern?: string
  /** IDEA-063 — the naming convention for a track's *maintainer* GitHub
   * team, e.g. `"{track}-maintainers"`. Parallel to githubTrackTeamPattern
   * above, same `{track}` replacement, different team — a Maintainer is
   * additionally in this team, not instead of the contributors one. */
  githubTrackMaintainerTeamPattern?: string
  discordGuildId?: string
  discordInviteUrl?: string
}

/**
 * pass/config.yaml -> AppConfigSync. Unlike tracks.yaml/artifact-links.yaml
 * (a list of rows, one bad row dropped without blocking the rest),
 * config.yaml is one flat object — a parse failure here has nothing
 * partial to salvage, so it throws rather than returning a
 * silently-empty config. The caller (the sync route) reports that as a
 * clear 400, the same way a malformed request body would.
 */
export function parseConfigYaml(content: string): AppConfigSync {
  const parsed = configSchema.parse(parse(content) ?? {})
  return {
    githubOrganization: parsed.github_organization,
    githubContributorsTeam: parsed.github_contributors_team,
    githubTrackTeamPattern: parsed.github_track_team_pattern,
    githubTrackMaintainerTeamPattern: parsed.github_track_maintainer_team_pattern,
    discordGuildId: parsed.discord_guild_id,
    discordInviteUrl: parsed.discord_invite_url,
  }
}
