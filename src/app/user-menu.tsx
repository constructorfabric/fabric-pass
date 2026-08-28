'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@gears-frontx/ui-kit'
import { CrownMark, DiamondMark, DiamondOutlineMark, QuestionMark, StarMark } from './marks'

/** IDEA-106's account-menu avatar badge — one merged hierarchy across both
 * org-wide standing (Admin, Stranger/Contributor) and per-track standing
 * (Track Admin/Maintainer/Contributor), computed server-side in
 * layout.tsx: an org-wide Admin or a Track Admin of any track both read as
 * `admin` (same icon — both mean administrative authority, just different
 * scope); otherwise the highest track rank; otherwise whether the
 * contributor has been confirmed at all. */
export type AccountRank = 'admin' | 'maintainer' | 'contributor' | 'confirmed' | 'stranger'

function rankIcon(rank: AccountRank) {
  if (rank === 'admin') return <CrownMark size={15} />
  if (rank === 'maintainer') return <StarMark size={15} />
  // The brand accent (--primary, the same purple as every "join"/"add"
  // button) — the one state in this badge that isn't currentColor, since
  // "coloured diamond" (Track Contributor) needs to read as visually
  // distinct from "outline diamond" (confirmed, no tracks) at a glance,
  // not just filled-vs-outline.
  if (rank === 'contributor') return <span style={{ color: 'var(--primary)' }}><DiamondMark size={15} /></span>
  if (rank === 'confirmed') return <DiamondOutlineMark size={15} />
  return <QuestionMark size={15} />
}

/** The badge icon is `aria-hidden` (decorative — the trigger's own
 * aria-label carries the meaning), so the rank still needs a text form
 * somewhere assistive tech can reach it. */
function rankLabel(rank: AccountRank): string {
  if (rank === 'admin') return 'Admin'
  if (rank === 'maintainer') return 'Maintainer'
  if (rank === 'contributor') return 'Track Contributor'
  if (rank === 'confirmed') return 'Confirmed Contributor'
  return 'Stranger'
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
  rank,
}: {
  login: string
  name: string | null
  isAdmin: boolean
  isTrackAdmin: boolean
  rank: AccountRank
}) {
  const displayName = name || `@${login}`
  const triggerLabel = `Account menu for ${displayName}, ${rankLabel(rank)}`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="user-menu-trigger" aria-label={triggerLabel}>
        {initials(name || login)}
        <span className="user-menu-trigger-badge" aria-hidden="true">
          {rankIcon(rank)}
        </span>
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
              Track Members
            </DropdownMenuItem>
          ) : null}
          {isAdmin ? (
            <DropdownMenuItem className="user-menu-item" render={<a href="/admin" />}>
              Members
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
