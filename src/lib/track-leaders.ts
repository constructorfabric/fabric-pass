import { pool } from '@/lib/db'
import type { ContributorStatus } from '@/lib/contributors'
import { TRACK_LEADER_ROLES, type TrackLeaderRole } from '@/lib/track-leader-roles'

/** IDEA-149 — one appointed leader of one track, enriched with the
 * contributor details the Track Leaders page's tile shows. */
export interface AppointedLeader {
  githubId: string
  githubLogin: string
  name?: string
  role: TrackLeaderRole
  /** A public profile only ever resolves for a `confirmed` contributor
   * (getPublicProfile's own gate) — the page links out only then, the same
   * convention the Track Members screen's `profileHash` follows. */
  contributorStatus: ContributorStatus
  profileHash: string
}

interface AppointedLeaderRow {
  track_id: string
  role: TrackLeaderRole
  github_id: string
  github_login: string
  name: string | null
  contributor_status: ContributorStatus
  profile_hash: string
}

/**
 * IDEA-149 — every appointed leader across the given tracks in one query,
 * grouped by track id and enriched with the tile's contributor details. A
 * track absent from the map (or mapped to an empty list) has no leaders —
 * exactly the state the Track Leaders page's red warning is about.
 *
 * `JOIN contributors`, not LEFT JOIN: track_leaders is only ever written by
 * syncTracks with an already-resolved contributor id (FK), so an unresolvable
 * row here would mean a contributor deleted out from under a track since the
 * last sync — same "silently skip rather than crash the page" stance
 * resolveLeaders takes on the track page (which per-row findByGithubId calls
 * achieve the same effect there).
 */
export async function appointedLeadersByTrackId(trackIds: string[]): Promise<Map<string, AppointedLeader[]>> {
  // Every requested track starts with an empty list, not a missing entry —
  // a leaderless track then reads uniformly as `get(id) === []`, which is
  // exactly the distinction the page's warning hinges on.
  const byTrack = new Map<string, AppointedLeader[]>(trackIds.map((trackId) => [trackId, []]))
  if (trackIds.length === 0) return byTrack

  const { rows } = await pool.query<AppointedLeaderRow>(
    `SELECT tl.track_id, tl.role, tl.github_id::text AS github_id, c.github_login, c.name,
            c.status AS contributor_status, md5(c.id::text) AS profile_hash
       FROM track_leaders tl
       JOIN contributors c ON c.github_id = tl.github_id
      WHERE tl.track_id = ANY($1)
      ORDER BY c.github_login`,
    [trackIds],
  )
  for (const row of rows) {
    const leaders = byTrack.get(row.track_id) ?? []
    leaders.push({
      githubId: row.github_id,
      githubLogin: row.github_login,
      name: row.name ?? undefined,
      role: row.role,
      contributorStatus: row.contributor_status,
      profileHash: row.profile_hash,
    })
    byTrack.set(row.track_id, leaders)
  }
  // TRACK_LEADER_ROLES' own order (Product Manager, Architect, …), not the
  // alphabetical order its text values would sort to — the same order the
  // roles are declared and read everywhere else.
  for (const leaders of byTrack.values()) {
    leaders.sort((a, b) => TRACK_LEADER_ROLES.indexOf(a.role) - TRACK_LEADER_ROLES.indexOf(b.role))
  }
  return byTrack
}
