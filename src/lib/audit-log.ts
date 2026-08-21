import { pool } from '@/lib/db'

export type AdminActionType = 'confirm' | 'block' | 'accept' | 'reject' | 'remove_from_track'

export interface AdminAction {
  id: string
  actorGithubId: string
  actorGithubLogin: string
  action: AdminActionType
  targetGithubId?: string
  targetGithubLogin?: string
  trackName?: string
  details: Record<string, unknown>
  createdAt: Date
}

interface LogAdminActionInput {
  actorGithubId: string
  action: AdminActionType
  targetGithubId?: string
  trackId?: string
  details?: Record<string, unknown>
}

/**
 * IDEA-022 — called from the same server actions that already perform the
 * change (admin/actions.ts's setContributorStatusAction, tracks/admin/actions.ts's
 * decideJoinRequestAction), right after the underlying write succeeds. Never
 * throws: a logging failure must not undo, or even surface as a failure of,
 * an already-persisted admin decision — same discipline lib/email.ts's
 * send() follows for the same reason (best-effort, secondary to the real
 * action).
 */
export async function logAdminAction(input: LogAdminActionInput): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO admin_actions (actor_github_id, action, target_github_id, track_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.actorGithubId, input.action, input.targetGithubId ?? null, input.trackId ?? null, JSON.stringify(input.details ?? {})],
    )
  } catch (error) {
    console.error('logAdminAction failed:', error)
  }
}

interface AdminActionRow {
  id: string
  actor_github_id: string
  actor_github_login: string
  action: AdminActionType
  target_github_id: string | null
  target_github_login: string | null
  track_name: string | null
  details: Record<string, unknown>
  created_at: Date
}

/** IDEA-022 — every logged action, newest first, for the Admin-only audit
 * log page. Not scoped to a Track Admin's own tracks — the idea's own
 * notes leave that undecided, and this session's answer was Admins only,
 * no Track Admin view at all (see tracks/admin/page.tsx for the analogous,
 * but genuinely Track-Admin-scoped, membership review page). */
export async function listAdminActions(): Promise<AdminAction[]> {
  const { rows } = await pool.query<AdminActionRow>(
    `SELECT aa.id, aa.actor_github_id, actor.github_login AS actor_github_login,
            aa.action, aa.target_github_id, target.github_login AS target_github_login,
            t.name AS track_name, aa.details, aa.created_at
       FROM admin_actions aa
       JOIN contributors actor ON actor.github_id = aa.actor_github_id
       LEFT JOIN contributors target ON target.github_id = aa.target_github_id
       LEFT JOIN tracks t ON t.id = aa.track_id
      ORDER BY aa.created_at DESC`,
  )
  return rows.map((row) => ({
    id: row.id,
    actorGithubId: row.actor_github_id,
    actorGithubLogin: row.actor_github_login,
    action: row.action,
    targetGithubId: row.target_github_id ?? undefined,
    targetGithubLogin: row.target_github_login ?? undefined,
    trackName: row.track_name ?? undefined,
    details: row.details,
    createdAt: row.created_at,
  }))
}
