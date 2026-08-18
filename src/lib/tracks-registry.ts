import { parse } from 'yaml'
import { z } from 'zod'
import { TRACK_LEADER_ROLES, type TrackLeaderSync, type TrackSync } from '@/lib/tracks'

const repositorySchema = z.object({
  url: z.string().min(1),
  description: z.string().min(1).optional(),
  issue_tracker: z.string().min(1).optional(),
})

// GitHub logins, not github_ids — logins are what a human hand-editing this
// file actually knows and can eyeball-verify, unlike an opaque numeric id.
// syncTracks resolves each one to the matching contributor's github_id at
// sync time (a login isn't stable enough to store as the real key — GitHub
// accounts can rename — so github_id stays the identity everywhere else in
// this app; only this file's human-facing format changes).
//
// IDEA-055 — a list, not a single nullable login: up to MAX_LEADERS_PER_ROLE
// people can hold the same role (the cap itself is enforced later, in
// tracks.ts's syncTracks, which has a database connection to report a
// rejection against — this function only shapes what the file says).
const leaderLogins = z.array(z.string().min(1)).default([])

const trackRowSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  repositories: z.array(repositorySchema).default([]),
  leaders: z
    .object({
      product_manager: leaderLogins,
      architect: leaderLogins,
      developer: leaderLogins,
      quality: leaderLogins,
      researcher: leaderLogins,
    })
    .default({ product_manager: [], architect: [], developer: [], quality: [], researcher: [] }),
  admins: z.array(z.string().min(1)).default([]),
  // IDEA-042 — optional. github_team is a team slug (not a numeric id, same
  // human-eyeball-verifiable reasoning as leader/admin logins above);
  // discord_role_id is Discord's own numeric snowflake, since a role has
  // no stable human-facing name the way a GitHub team slug does.
  github_team: z.string().min(1).optional(),
  discord_role_id: z.string().min(1).optional(),
})

const registryFileSchema = z.object({
  tracks: z.array(z.unknown()).default([]),
})

/**
 * pass/tracks.yaml -> TrackSync[]. A row failing validation (missing slug
 * or name) is dropped, not thrown on — same reasoning as
 * contributors-registry.ts's parseRegistryYaml: one malformed hand-edit
 * shouldn't block every other track from syncing. Login -> github_id
 * resolution happens later, in tracks.ts's syncTracks — this function has
 * no database connection to validate against.
 */
export function parseTracksYaml(content: string): { tracks: TrackSync[]; invalidRowCount: number } {
  const parsed = registryFileSchema.parse(parse(content) ?? {})
  const tracks: TrackSync[] = []
  let invalidRowCount = 0

  for (const raw of parsed.tracks) {
    const row = trackRowSchema.safeParse(raw)
    if (!row.success) {
      invalidRowCount += 1
      continue
    }
    const leaders: TrackLeaderSync[] = TRACK_LEADER_ROLES.flatMap((role) =>
      row.data.leaders[role].map((githubLogin) => ({ role, githubLogin })),
    )
    tracks.push({
      slug: row.data.slug,
      name: row.data.name,
      description: row.data.description,
      repositories: row.data.repositories.map((repo) => ({
        url: repo.url,
        description: repo.description,
        issueTracker: repo.issue_tracker,
      })),
      leaders,
      adminGithubLogins: row.data.admins,
      githubTeam: row.data.github_team,
      discordRoleId: row.data.discord_role_id,
    })
  }

  return { tracks, invalidRowCount }
}
