import { pool } from '@/lib/db'
import type { ContributorStatus } from '@/lib/contributors'
import type { ProfileCompleteness } from '@/lib/profile-completeness'
import { adminTrackIds } from '@/lib/roles'

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
  /** IDEA-048 — for the Track Admin review screen's requestor details. */
  company?: string
  /** IDEA-081/082 — the same set of contact fields the Admin table shows,
   * unified across both cards. `telegramUsername`/`telegramPhone` mirror
   * `public-profile-view.tsx`'s own username-first, phone-fallback display
   * rule (see contributors.ts's Contributor for why LinkedIn has only a
   * name, no username). */
  email?: string
  discordUsername?: string
  telegramUsername?: string
  telegramPhone?: string
  linkedinName?: string
  /** IDEA-048/067 — the contributor's own org-wide standing (Stranger vs.
   * Contributor, IDEA-067) and profile-readiness, independent of this row's
   * own `status` (approval state on *this* track). `profileHash` is always
   * `md5(id::text)`, the same value `getPublicProfile`/`searchContributors`
   * compute — a public profile only ever resolves for a `confirmed`
   * contributor, so the review screen only links out when `contributorStatus
   * === 'confirmed'`. */
  contributorStatus: ContributorStatus
  profileCompleteness: ProfileCompleteness
  profileHash: string
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
  company: string | null
  email: string | null
  discord_username: string | null
  telegram_username: string | null
  telegram_phone: string | null
  linkedin_name: string | null
  contributor_status: ContributorStatus
  profile_completeness: ProfileCompleteness
  profile_hash: string
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
    company: row.company ?? undefined,
    email: row.email ?? undefined,
    discordUsername: row.discord_username ?? undefined,
    telegramUsername: row.telegram_username ?? undefined,
    telegramPhone: row.telegram_phone ?? undefined,
    linkedinName: row.linkedin_name ?? undefined,
    contributorStatus: row.contributor_status,
    profileCompleteness: row.profile_completeness,
    profileHash: row.profile_hash,
  }
}

const SELECT_WITH_CONTRIBUTOR = `
  SELECT tm.track_id, tm.github_id, c.github_login, c.name, tm.status, tm.role, tm.requested_at, tm.decided_at,
         tm.decided_by_github_id, tm.github_team_added_at, tm.discord_role_added_at,
         c.company, c.email, c.discord_username, c.telegram_username, c.telegram_phone, c.linkedin_name,
         c.status AS contributor_status, c.profile_completeness, md5(c.id::text) AS profile_hash
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

export interface ApprovedTrackMembership {
  trackId: string
  trackSlug: string
  trackName: string
  role: TrackMemberRole
}

/** IDEA-064 — every track a contributor is currently `'approved'` in, for
 * highestTrackRank below. Unlike anyMembershipSummary above (a single
 * approved/pending/none summary across every track), this returns one row
 * per approved track since a contributor can participate in more than one at
 * once, each possibly at a different role. */
export async function listApprovedTrackMemberships(githubId: string): Promise<ApprovedTrackMembership[]> {
  const { rows } = await pool.query<{ track_id: string; slug: string; name: string; role: TrackMemberRole }>(
    `SELECT t.id AS track_id, t.slug, t.name, tm.role
       FROM track_members tm
       JOIN tracks t ON t.id = tm.track_id
      WHERE tm.github_id = $1 AND tm.status = 'approved'
      ORDER BY t.name`,
    [githubId],
  )
  return rows.map((row) => ({ trackId: row.track_id, trackSlug: row.slug, trackName: row.name, role: row.role }))
}

export interface TrackParticipation {
  trackId: string
  trackSlug: string
  trackName: string
  role: TrackMemberRole
  isTrackAdmin: boolean
}

/**
 * IDEA-064's track-participation labels — every track a contributor
 * participates in at all: an approved `track_members` row (any role), or
 * being that track's Admin. The two are independent — `track_admins` is
 * populated by tracks.ts's own config sync, not by the join-request flow, so
 * a Track Admin (e.g. a track leader assigned admin straight from
 * pass/tracks.yaml) commonly has no approved membership row of their own.
 * Without this union, that Admin would show no label at all on their
 * profile, missing the crown the idea explicitly asked for. A track where
 * both are true appears once, with `isTrackAdmin: true` — the label always
 * shows the crown over the membership role in that case (see
 * app/track-labels.tsx), so `role` on an admin-only row (no membership) is
 * just the unused default.
 *
 * IDEA-074 — ordered by app_config's preferred_track_order, same
 * LEFT JOIN + array_position + COALESCE shape as tracks.ts's listTracks
 * (see that function's own doc comment for why LEFT JOIN specifically).
 */
export async function listTrackParticipation(githubId: string): Promise<TrackParticipation[]> {
  const { rows } = await pool.query<{ track_id: string; slug: string; name: string; role: TrackMemberRole | null; is_track_admin: boolean }>(
    `SELECT t.id AS track_id, t.slug, t.name, tm.role,
            ta.github_id IS NOT NULL AS is_track_admin
       FROM tracks t
       LEFT JOIN track_members tm ON tm.track_id = t.id AND tm.github_id = $1 AND tm.status = 'approved'
       LEFT JOIN track_admins ta ON ta.track_id = t.id AND ta.github_id = $1
       LEFT JOIN app_config ac ON ac.id = true
      WHERE tm.github_id IS NOT NULL OR ta.github_id IS NOT NULL
      ORDER BY COALESCE(array_position(ac.preferred_track_order, t.name), 2147483647), t.name`,
    [githubId],
  )
  return rows.map((row) => ({
    trackId: row.track_id,
    trackSlug: row.slug,
    trackName: row.name,
    role: row.role ?? 'contributor',
    isTrackAdmin: row.is_track_admin,
  }))
}

/** IDEA-064's avatar rank badge — the single highest rank a contributor
 * holds across every track, for the one spot (user-menu.tsx's account-menu
 * trigger) that shows a badge per-contributor rather than per-track. Track
 * Admin (crown) beats Maintainer (triple-star) beats Contributor (star) on
 * any track; `null` means no track participation at all. */
export async function highestTrackRank(githubId: string): Promise<'admin' | 'maintainer' | 'contributor' | null> {
  const adminOf = await adminTrackIds(githubId)
  if (adminOf.length > 0) return 'admin'
  const memberships = await listApprovedTrackMemberships(githubId)
  if (memberships.some((membership) => membership.role === 'maintainer')) return 'maintainer'
  if (memberships.length > 0) return 'contributor'
  return null
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

/**
 * IDEA-066's Track Admin mailing-list export — the track-scoped mirror of
 * contributors.ts's listConfirmedContributorEmails. Scoped to this track's
 * currently-`'approved'` members (any role a member might hold isn't tracked
 * here yet — every approved row counts), same double gate as the global
 * list: the contributor's own row must independently be `status =
 * 'confirmed'` with a confirmed email, since an approved track membership
 * doesn't itself guarantee either — an Admin can block a contributor after
 * they were already approved onto a track.
 */
export async function listConfirmedTrackMemberEmails(trackId: string): Promise<string[]> {
  const { rows } = await pool.query<{ email: string }>(
    `SELECT c.email
       FROM track_members tm
       JOIN contributors c ON c.github_id = tm.github_id
      WHERE tm.track_id = $1 AND tm.status = 'approved'
        AND c.status = 'confirmed' AND c.email_confirmed_at IS NOT NULL AND c.email IS NOT NULL
      ORDER BY c.email`,
    [trackId],
  )
  return rows.map((row) => row.email)
}
