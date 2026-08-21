import { getAppConfig } from '@/lib/app-config'
import type { Contributor } from '@/lib/contributors'
import { grantDiscordRole, revokeDiscordRole } from '@/lib/discord-role'
import { addToGitHubTeam, ensureGitHubTeam, removeFromGitHubTeam } from '@/lib/github-org'
import { inviteConfirmedContributor } from '@/lib/invites'
import { markDiscordRoleAdded, markGithubTeamAdded } from '@/lib/track-members'
import type { Track } from '@/lib/tracks'

/** IDEA-060 — a track's GitHub team slug isn't stored per track; it's this
 * pattern (app_config's githubTrackTeamPattern, e.g. `"{track}-contributors"`)
 * with `{track}` replaced by the track's own slug. Keeps every track's team
 * on one convention instead of hand-typing each one into pass/tracks.yaml.
 * IDEA-063 — same replacement, a different pattern
 * (githubTrackMaintainerTeamPattern) names the track's *maintainer* team. */
function trackGithubTeamSlug(pattern: string, track: Track): string {
  return pattern.replaceAll('{track}', track.slug)
}

/**
 * IDEA-042/060 — called from tracks/admin/actions.ts's decideJoinRequestAction
 * right after a join request is approved. Same best-effort, never-throw
 * discipline as lib/invites.ts's inviteConfirmedContributor: the
 * membership decision has already succeeded by the time this runs.
 *
 * GitHub team add and Discord role grant are independently gated — a track
 * can have a computable GitHub team without a `discordRoleId`, or vice
 * versa. The GitHub half additionally needs `githubOrganization` and
 * `githubTrackTeamPattern` both configured (no pattern, nothing to name the
 * team). Discord role grants need the org's guild id (pass/config.yaml,
 * IDEA-040) and the contributor's own linked Discord account (discordId) —
 * missing either is treated as "nothing to grant", not an error, since a
 * contributor who hasn't linked Discord at all was never going to get a
 * role there regardless of who approved them.
 */
export async function grantTrackAccess(contributor: Contributor, track: Track): Promise<void> {
  try {
    const config = await getAppConfig()

    if (config?.githubOrganization && config.githubTrackTeamPattern) {
      // Team membership requires org membership first. A contributor can be
      // approved onto a track before an Admin has ever confirmed them
      // org-wide — nothing about the join-request flow requires that
      // ordering — so this invites them (and adds them to the org-wide
      // default contributors team) the same way Confirm already does,
      // rather than letting the team grant below fail against someone
      // GitHub doesn't recognize as a member or pending invitee at all.
      if (!contributor.githubOrgInvitedAt) {
        await inviteConfirmedContributor(contributor)
      }

      const teamSlug = trackGithubTeamSlug(config.githubTrackTeamPattern, track)
      const teamReady = await ensureGitHubTeam(config.githubOrganization, teamSlug)
      if (teamReady) {
        await addToGitHubTeam(contributor.githubLogin, config.githubOrganization, teamSlug)
        await markGithubTeamAdded(track.id, contributor.githubId)
      }
    }

    if (track.discordRoleId && contributor.discordId && config?.discordGuildId) {
      await grantDiscordRole(contributor.discordId, config.discordGuildId, track.discordRoleId)
      await markDiscordRoleAdded(track.id, contributor.githubId)
    }
  } catch (error) {
    console.error(`grantTrackAccess(${contributor.githubId}, ${track.slug}) failed:`, error)
  }
}

/**
 * IDEA-062/063 — called from tracks/admin/actions.ts's removeFromTrackAction
 * right after a Track Admin removes a previously-approved member. The
 * mirror of grantTrackAccess above: same independent gating per channel,
 * same never-throw discipline. Unlike granting, there's no "ensure the team
 * exists" step — nothing to remove them from if it doesn't, and
 * removeFromGitHubTeam already treats a 404 as success. Revokes *both* the
 * track's `-contributors` team and its `-maintainers` team — a full Remove
 * undoes everything the track ever granted, regardless of which role the
 * member held; removeTrackMember has already reset their role to
 * 'contributor' in the DB by the time this runs, but the GitHub side needs
 * its own explicit revoke since a former Maintainer's `-maintainers`
 * membership doesn't disappear on its own.
 */
export async function revokeTrackAccess(contributor: Contributor, track: Track): Promise<void> {
  try {
    const config = await getAppConfig()

    if (config?.githubOrganization && config.githubTrackTeamPattern) {
      const teamSlug = trackGithubTeamSlug(config.githubTrackTeamPattern, track)
      await removeFromGitHubTeam(contributor.githubLogin, config.githubOrganization, teamSlug)
    }

    if (config?.githubOrganization && config.githubTrackMaintainerTeamPattern) {
      const maintainerTeamSlug = trackGithubTeamSlug(config.githubTrackMaintainerTeamPattern, track)
      await removeFromGitHubTeam(contributor.githubLogin, config.githubOrganization, maintainerTeamSlug)
    }

    if (track.discordRoleId && contributor.discordId && config?.discordGuildId) {
      await revokeDiscordRole(contributor.discordId, config.discordGuildId, track.discordRoleId)
    }
  } catch (error) {
    console.error(`revokeTrackAccess(${contributor.githubId}, ${track.slug}) failed:`, error)
  }
}

/**
 * IDEA-063 — called from tracks/admin/actions.ts's promoteToMaintainerAction
 * right after a Track Admin promotes an already-approved Contributor.
 * Additive: grants the `-maintainers` team without touching the
 * `-contributors` one — Maintainer is "Contributor plus more access," not a
 * replacement, so a promoted member keeps both memberships. No
 * invite-to-org step here (unlike grantTrackAccess) — only an already-
 * approved member can be promoted, and they were already invited (or the
 * invite was already attempted) when they were first approved.
 */
export async function promoteToMaintainer(contributor: Contributor, track: Track): Promise<void> {
  try {
    const config = await getAppConfig()
    if (!config?.githubOrganization || !config.githubTrackMaintainerTeamPattern) return

    const teamSlug = trackGithubTeamSlug(config.githubTrackMaintainerTeamPattern, track)
    const teamReady = await ensureGitHubTeam(config.githubOrganization, teamSlug)
    if (teamReady) {
      await addToGitHubTeam(contributor.githubLogin, config.githubOrganization, teamSlug)
    }
  } catch (error) {
    console.error(`promoteToMaintainer(${contributor.githubId}, ${track.slug}) failed:`, error)
  }
}

/**
 * IDEA-063 — the mirror of promoteToMaintainer above: removes the
 * `-maintainers` team membership only, leaving `-contributors` untouched —
 * a demoted Maintainer is still a Contributor, not removed from the track
 * entirely (see revokeTrackAccess/removeFromTrackAction for that).
 */
export async function demoteToContributor(contributor: Contributor, track: Track): Promise<void> {
  try {
    const config = await getAppConfig()
    if (!config?.githubOrganization || !config.githubTrackMaintainerTeamPattern) return

    const teamSlug = trackGithubTeamSlug(config.githubTrackMaintainerTeamPattern, track)
    await removeFromGitHubTeam(contributor.githubLogin, config.githubOrganization, teamSlug)
  } catch (error) {
    console.error(`demoteToContributor(${contributor.githubId}, ${track.slug}) failed:`, error)
  }
}
