import { getAppConfig } from '@/lib/app-config'
import type { Contributor } from '@/lib/contributors'
import { addToGitHubTeam } from '@/lib/github-org'
import { grantDiscordRole } from '@/lib/discord-role'
import { markDiscordRoleAdded, markGithubTeamAdded } from '@/lib/track-members'
import type { Track } from '@/lib/tracks'

/**
 * IDEA-042 — called from tracks/admin/actions.ts's decideJoinRequestAction
 * right after a join request is approved. Same best-effort, never-throw
 * discipline as lib/invites.ts's inviteConfirmedContributor: the
 * membership decision has already succeeded by the time this runs.
 *
 * GitHub team add and Discord role grant are independently gated — a track
 * can have `githubTeam` configured without `discordRoleId`, or vice versa.
 * Discord role grants additionally need the org's guild id (pass/config.yaml,
 * IDEA-040) and the contributor's own linked Discord account (discordId) —
 * missing either is treated as "nothing to grant", not an error, since a
 * contributor who hasn't linked Discord at all was never going to get a
 * role there regardless of who approved them.
 */
export async function grantTrackAccess(contributor: Contributor, track: Track): Promise<void> {
  try {
    const config = await getAppConfig()

    if (track.githubTeam && config?.githubOrganization) {
      await addToGitHubTeam(contributor.githubLogin, config.githubOrganization, track.githubTeam)
      await markGithubTeamAdded(track.id, contributor.githubId)
    }

    if (track.discordRoleId && contributor.discordId && config?.discordGuildId) {
      await grantDiscordRole(contributor.discordId, config.discordGuildId, track.discordRoleId)
      await markDiscordRoleAdded(track.id, contributor.githubId)
    }
  } catch (error) {
    console.error(`grantTrackAccess(${contributor.githubId}, ${track.slug}) failed:`, error)
  }
}
