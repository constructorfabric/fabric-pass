/** IDEA-010's five named roles, plus IDEA-118's `governance` — a
 * non-technical role for a track's own administrative/governance leader,
 * distinct from the five functional disciplines above it (any track can
 * use it, not just Governance's own). Kept as a fixed union rather than an
 * open-ended string — there are always exactly these six.
 *
 * Lives in its own module, imported by lib/tracks.ts and by 'use client'
 * components alike (the Track Leaders page's tiles): this file has no
 * imports at all, so pulling it into a client bundle drags nothing
 * server-only (lib/db) along. */
export const TRACK_LEADER_ROLES = ['product_manager', 'architect', 'developer', 'quality', 'researcher', 'governance'] as const
export type TrackLeaderRole = (typeof TRACK_LEADER_ROLES)[number]

/** The human-readable form of each role above — shared by the track page's
 * leaders list (IDEA-035) and the Track Leaders page's tiles (IDEA-149),
 * so the same role reads the same way everywhere it's surfaced. */
export const TRACK_LEADER_ROLE_LABELS: Record<TrackLeaderRole, string> = {
  product_manager: 'Product Manager',
  architect: 'Architect',
  developer: 'Developer',
  quality: 'Quality',
  researcher: 'Researcher',
  governance: 'Governance',
}
