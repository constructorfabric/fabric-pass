import { pool } from '@/lib/db'

export interface TrackRepository {
  url: string
  description?: string
  issueTracker?: string
}

/** IDEA-010's five named roles. Kept as a fixed union rather than an
 * open-ended string — there are always exactly these five. */
export const TRACK_LEADER_ROLES = ['product_manager', 'architect', 'developer', 'quality', 'researcher'] as const
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
  /** IDEA-042 — optional, from pass/tracks.yaml. A track with neither set
   * never triggers a GitHub-team or Discord-role grant on join approval
   * (see tracks/admin/actions.ts's decideJoinRequestAction). */
  githubTeam?: string
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
  github_team: string | null
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
    githubTeam: row.github_team ?? undefined,
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
 * renamed, or removed. */
export async function listTracks(): Promise<Track[]> {
  const { rows } = await pool.query<TrackRow>('SELECT * FROM tracks ORDER BY name')
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
  /** Full replacement each sync, not a diff — matches how the rest of this
   * app treats the registry file as authoritative: whatever it currently
   * lists *is* the whole set. */
  adminGithubLogins: string[]
  /** IDEA-042 — a GitHub team slug and a Discord role id, both optional and
   * unrelated to leader/admin login resolution (neither names a
   * contributor, so there's nothing here for resolveGithubId to do). */
  githubTeam?: string
  discordRoleId?: string
}

export interface TrackSyncResult {
  synced: string[]
  /** A track whose own upsert, one of whose leader/admin logins didn't
   * resolve to a real contributor, or whose leaders exceeded
   * MAX_LEADERS_PER_ROLE for some role. Reported rather than aborting every
   * other track's sync. */
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
 * then fully replaces that track's admins and leaders to match the file
 * exactly — delete-then-insert, not a diff, for the same "the file is the
 * whole set" reason as above. Never deletes a track no longer present in
 * the file — see IDEA-056's ideas.md notes on why a merged-away track's
 * stale row needs a manual cleanup instead.
 */
export async function syncTracks(tracks: TrackSync[]): Promise<TrackSyncResult> {
  const synced: string[] = []
  const rejected: string[] = []

  for (const track of tracks) {
    const roleCounts = new Map<TrackLeaderRole, number>()
    for (const leader of track.leaders) {
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
        track.leaders.map(async (leader) => ({ role: leader.role, githubId: await resolveGithubId(leader.githubLogin) })),
      )
    } catch (error) {
      if (error instanceof UnknownGithubLoginError) {
        rejected.push(track.slug)
        continue
      }
      throw error
    }

    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO tracks (slug, name, description, repositories, github_team, discord_role_id)
            VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (slug) DO UPDATE
         SET name = EXCLUDED.name,
             description = EXCLUDED.description,
             repositories = EXCLUDED.repositories,
             github_team = EXCLUDED.github_team,
             discord_role_id = EXCLUDED.discord_role_id,
             updated_at = now()
       RETURNING id`,
      [track.slug, track.name, track.description ?? null, JSON.stringify(track.repositories), track.githubTeam ?? null, track.discordRoleId ?? null],
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

    await pool.query('DELETE FROM track_admins WHERE track_id = $1', [trackId])
    let adminsRejected = false
    for (const login of track.adminGithubLogins) {
      try {
        const githubId = await resolveGithubId(login)
        await pool.query('INSERT INTO track_admins (track_id, github_id) VALUES ($1, $2)', [trackId, githubId])
      } catch (error) {
        if (error instanceof UnknownGithubLoginError) {
          adminsRejected = true
          continue
        }
        throw error
      }
    }

    if (adminsRejected) rejected.push(track.slug)
    else synced.push(track.slug)
  }

  return { synced, rejected }
}
