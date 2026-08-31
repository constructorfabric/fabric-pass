import { pool } from '@/lib/db'
import { listApprovedTrackMemberships } from '@/lib/track-members'

/** IDEA-122 — a track member's capacity ratio defaults to full (100%)
 * until a Track Admin sets one explicitly; matches the idea's own "by
 * default it should be 1." */
const DEFAULT_CAPACITY = 1

export class InvalidCapacityError extends Error {}

/** 0 and 1 are both valid (the idea's own "0% to 100% inclusive"). */
function assertValidRatio(ratio: number): void {
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new InvalidCapacityError(`ratio must be between 0 and 1, got ${ratio}`)
  }
}

/** IDEA-122 — this member's current capacity on this track. `1` (100%)
 * when no row has ever been written for them — the default, not a
 * "missing data" case. */
export async function getCurrentCapacity(trackId: string, githubId: string): Promise<number> {
  const { rows } = await pool.query<{ ratio: string }>(
    'SELECT ratio FROM track_member_capacity WHERE track_id = $1 AND github_id = $2 AND effective_until IS NULL',
    [trackId, githubId],
  )
  return rows[0] ? Number(rows[0].ratio) : DEFAULT_CAPACITY
}

/** IDEA-122 — every current capacity on this track at once, for the
 * member-list screen — one query instead of one per member. A member with
 * no entry here isn't in the map at all; the caller applies the same `1`
 * default `getCurrentCapacity` uses for a single lookup. */
export async function listCurrentCapacities(trackId: string): Promise<Map<string, number>> {
  const { rows } = await pool.query<{ github_id: string; ratio: string }>(
    'SELECT github_id, ratio FROM track_member_capacity WHERE track_id = $1 AND effective_until IS NULL',
    [trackId],
  )
  return new Map(rows.map((row) => [row.github_id, Number(row.ratio)]))
}

/**
 * IDEA-122's editable capacity field — effective immediately. Closes the
 * previous current row (if any) and opens a new one inside one
 * transaction, same shape as artifact-links.ts's own syncArtifactLinks —
 * a single statement combining both via a writable CTE looks tempting,
 * but Postgres explicitly documents that a data-modifying CTE's effects
 * are only guaranteed visible to the rest of the same statement if its
 * result rows are actually read from; since nothing here reads `closed`,
 * the UPDATE and INSERT could run out of order and trip the table's own
 * partial unique index. An explicit transaction has no such ambiguity.
 */
export async function setCapacity(trackId: string, githubId: string, ratio: number): Promise<void> {
  assertValidRatio(ratio)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      'UPDATE track_member_capacity SET effective_until = now() WHERE track_id = $1 AND github_id = $2 AND effective_until IS NULL',
      [trackId, githubId],
    )
    await client.query(
      'INSERT INTO track_member_capacity (track_id, github_id, ratio, effective_from) VALUES ($1, $2, $3, now())',
      [trackId, githubId, ratio],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/** IDEA-122 — a contributor's overall Fabric-wide capacity: the sum of
 * their current capacity across every track they're an approved member
 * of, each defaulting to full if never explicitly set. */
export async function getFabricWideCapacity(githubId: string): Promise<number> {
  const memberships = await listApprovedTrackMemberships(githubId)
  const capacities = await Promise.all(memberships.map((membership) => getCurrentCapacity(membership.trackId, githubId)))
  return capacities.reduce((sum, capacity) => sum + capacity, 0)
}
