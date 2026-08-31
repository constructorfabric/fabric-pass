import { pool } from '@/lib/db'

export interface TrackRepository {
  url: string
  description?: string
  issueTracker?: string
}

/** IDEA-010's five named roles, plus IDEA-118's `governance` — a
 * non-technical role for a track's own administrative/governance leader,
 * distinct from the five functional disciplines above it (any track can
 * use it, not just Governance's own). Kept as a fixed union rather than an
 * open-ended string — there are always exactly these six. */
export const TRACK_LEADER_ROLES = ['product_manager', 'architect', 'developer', 'quality', 'researcher', 'governance'] as const
export type TrackLeaderRole = (typeof TRACK_LEADER_ROLES)[number]

/** IDEA-055 — up to 3 people can hold the same role on the same track (a
 * merged track can inherit the same role from more than one source track).
 * An app-level cap, not a database constraint — see tracks.ts's syncTracks. */
export const MAX_LEADERS_PER_ROLE = 3

export interface TrackLeader {
  role: TrackLeaderRole
  githubId: string
}

export interface Track {
  id: string
  slug: string
  name: string
  description?: string
  repositories: TrackRepository[]
  leaders: TrackLeader[]
  /** IDEA-060 — a track's GitHub team is no longer a stored field: its slug
   * is computed from app_config's githubTrackTeamPattern + this track's own
   * slug, at grant time (see lib/team-access.ts). discordRoleId remains a
   * stored per-track field — a track with neither a computable GitHub team
   * pattern nor a discordRoleId never triggers a grant on join approval
   * (see tracks/admin/actions.ts's decideJoinRequestAction). */
  discordRoleId?: string
  createdAt: Date
  updatedAt: Date
}

interface TrackRow {
  id: string
  slug: string
  name: string
  description: string | null
  repositories: unknown
  discord_role_id: string | null
  created_at: Date
  updated_at: Date
}

interface TrackLeaderRow {
  track_id: string
  role: TrackLeaderRole
  github_id: string
}

function toTrack(row: TrackRow, leaders: TrackLeader[]): Track {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? undefined,
    // jsonb comes back already-parsed from `pg` — cast, not JSON.parse.
    repositories: (row.repositories as TrackRepository[] | null) ?? [],
    leaders,
    discordRoleId: row.discord_role_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function leadersByTrackId(trackIds: string[]): Promise<Map<string, TrackLeader[]>> {
  const byTrack = new Map<string, TrackLeader[]>()
  if (trackIds.length === 0) return byTrack

  const { rows } = await pool.query<TrackLeaderRow>(
    'SELECT track_id, role, github_id::text FROM track_leaders WHERE track_id = ANY($1) ORDER BY role, github_id',
    [trackIds],
  )
  for (const row of rows) {
    const leaders = byTrack.get(row.track_id) ?? []
    leaders.push({ role: row.role, githubId: row.github_id })
    byTrack.set(row.track_id, leaders)
  }
  return byTrack
}

/** IDEA-007's track directory reads this — every track, always live from
 * the DB, never a hardcoded list, so it reflects whatever's currently in
 * `pass/tracks.yaml` with no code change needed when a track is added,
 * renamed, or removed.
 *
 * IDEA-074 — ordered by app_config's preferred_track_order when set (a
 * track name with no match there, or an absent/never-synced config, falls
 * through to plain alphabetical — see migrations/030_preferred_track_order.sql).
 * `LEFT JOIN`, not a plain join: app_config is a singleton that may not
 * have a row yet, and a plain join against an absent row would drop every
 * track from the result instead of just falling back to alphabetical. */
export async function listTracks(): Promise<Track[]> {
  const { rows } = await pool.query<TrackRow>(
    `SELECT t.* FROM tracks t
       LEFT JOIN app_config ac ON ac.id = true
      ORDER BY COALESCE(array_position(ac.preferred_track_order, t.name), 2147483647), t.name`,
  )
  const leaders = await leadersByTrackId(rows.map((row) => row.id))
  return rows.map((row) => toTrack(row, leaders.get(row.id) ?? []))
}

/** IDEA-035's track page looks up one track by its slug (the URL segment,
 * `/tracks/[slug]`) — `null` for an unknown slug, same "not found" shape as
 * `findByGithubId`. */
export async function findTrackBySlug(slug: string): Promise<Track | null> {
  const { rows } = await pool.query<TrackRow>('SELECT * FROM tracks WHERE slug = $1', [slug])
  const row = rows[0]
  if (!row) return null
  const leaders = await leadersByTrackId([row.id])
  return toTrack(row, leaders.get(row.id) ?? [])
}

export interface TrackLeaderSync {
  role: TrackLeaderRole
  githubLogin: string
}

export interface TrackSync {
  slug: string
  name: string
  description?: string
  repositories: TrackRepository[]
  leaders: TrackLeaderSync[]
  /** IDEA-042 — a Discord role id, optional and unrelated to leader
   * login resolution (it doesn't name a contributor, so there's nothing
   * here for resolveGithubId to do). No githubTeam counterpart — see
   * IDEA-060, which computes a track's GitHub team slug from a global
   * pattern instead of storing one per track. */
  discordRoleId?: string
}

export interface TrackSyncResult {
  synced: string[]
  /** A track whose own upsert, one of whose leader logins didn't resolve
   * to a real contributor, or whose leaders exceeded MAX_LEADERS_PER_ROLE
   * for some role. Reported rather than aborting every other track's sync. */
  rejected: string[]
}

class UnknownGithubLoginError extends Error {}

/** A login is what the file gives (see tracks-registry.ts's module doc for
 * why); github_id is what every column and FK in this app actually keys
 * on. Throws UnknownGithubLoginError for a login with no matching
 * contributor — the caller decides how loudly that should fail. */
async function resolveGithubId(login: string): Promise<string> {
  const { rows } = await pool.query<{ github_id: string }>('SELECT github_id FROM contributors WHERE github_login = $1', [
    login,
  ])
  if (rows.length === 0) throw new UnknownGithubLoginError(login)
  return rows[0].github_id
}

/**
 * pass/tracks.yaml -> DB, one-way (see contributors-registry.ts's module
 * doc for why this app's other sync is bidirectional and this one isn't —
 * nothing about a track is self-reported by anyone). Upserts by `slug`,
 * then fully replaces that track's leaders (and, derived from them,
 * admins) to match the file exactly — delete-then-insert, not a diff, for
 * the same "the file is the whole set" reason as above. Never deletes a
 * track no longer present in the file — see IDEA-056's ideas.md notes on
 * why a merged-away track's stale row needs a manual cleanup instead.
 *
 * IDEA-118 — `track_admins` is no longer a second, independently-edited
 * list in the file; it's derived here as the deduped set of this track's
 * own leaders (any role, including the six-way TRACK_LEADER_ROLES union).
 * A person leading two roles on the same track (e.g. both `architect` and
 * `governance`) is still just one admin row — same reasoning as
 * IDEA-055's own (role, login) dedupe above, one level up.
 */
export async function syncTracks(tracks: TrackSync[]): Promise<TrackSyncResult> {
  const synced: string[] = []
  const rejected: string[] = []

  for (const track of tracks) {
    // A hand-edited file listing the same login twice under one role is a
    // typo, not a real second leader — dedupe by (role, login) before
    // counting toward MAX_LEADERS_PER_ROLE or inserting, so it doesn't also
    // trip track_leaders' (track_id, role, github_id) primary key mid-loop.
    const seen = new Set<string>()
    const leaders = track.leaders.filter((leader) => {
      const key = `${leader.role}:${leader.githubLogin}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    const roleCounts = new Map<TrackLeaderRole, number>()
    for (const leader of leaders) {
      roleCounts.set(leader.role, (roleCounts.get(leader.role) ?? 0) + 1)
    }
    const overLimit = [...roleCounts.entries()].some(([, count]) => count > MAX_LEADERS_PER_ROLE)
    if (overLimit) {
      rejected.push(track.slug)
      continue
    }

    let leaderIds: { role: TrackLeaderRole; githubId: string }[]
    try {
      leaderIds = await Promise.all(
        leaders.map(async (leader) => ({ role: leader.role, githubId: await resolveGithubId(leader.githubLogin) })),
      )
    } catch (error) {
      if (error instanceof UnknownGithubLoginError) {
        rejected.push(track.slug)
        continue
      }
      throw error
    }

    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO tracks (slug, name, description, repositories, discord_role_id)
            VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (slug) DO UPDATE
         SET name = EXCLUDED.name,
             description = EXCLUDED.description,
             repositories = EXCLUDED.repositories,
             discord_role_id = EXCLUDED.discord_role_id,
             updated_at = now()
       RETURNING id`,
      [track.slug, track.name, track.description ?? null, JSON.stringify(track.repositories), track.discordRoleId ?? null],
    )
    const trackId = rows[0].id

    await pool.query('DELETE FROM track_leaders WHERE track_id = $1', [trackId])
    for (const leader of leaderIds) {
      await pool.query('INSERT INTO track_leaders (track_id, role, github_id) VALUES ($1, $2, $3)', [
        trackId,
        leader.role,
        leader.githubId,
      ])
    }

    // IDEA-118 — every leader login above already resolved (or this track
    // would have been rejected before reaching here), so deriving admins
    // from them can't fail the way the old separate admin-login resolution
    // could.
    const adminGithubIds = [...new Set(leaderIds.map((leader) => leader.githubId))]
    await pool.query('DELETE FROM track_admins WHERE track_id = $1', [trackId])
    for (const githubId of adminGithubIds) {
      await pool.query('INSERT INTO track_admins (track_id, github_id) VALUES ($1, $2)', [trackId, githubId])
    }

    synced.push(track.slug)
  }

  return { synced, rejected }
}
