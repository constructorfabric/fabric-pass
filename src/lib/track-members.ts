import { pool } from '@/lib/db'

export const TRACK_MEMBER_STATUSES = ['pending', 'approved', 'rejected', 'removed'] as const
export type TrackMemberStatus = (typeof TRACK_MEMBER_STATUSES)[number]

/** IDEA-063 — every member's standing on a track, independent of `status`
 * above. Only meaningful once `status = 'approved'` — same "not enforced in
 * SQL, guarded in application code" shape as tracks.ts's
 * MAX_LEADERS_PER_ROLE. Defaults to `contributor` for every row, including
 * ones from before this idea existed. */
export const TRACK_MEMBER_ROLES = ['contributor', 'maintainer'] as const
export type TrackMemberRole = (typeof TRACK_MEMBER_ROLES)[number]

export interface TrackMember {
  trackId: string
  githubId: string
  githubLogin: string
  name?: string
  status: TrackMemberStatus
  role: TrackMemberRole
  requestedAt: Date
  decidedAt?: Date
  decidedByGithubId?: string
  /** IDEA-042 — last time this app attempted to add this member to the
   * track's GitHub team / grant its Discord role, stamped on attempt (see
   * lib/team-access.ts's grantTrackAccess, the only writer). `undefined`
   * means never attempted — either never approved, or the track has
   * neither `github_team` nor `discord_role_id` configured. */
  githubTeamAddedAt?: Date
  discordRoleAddedAt?: Date
}

interface TrackMemberRow {
  track_id: string
  github_id: string
  github_login: string
  name: string | null
  status: TrackMemberStatus
  role: TrackMemberRole
  requested_at: Date
  decided_at: Date | null
  decided_by_github_id: string | null
  github_team_added_at: Date | null
  discord_role_added_at: Date | null
}

function toTrackMember(row: TrackMemberRow): TrackMember {
  return {
    trackId: row.track_id,
    githubId: row.github_id,
    githubLogin: row.github_login,
    name: row.name ?? undefined,
    status: row.status,
    role: row.role,
    requestedAt: row.requested_at,
    decidedAt: row.decided_at ?? undefined,
    decidedByGithubId: row.decided_by_github_id ?? undefined,
    githubTeamAddedAt: row.github_team_added_at ?? undefined,
    discordRoleAddedAt: row.discord_role_added_at ?? undefined,
  }
}

const SELECT_WITH_CONTRIBUTOR = `
  SELECT tm.track_id, tm.github_id, c.github_login, c.name, tm.status, tm.role, tm.requested_at, tm.decided_at,
         tm.decided_by_github_id, tm.github_team_added_at, tm.discord_role_added_at
    FROM track_members tm
    JOIN contributors c ON c.github_id = tm.github_id
`

/** IDEA-014's member list + pending-request review, one track at a time —
 * every row regardless of status; the page groups pending vs. approved
 * itself. A track's own admin page calls this once per track it administers
 * (see roles.ts's adminTrackIds), not a single cross-track query, since
 * there's no "every track" caller today (an Admin acting across tracks
 * still does it one track at a time — see admin/track-actions.ts). */
export async function listTrackMembership(trackId: string): Promise<TrackMember[]> {
  const { rows } = await pool.query<TrackMemberRow>(`${SELECT_WITH_CONTRIBUTOR} WHERE tm.track_id = $1 ORDER BY tm.requested_at`, [
    trackId,
  ])
  return rows.map(toTrackMember)
}

/** IDEA-013/019 — the requester's own view of their one row on a track, if
 * any. `null` means never requested (not the same as 'rejected'). */
export async function getMyMembership(trackId: string, githubId: string): Promise<TrackMember | null> {
  const { rows } = await pool.query<TrackMemberRow>(`${SELECT_WITH_CONTRIBUTOR} WHERE tm.track_id = $1 AND tm.github_id = $2`, [
    trackId,
    githubId,
  ])
  return rows[0] ? toTrackMember(rows[0]) : null
}

/**
 * IDEA-013 — inserts a fresh 'pending' row, or resets an existing 'rejected'
 * or 'removed' (IDEA-062) one back to 'pending' (a contributor can ask
 * again after being turned down, or after being removed following an
 * earlier approval). Deliberately a no-op, not an error, for an
 * already-'pending' or already-'approved' row — the "Request to join"
 * button simply shouldn't be clickable in either state (see
 * tracks/[slug]/page.tsx), so reaching here with one of those already true
 * is a stale click, not a real re-request.
 */
export async function requestToJoinTrack(trackId: string, githubId: string): Promise<void> {
  await pool.query(
    `INSERT INTO track_members (track_id, github_id, status, requested_at)
     VALUES ($1, $2, 'pending', now())
     ON CONFLICT (track_id, github_id) DO UPDATE
       SET status = 'pending', requested_at = now(), decided_at = NULL, decided_by_github_id = NULL
       WHERE track_members.status IN ('rejected', 'removed')`,
    [trackId, githubId],
  )
}

/** IDEA-015's onboarding checklist — "did I join a track" isn't scoped to
 * one particular track the way getMyMembership is, so this checks across
 * every track at once. 'approved' wins if the contributor has landed on
 * even one track, regardless of pending/rejected rows elsewhere; otherwise
 * 'pending' if any request is still awaiting review; a rejected-only
 * history (or no requests at all) reads as 'none' — the checklist step
 * isn't "done," but nothing stops trying again on some other track. */
export async function anyMembershipSummary(githubId: string): Promise<'none' | 'pending' | 'approved'> {
  const { rows } = await pool.query<{ status: TrackMemberStatus }>('SELECT status FROM track_members WHERE github_id = $1', [
    githubId,
  ])
  if (rows.some((row) => row.status === 'approved')) return 'approved'
  if (rows.some((row) => row.status === 'pending')) return 'pending'
  return 'none'
}

export class NotPendingError extends Error {}

/**
 * IDEA-014's Accept/Reject. Only a currently-'pending' row can be decided —
 * re-deciding an already-approved/rejected row (a stale page, a double
 * click) throws rather than silently overwriting `decided_at`/`decided_by`,
 * so the audit trail (IDEA-022) reflects the first real decision, not the
 * last click.
 */
export async function decideJoinRequest(
  trackId: string,
  githubId: string,
  decision: 'approved' | 'rejected',
  decidedByGithubId: string,
): Promise<void> {
  const result = await pool.query(
    `UPDATE track_members
        SET status = $3, decided_at = now(), decided_by_github_id = $4
      WHERE track_id = $1 AND github_id = $2 AND status = 'pending'`,
    [trackId, githubId, decision, decidedByGithubId],
  )
  if (result.rowCount === 0) throw new NotPendingError(`${trackId}/${githubId}`)
}

export class NotApprovedError extends Error {}

/**
 * IDEA-062's Remove — the mirror of decideJoinRequest above, undoing an
 * approval instead of making one. Only a currently-'approved' row can be
 * removed, for the same "don't silently overwrite the audit trail on a
 * stale double click" reason decideJoinRequest already guards against.
 * `status` becomes 'removed', not 'rejected' — a removed member's history
 * shows they *were* approved and later removed, not that they were
 * declined at the door (see ideas.md's IDEA-062 for why this is a fourth
 * status rather than reusing 'rejected' or deleting the row). Also resets
 * `role` back to 'contributor' (IDEA-063) — a later re-approval starts
 * from the default role and needs a Track Admin's own deliberate promotion
 * again, rather than silently carrying over a Maintainer standing nobody
 * actively re-granted.
 */
export async function removeTrackMember(trackId: string, githubId: string, decidedByGithubId: string): Promise<void> {
  const result = await pool.query(
    `UPDATE track_members
        SET status = 'removed', role = 'contributor', decided_at = now(), decided_by_github_id = $3
      WHERE track_id = $1 AND github_id = $2 AND status = 'approved'`,
    [trackId, githubId, decidedByGithubId],
  )
  if (result.rowCount === 0) throw new NotApprovedError(`${trackId}/${githubId}`)
}

/**
 * IDEA-063's Promote/Demote. Only a currently-'approved' row can have its
 * role changed — same "role is only meaningful once approved" reasoning as
 * the migration's own doc comment; a pending or removed row has no role to
 * change. Idempotent by design — setting an already-current role is a
 * harmless no-op, not an error, so a double-click never throws (unlike
 * decideJoinRequest/removeTrackMember, this doesn't guard against
 * "already in this state").
 */
export async function setTrackMemberRole(trackId: string, githubId: string, role: TrackMemberRole): Promise<void> {
  const result = await pool.query(
    `UPDATE track_members SET role = $3 WHERE track_id = $1 AND github_id = $2 AND status = 'approved'`,
    [trackId, githubId, role],
  )
  if (result.rowCount === 0) throw new NotApprovedError(`${trackId}/${githubId}`)
}

/** IDEA-042 — stamped on attempt (see lib/team-access.ts's grantTrackAccess,
 * the only caller), backing IDEA-014's member-list Re-add cooldown. */
export async function markGithubTeamAdded(trackId: string, githubId: string): Promise<void> {
  await pool.query('UPDATE track_members SET github_team_added_at = now() WHERE track_id = $1 AND github_id = $2', [
    trackId,
    githubId,
  ])
}

export async function markDiscordRoleAdded(trackId: string, githubId: string): Promise<void> {
  await pool.query('UPDATE track_members SET discord_role_added_at = now() WHERE track_id = $1 AND github_id = $2', [
    trackId,
    githubId,
  ])
}
