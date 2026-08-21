import { Badge } from '@gears-frontx/ui-kit'
import { CrownMark, StarMark, TripleStarMark } from './marks'

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
 * IDEA-064 — one badge per track a contributor participates in, shown on the
 * public profile, the Admin contributor table, and the private profile
 * (view and edit mode alike — this is read-only everywhere; role/membership
 * isn't something a contributor edits on themself). Icon and variant follow
 * the highest rank on that specific track: a crown for a Track Admin, a
 * triple star for a Maintainer, a single star for a plain Contributor — a
 * contributor who is also that track's Admin shows the crown, not both.
 */
export function TrackLabels({ tracks }: { tracks: TrackLabel[] }) {
  if (tracks.length === 0) return null

  return (
    <div className="track-labels">
      {tracks.map((track) => {
        const rank = rankOf(track)
        const icon = rank === 'admin' ? <CrownMark size={12} /> : rank === 'maintainer' ? <TripleStarMark size={12} /> : <StarMark size={12} />
        return (
          <Badge key={track.trackSlug} variant={RANK_VARIANTS[rank]} icon={icon} title={`${track.trackName} — ${RANK_LABELS[rank]}`}>
            {track.trackName}
          </Badge>
        )
      })}
    </div>
  )
}
