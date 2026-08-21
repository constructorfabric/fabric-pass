import { pool } from '@/lib/db'
import { isRootUser } from '@/lib/root-user'
import type { Contributor } from '@/lib/contributors'

/**
 * IDEA-011's global Admin role. Two independent sources, either is
 * sufficient: `isRootUser` (an env-configured bootstrap admin — always one,
 * so there's never a chicken-and-egg problem granting the very first
 * `is_admin`) and `contributor.isAdmin` itself (registry-file-owned, see
 * contributors.ts).
 *
 * The `isAdmin` branch also requires `status === 'confirmed'` — IDEA-071's
 * Revoke exists specifically to pull an existing contributor's access, and
 * an Admin is a contributor too; without this, revoking an Admin would
 * remove their GitHub team/org membership but leave their in-app Admin
 * capability untouched. `isRootUser` is deliberately exempt from this check
 * — it's the env-configured bootstrap admin, who may not have a `confirmed`
 * (or even any) contributor row yet, and gating it here would reintroduce
 * the exact chicken-and-egg problem it exists to avoid.
 */
export function isAdmin(contributor: Contributor): boolean {
  return isRootUser(contributor.githubId) || (contributor.isAdmin && contributor.status === 'confirmed')
}

/**
 * IDEA-011's Track Admin — per-track, unlike isAdmin above. Used by
 * IDEA-014's member-list/join-request-review page (tracks/admin/) to gate
 * one specific track's review action. Membership lives in the track_admins
 * table (migrations/010_tracks.sql) rather than on the contributor row
 * itself, since it's a many-to-many relationship — one contributor can
 * admin more than one track, and one track can have more than one admin.
 */
export async function isTrackAdmin(githubId: string, trackId: string): Promise<boolean> {
  const { rows } = await pool.query('SELECT 1 FROM track_admins WHERE track_id = $1 AND github_id = $2', [
    trackId,
    githubId,
  ])
  return rows.length > 0
}

/** Every track a contributor administers — the reverse of isTrackAdmin
 * above. Used by IDEA-014's review page to pick which tracks' members to
 * show a Track Admin (a global Admin sees every track instead — see
 * tracks/admin/page.tsx). */
export async function adminTrackIds(githubId: string): Promise<string[]> {
  const { rows } = await pool.query<{ track_id: string }>('SELECT track_id FROM track_admins WHERE github_id = $1', [
    githubId,
  ])
  return rows.map((row) => row.track_id)
}
