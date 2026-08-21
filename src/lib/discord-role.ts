import { env } from '@/lib/env'

/**
 * IDEA-042 — grants a Discord role via
 * `PUT /guilds/{guild}/members/{user}/roles/{role}`. Requires the bot to
 * already be a member of the guild with `Manage Roles`, and its own role
 * positioned above every role it's asked to grant — a permission/hierarchy
 * problem on Discord's side, not something this call can detect ahead of
 * time.
 *
 * A 404 here almost always means the contributor hasn't accepted the
 * Discord server invite yet (Discord can't grant a role to someone who
 * isn't a guild member) — logged distinctly from other failures so an
 * operator scanning logs can tell "they haven't joined yet" from "the bot
 * token/permissions are broken", but treated the same as any other
 * failure by the caller: a soft no-op that the Re-add button naturally
 * covers once they have joined. Never throws — same best-effort discipline
 * as github-org.ts.
 */
export async function grantDiscordRole(discordUserId: string, guildId: string, roleId: string): Promise<boolean> {
  if (!env.DISCORD_BOT_TOKEN) {
    console.warn(`DISCORD_BOT_TOKEN not configured — would have granted role ${roleId} to ${discordUserId} in guild ${guildId}`)
    return false
  }

  try {
    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`, {
      method: 'PUT',
      headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
    })
    if (!response.ok) {
      if (response.status === 404) {
        console.warn(`grantDiscordRole(${discordUserId}, ${guildId}, ${roleId}): 404 — likely not a guild member yet`)
      } else {
        console.error(
          `grantDiscordRole(${discordUserId}, ${guildId}, ${roleId}) failed: Discord responded ${response.status} ${await response.text()}`,
        )
      }
      return false
    }
    return true
  } catch (error) {
    console.error(`grantDiscordRole(${discordUserId}, ${guildId}, ${roleId}) failed:`, error)
    return false
  }
}

/**
 * IDEA-062 — the mirror of grantDiscordRole above, via
 * `DELETE /guilds/{guild}/members/{user}/roles/{role}`. A 404 (already
 * doesn't have the role, or has left the guild entirely) is treated as
 * success — same "already in the desired end state" reasoning
 * grantDiscordRole's own 404 handling implies for the opposite direction.
 * Never throws — same best-effort discipline as grantDiscordRole.
 */
export async function revokeDiscordRole(discordUserId: string, guildId: string, roleId: string): Promise<boolean> {
  if (!env.DISCORD_BOT_TOKEN) {
    console.warn(`DISCORD_BOT_TOKEN not configured — would have revoked role ${roleId} from ${discordUserId} in guild ${guildId}`)
    return false
  }

  try {
    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
    })
    if (!response.ok && response.status !== 404) {
      console.error(
        `revokeDiscordRole(${discordUserId}, ${guildId}, ${roleId}) failed: Discord responded ${response.status} ${await response.text()}`,
      )
      return false
    }
    return true
  } catch (error) {
    console.error(`revokeDiscordRole(${discordUserId}, ${guildId}, ${roleId}) failed:`, error)
    return false
  }
}
