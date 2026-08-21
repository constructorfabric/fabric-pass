import { Badge } from '@gears-frontx/ui-kit'
import type { ReactNode } from 'react'
import { IdentityBadge } from './identity-badge'
import { CrownMark, StarMark } from './marks'
import { PROFILE_COMPLETENESS_LABELS, PROFILE_COMPLETENESS_VARIANTS, type ProfileCompleteness } from '@/lib/profile-completeness'

export interface TrackLabel {
  trackSlug: string
  trackName: string
  role: 'contributor' | 'maintainer'
  isTrackAdmin: boolean
}

type Rank = 'admin' | 'maintainer' | 'contributor'

const RANK_VARIANTS: Record<Rank, 'warning' | 'info' | 'muted'> = {
  admin: 'warning',
  maintainer: 'info',
  contributor: 'muted',
}

const RANK_LABELS: Record<Rank, string> = {
  admin: 'Track Admin',
  maintainer: 'Maintainer',
  contributor: 'Contributor',
}

function rankOf(track: TrackLabel): Rank {
  if (track.isTrackAdmin) return 'admin'
  return track.role
}

/**
 * IDEA-064's per-track badges (a crown for a Track Admin, a single star for
 * a Maintainer or a Contributor — a contributor who is also that track's
 * Admin shows the crown, not both). One third of IDEA-067's unified
 * `ProfileLabels` group below on the Admin table, the one surface that
 * keeps the full group; exported directly for IDEA-082/084's track-only
 * surfaces (the Track Admin review screen, the Public Profile page, and
 * the Profile Edit page), which want the rank badges without the
 * Stranger/Contributor identity badge or profile-completeness badge.
 * Maintainer and Contributor share the same star shape, sized apart (big
 * vs. small) rather than one star vs. three — a plainer, more scannable
 * distinction than three tiny stars packed into the same footprint as a
 * single one. Has no wrapping div of its own — `ProfileLabels` supplies
 * `.profile-labels` for its own three-part group; a caller using this
 * directly wraps it in `<div className="profile-labels">` itself.
 */
export function TrackBadges({ tracks }: { tracks: TrackLabel[] }) {
  return (
    <>
      {tracks.map((track) => {
        const rank = rankOf(track)
        const icon =
          rank === 'admin' ? <CrownMark size={12} /> : rank === 'maintainer' ? <StarMark size={16} /> : <StarMark size={9} />
        return (
          <Badge key={track.trackSlug} variant={RANK_VARIANTS[rank]} icon={icon} title={`${track.trackName} — ${RANK_LABELS[rank]}`}>
            {track.trackName}
          </Badge>
        )
      })}
    </>
  )
}

/**
 * IDEA-067 — every profile-adjacent label a person can carry, together, in
 * one group, in a fixed order: Stranger/Contributor (org-wide, Admin-set)
 * → one badge per track they participate in (IDEA-064) → profile readiness
 * (IDEA-034). Originally shown on every profile-adjacent surface; IDEA-082/084
 * narrowed that back to just the Admin table — the one surface where an
 * Admin's own judgment call (Stranger/Contributor, IDEA-071's Confirm/Ignore)
 * and profile readiness are actually the point. Every other surface (Public
 * Profile, Profile Edit, the Track Admin review screen) renders `TrackBadges`
 * directly instead — see that component's own doc comment.
 */
export function ProfileLabels({
  confirmed,
  tracks,
  completeness,
  completenessHint,
}: {
  confirmed: boolean
  tracks: TrackLabel[]
  completeness: ProfileCompleteness
  /** The private profile's own "what's still missing" tooltip (form.tsx) —
   * lives right after the completeness badge it explains, everywhere else
   * this is omitted. */
  completenessHint?: ReactNode
}) {
  return (
    <div className="profile-labels">
      <IdentityBadge confirmed={confirmed} />
      <TrackBadges tracks={tracks} />
      <Badge
        variant={PROFILE_COMPLETENESS_VARIANTS[completeness]}
        title="Profile completeness — derived from what's filled in, not admin-set"
      >
        {PROFILE_COMPLETENESS_LABELS[completeness]}
      </Badge>
      {completenessHint}
    </div>
  )
}
