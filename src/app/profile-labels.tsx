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
 * Admin shows the crown, not both), now one third of IDEA-067's unified
 * group below rather than a standalone component. Maintainer and
 * Contributor share the same star shape, sized apart (big vs. small) rather
 * than one star vs. three — a plainer, more scannable distinction than
 * three tiny stars packed into the same footprint as a single one.
 */
function TrackBadges({ tracks }: { tracks: TrackLabel[] }) {
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
 * (IDEA-034). Shown on the public profile, the private profile (view and
 * edit mode alike — none of this is something a contributor edits on
 * themself), the Admin table, and the Track Admin review screen — the same
 * group, the same order, everywhere. Supersedes the narrower `TrackLabels`
 * this file used to export.
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
