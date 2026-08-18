import { getAppConfig } from '@/lib/app-config'
import {
  markDiscordInvited,
  markGithubContributorsTeamAdded,
  markGithubOrgInvited,
  type Contributor,
} from '@/lib/contributors'
import { sendDiscordInviteEmail } from '@/lib/email'
import { addToGitHubTeam, inviteToGitHubOrg } from '@/lib/github-org'

/**
 * IDEA-041 — called from admin/actions.ts's setContributorStatusAction
 * right after a contributor is confirmed. Best-effort and never throws:
 * Confirm itself has already succeeded by the time this runs, and neither
 * a missing config, a missing credential, nor a failed GitHub/email call
 * should read as if Confirm failed.
 *
 * GitHub: a real org invite via the API (see github-org.ts) — the
 * contributor still has to accept it themselves, same as any GitHub org
 * invite. IDEA-053 — also adds them to a configurable default
 * "Contributors" team, independent of the org invite's own outcome (same
 * "attempt regardless, stamp on attempt" discipline as the org invite
 * itself — GitHub's team-membership endpoint works even against a
 * still-pending invitee, not only a full member). Discord: there's no API
 * that silently adds someone to a guild (see providers/discord.ts's module
 * doc — this app only ever requested the `identify` scope and never
 * persisted an access token for any provider), so this sends an email
 * containing cf-internal's configured invite link instead — "automatically
 * invited," not "automatically joined."
 *
 * Each of the three is independently gated on its own config value being
 * present (`githubOrganization`/`githubContributorsTeam`/`discordInviteUrl`
 * from pass/config.yaml) — a deploy can have any subset configured. The
 * timestamp is stamped whenever that config-level precondition is met,
 * regardless of whether GITHUB_ORG_TOKEN is actually set — the underlying
 * github-org.ts calls no-op and log when the token is missing, so nothing
 * unsafe happens, but the Admin list's Re-invite button won't appear until
 * the org name itself is configured at all.
 */
export async function inviteConfirmedContributor(contributor: Contributor): Promise<void> {
  try {
    const config = await getAppConfig()
    if (!config) return

    if (config.githubOrganization) {
      await inviteToGitHubOrg(contributor.githubLogin, config.githubOrganization)
      await markGithubOrgInvited(contributor.githubId)

      if (config.githubContributorsTeam) {
        await addToGitHubTeam(contributor.githubLogin, config.githubOrganization, config.githubContributorsTeam)
        await markGithubContributorsTeamAdded(contributor.githubId)
      }
    }

    if (config.discordInviteUrl && contributor.email) {
      await sendDiscordInviteEmail(contributor.email, config.discordInviteUrl)
      await markDiscordInvited(contributor.githubId)
    }
  } catch (error) {
    console.error(`inviteConfirmedContributor(${contributor.githubId}) failed:`, error)
  }
}
