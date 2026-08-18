import { parse } from 'yaml'
import { z } from 'zod'

const configSchema = z.object({
  github_organization: z.string().min(1).optional(),
  github_contributors_team: z.string().min(1).optional(),
  discord_guild_id: z.string().min(1).optional(),
  discord_invite_url: z.string().min(1).optional(),
})

export interface AppConfigSync {
  githubOrganization?: string
  /** IDEA-053 — a team slug every confirmed contributor is added to on
   * invite, independent of any per-track team (IDEA-042's `github_team`
   * on `pass/tracks.yaml`). */
  githubContributorsTeam?: string
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
    discordGuildId: parsed.discord_guild_id,
    discordInviteUrl: parsed.discord_invite_url,
  }
}
