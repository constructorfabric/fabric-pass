import { pool } from '@/lib/db'
import type { ProfileViewer } from '@/lib/contributors'

/** IDEA-018 — one person a nomination picker can offer: a confirmed
 * contributor who is an approved member of the track in any role
 * (contributor or maintainer). */
export interface NominatableMember {
  githubId: string
  githubLogin: string
  /** Display name for the picker — falls back to the login, same as the
   * People screen's own result rows. */
  name: string
}

/** IDEA-018 — the candidate isn't an approved member of the track, so
 * there's nothing to nominate them for. */
export class CandidateNotMemberError extends Error {}

const MIN_SEARCH_QUERY_LENGTH = 3

/**
 * IDEA-018 — the nomination picker's search: the People screen's
 * searchContributors, restricted to this track's approved members. Same
 * fields, same prefix-match-first ranking, same 5-result cap and
 * min-3-char floor — "searched the same way the People screen searches
 * contributors" is the idea's own wording. Returns identity (githubId,
 * login), not a profile hash: the picker nominates a person, it doesn't
 * link to their profile.
 *
 * IDEA-110's lock guard applies unchanged — a locked Telegram/LinkedIn
 * must not be *matchable* for anyone but an Admin or the handle's own
 * owner, exactly as in searchContributors; see that function's doc comment
 * for the reasoning.
 */
export async function searchNominatableMembers(
  trackId: string,
  query: string,
  viewer: ProfileViewer,
): Promise<NominatableMember[]> {
  const trimmed = query.trim()
  if (trimmed.length < MIN_SEARCH_QUERY_LENGTH) return []

  // Same fixed-fragment construction as searchContributors — only column
  // names and the literal own-row escape hatch reach the query string, the
  // search text always travels as a bind parameter.
  // Qualified with the contributors alias — unlike searchContributors'
  // single-table query, this one joins track_members, whose own github_id
  // would make the bare column name ambiguous.
  const lockGuard = (column: string) => (viewer.isAdmin ? '' : ` AND (NOT ${column} OR c.github_id = $4)`)
  const telegramContains = `telegram_username ILIKE $1${lockGuard('telegram_admins_only')}`
  const telegramStartsWith = `telegram_username ILIKE $2${lockGuard('telegram_admins_only')}`
  const linkedinContains = `linkedin_name ILIKE $1${lockGuard('linkedin_admins_only')}`
  const linkedinStartsWith = `linkedin_name ILIKE $2${lockGuard('linkedin_admins_only')}`

  const contains = `%${trimmed}%`
  const startsWith = `${trimmed}%`
  const { rows } = await pool.query<{ github_id: string; github_login: string; name: string | null }>(
    `SELECT tm.github_id::text AS github_id, c.github_login, c.name
       FROM track_members tm
       JOIN contributors c ON c.github_id = tm.github_id
      WHERE tm.track_id = $3
        AND tm.status = 'approved'
        AND c.status = 'confirmed'
        AND (c.name ILIKE $1 OR c.email ILIKE $1 OR c.github_login ILIKE $1 OR c.github_email ILIKE $1
             OR c.discord_username ILIKE $1 OR (${telegramContains}) OR (${linkedinContains}))
      ORDER BY
        CASE WHEN c.name ILIKE $2 OR c.email ILIKE $2 OR c.github_login ILIKE $2 OR c.github_email ILIKE $2
                  OR c.discord_username ILIKE $2 OR (${telegramStartsWith}) OR (${linkedinStartsWith})
             THEN 0 ELSE 1 END,
        COALESCE(c.name, c.github_login)
      LIMIT 5`,
    // $4 only exists in the query text when the lock guard is built in (a
    // non-Admin viewer) — same parameter-count reasoning as
    // searchContributors.
    viewer.isAdmin ? [contains, startsWith, trackId] : [contains, startsWith, trackId, viewer.githubId ?? null],
  )
  return rows.map((row) => ({ githubId: row.github_id, githubLogin: row.github_login, name: row.name ?? row.github_login }))
}

/**
 * IDEA-018 — records one (track, candidate, nominator) nomination.
 * Nominations accumulate: the same candidate nominated by several people
 * is several rows, the count IDEA-150's vote label reads. The same
 * nominator repeating themselves is a no-op (ON CONFLICT DO NOTHING on the
 * three-column primary key), not a vote counted twice — returning `false`
 * for that case so the action can say so rather than staying silent about
 * a click that did nothing.
 *
 * The candidate must be an approved member of the track (CandidateNotMemberError
 * otherwise) — the picker only ever offers members, but a server action is
 * reachable directly with any value, so the write re-derives the invariant
 * instead of trusting the client.
 */
export async function nominateTrackLeader(
  trackId: string,
  candidateGithubId: string,
  nominatorGithubId: string,
): Promise<boolean> {
  const member = await pool.query('SELECT 1 FROM track_members WHERE track_id = $1 AND github_id = $2 AND status = $3', [
    trackId,
    candidateGithubId,
    'approved',
  ])
  if (member.rows.length === 0) throw new CandidateNotMemberError()

  const { rowCount } = await pool.query(
    `INSERT INTO track_leader_nominations (track_id, candidate_github_id, nominator_github_id)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [trackId, candidateGithubId, nominatorGithubId],
  )
  return rowCount === 1
}
