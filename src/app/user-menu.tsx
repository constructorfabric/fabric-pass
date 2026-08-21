'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@gears-frontx/ui-kit'
import { CrownMark, StarMark, TripleStarMark } from './marks'

/** IDEA-064's avatar rank badge — the trigger's own icon for the single
 * highest rank across every track (see lib/track-members.ts's
 * highestTrackRank, computed server-side in layout.tsx). `null` means no
 * track participation at all, so nothing renders. */
type TrackRank = 'admin' | 'maintainer' | 'contributor' | null

function rankIcon(rank: TrackRank) {
  if (rank === 'admin') return <CrownMark size={11} />
  if (rank === 'maintainer') return <TripleStarMark size={11} />
  if (rank === 'contributor') return <StarMark size={11} />
  return null
}

/** The badge icon is `aria-hidden` (decorative — the trigger's own
 * aria-label carries the meaning), so the rank still needs a text form
 * somewhere assistive tech can reach it. */
function rankLabel(rank: TrackRank): string | null {
  if (rank === 'admin') return 'Track Admin'
  if (rank === 'maintainer') return 'Maintainer'
  if (rank === 'contributor') return 'Contributor'
  return null
}

/** "Ada Lovelace" → "AL"; a single word (a github login, or a one-word name)
 * takes its first two characters instead. */
function initials(value: string): string {
  const words = value.trim().split(/\s+/)
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase()
  return value.slice(0, 2).toUpperCase()
}

/**
 * The kit's DropdownMenu replaced the hand-rolled open-state + click-outside
 * effect this used to carry — outside-press and Escape dismissal, arrow-key
 * navigation, and focus management all come from Base UI now. The trigger
 * stays the app's own round initials tile (`.user-menu-trigger`): the kit's
 * trigger is an unstyled pass-through by design, and an avatar button isn't
 * one of its Button variants.
 */
export function UserMenu({
  login,
  name,
  isAdmin,
  isTrackAdmin,
  trackRank,
}: {
  login: string
  name: string | null
  isAdmin: boolean
  isTrackAdmin: boolean
  trackRank: TrackRank
}) {
  const displayName = name || `@${login}`
  const icon = rankIcon(trackRank)
  const label = rankLabel(trackRank)
  const triggerLabel = label ? `Account menu for ${displayName}, ${label}` : `Account menu for ${displayName}`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="user-menu-trigger" aria-label={triggerLabel}>
        {initials(name || login)}
        {icon ? (
          <span className="user-menu-trigger-badge" aria-hidden="true">
            {icon}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      {/* .user-menu-popup: the kit popup sizes itself to the trigger's
          width, and this trigger is a 2.5rem circle — size to the items
          instead. .user-menu-item: the items are real anchors (render), and
          the kit's item class doesn't reset the browser's link
          underline/color. */}
      <DropdownMenuContent align="end" className="user-menu-popup">
        {/* DropdownMenuLabel must live inside a group — Base UI resolves
            which group it labels from context and throws otherwise. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>{displayName}</DropdownMenuLabel>
          <DropdownMenuItem className="user-menu-item" render={<a href="/profile" />}>
            Profile
          </DropdownMenuItem>
          {isTrackAdmin ? (
            <DropdownMenuItem className="user-menu-item" render={<a href="/tracks/admin" />}>
              Track membership
            </DropdownMenuItem>
          ) : null}
          {isAdmin ? (
            <DropdownMenuItem className="user-menu-item" render={<a href="/admin" />}>
              Admin
            </DropdownMenuItem>
          ) : null}
          {isAdmin ? (
            <DropdownMenuItem className="user-menu-item" render={<a href="/admin/audit-log" />}>
              Audit log
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem className="user-menu-item" render={<a href="/auth/sign-out" />}>
            Sign Out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
