import { pool } from '@/lib/db'
import type { ContributorStatus } from '@/lib/contributors'
import { TRACK_LEADER_ROLES, type TrackLeaderRole } from '@/lib/track-leader-roles'
import { MAX_LEADERS_PER_ROLE } from '@/lib/tracks'

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

/** IDEA-150 — the chosen profile already holds MAX_LEADERS_PER_ROLE leaders
 * besides the person being appointed (same app-level cap syncTracks
 * enforces on the pass/tracks.yaml side). */
export class RoleFullError extends Error {}

/**
 * IDEA-150 — the first in-app writer of `track_leaders` (until now only
 * the tracks.yaml sync ever touched it). Appointing one person to one
 * profile: an INSERT of (track, role, person), plus the IDEA-118
 * derivation maintained incrementally — every leader is a track admin, so
 * the admin row lands in the same write rather than waiting for the next
 * sync to derive it. `ON CONFLICT DO NOTHING` keeps a double-click (or
 * approving a candidate who already holds the profile) idempotent rather
 * than throwing on the (track, role, github_id) primary key.
 *
 * The caller owns the two consequences this write makes true: clearing the
 * candidate's nominations (leader-nominations.ts's clearNominations) and
 * re-running ensureTrackAdminsAreGovernanceContributors (IDEA-116/147/148
 * — a fresh track admin is owed a Governance seat; see the actions file).
 */
export async function appointTrackLeader(trackId: string, githubId: string, role: TrackLeaderRole): Promise<void> {
  const { rows } = await pool.query('SELECT 1 FROM track_leaders WHERE track_id = $1 AND role = $2 AND github_id != $3', [
    trackId,
    role,
    githubId,
  ])
  if (rows.length >= MAX_LEADERS_PER_ROLE) throw new RoleFullError(`${trackId}/${role}`)

  await pool.query('INSERT INTO track_leaders (track_id, role, github_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [
    trackId,
    role,
    githubId,
  ])
  await pool.query('INSERT INTO track_admins (track_id, github_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
    trackId,
    githubId,
  ])
}

/**
 * IDEA-150 — changes which profile one leader tile represents: the
 * (track, person, fromRole) row becomes (track, person, toRole). If the
 * person already holds the target profile too, the old row is simply
 * deleted instead — two rows naming the same person-profile pair twice is
 * the same typo syncTracks dedupes on the file side, not a state to keep.
 * Still a leader either way, so track_admins needs no change. Same
 * MAX_LEADERS_PER_ROLE cap as appointTrackLeader, checked against the
 * target profile.
 */
export async function setTrackLeaderRole(
  trackId: string,
  githubId: string,
  fromRole: TrackLeaderRole,
  toRole: TrackLeaderRole,
): Promise<void> {
  if (fromRole === toRole) return

  const alreadyHolds = await pool.query('SELECT 1 FROM track_leaders WHERE track_id = $1 AND github_id = $2 AND role = $3', [
    trackId,
    githubId,
    toRole,
  ])
  if (alreadyHolds.rows.length > 0) {
    await pool.query('DELETE FROM track_leaders WHERE track_id = $1 AND github_id = $2 AND role = $3', [
      trackId,
      githubId,
      fromRole,
    ])
    return
  }

  const { rows } = await pool.query('SELECT 1 FROM track_leaders WHERE track_id = $1 AND role = $2 AND github_id != $3', [
    trackId,
    toRole,
    githubId,
  ])
  if (rows.length >= MAX_LEADERS_PER_ROLE) throw new RoleFullError(`${trackId}/${toRole}`)

  await pool.query('UPDATE track_leaders SET role = $4 WHERE track_id = $1 AND github_id = $2 AND role = $3', [
    trackId,
    githubId,
    fromRole,
    toRole,
  ])
}

/**
 * IDEA-150's "Demote to Maintainer" — the in-app mirror of appointment.
 * Every leadership row for this person on this track goes (all profiles at
 * once — demotion is about the person, not one tile), and with it the admin
 * row: per IDEA-118 the two sets are the same fact, and someone leading
 * nothing here admins nothing here. The person lands on a Maintainer
 * membership of the track, exactly what the button's label promises:
 * upserted to ('approved', 'maintainer') whatever their membership row said
 * before — including the no-row case of a config-assigned leader who never
 * actually requested to join. `decidedByGithubId` is the demoting Admin,
 * the same audit-trail column every other decision write stamps.
 *
 * The caller again owns the consequences: the Governance auto-revoke for a
 * now-ex-admin (ensureTrackAdminsAreGovernanceContributors) and, with
 * IDEA-151, the external access changes.
 */
export async function demoteTrackLeader(trackId: string, githubId: string, decidedByGithubId: string): Promise<void> {
  await pool.query('DELETE FROM track_leaders WHERE track_id = $1 AND github_id = $2', [trackId, githubId])
  await pool.query('DELETE FROM track_admins WHERE track_id = $1 AND github_id = $2', [trackId, githubId])

  await pool.query(
    `INSERT INTO track_members (track_id, github_id, status, role, decided_at, decided_by_github_id)
     VALUES ($1, $2, 'approved', 'maintainer', now(), $3)
     ON CONFLICT (track_id, github_id) DO UPDATE
       SET status = 'approved', role = 'maintainer', decided_at = now(), decided_by_github_id = $3`,
    [trackId, githubId, decidedByGithubId],
  )
}
