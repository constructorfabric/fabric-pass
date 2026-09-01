import { stringify } from 'yaml'
import type { AllApprovedTrackMembership } from '@/lib/track-members'

interface TrackMemberRow {
  track: string
  github_login: string
  role: string
  decided_at: string | null
  capacity: number
}

/**
 * IDEA-123's cf-internal export — `pass/track-members.yaml`, the same
 * "every DB column this app owns, one YAML row per record" shape
 * `contributors-registry.ts`'s `toRegistryYaml` already uses. One-way only
 * (see `track-members.ts`'s own module doc for the same reasoning
 * `tracks.ts`'s `syncTracks` gives for its own one-way sync) — nothing
 * here is self-reported by anyone, so there's no matching import route the
 * way `contributors.ts`'s export/sync pair has.
 *
 * IDEA-124 — `capacity` (0-1, defaulting to `1`) rides along so external
 * applications can read a member's capacity the same way they already read
 * their role.
 */
export function toTrackMembersYaml(memberships: AllApprovedTrackMembership[]): string {
  const rows: TrackMemberRow[] = memberships.map((membership) => ({
    track: membership.trackSlug,
    github_login: membership.githubLogin,
    role: membership.role,
    decided_at: membership.decidedAt?.toISOString() ?? null,
    capacity: membership.capacityRatio,
  }))
  return stringify({ track_members: rows })
}
