'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@gears-frontx/ui-kit'

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
}: {
  login: string
  name: string | null
  isAdmin: boolean
  isTrackAdmin: boolean
}) {
  const displayName = name || `@${login}`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="user-menu-trigger" aria-label={`Account menu for ${displayName}`}>
        {initials(name || login)}
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
