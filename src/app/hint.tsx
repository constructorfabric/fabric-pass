'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * A `title` attribute's native tooltip never fires on a touch device — there
 * is no hover to trigger it — so anything that relied on `title` alone (the
 * droplet status boxes, the profile-completeness info icon) was silently
 * unreachable on mobile. This is the replacement: the same detail text,
 * shown on hover *or* tap.
 *
 * `open` is a single boolean derived from hover and click state combined,
 * not two independently-rendered tooltips — clicking while already hovering
 * (the desktop case the request specifically calls out) still only ever
 * shows the one `.hint-detail` element below, never a second one stacked on
 * top of it.
 *
 * Click-driven opening follows the same open/toggle/click-outside-closes
 * shape as user-menu.tsx's own dropdown, since that's already this
 * codebase's established pattern for "tap to reveal, tap away to dismiss."
 */
export function Hint({ label, detail, className }: { label: ReactNode; detail: string; className?: string }) {
  const [hovered, setHovered] = useState(false)
  const [clicked, setClicked] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const open = hovered || clicked

  useEffect(() => {
    if (!clicked) return
    // Capture phase, not bubble — this component's own onClick below calls
    // stopPropagation, so with three Hints on one page (CPU/RAM/Disk), a
    // bubble-phase 'click' listener on document never even sees a click on
    // a second Hint: the first Hint's own handler already stopped it from
    // bubbling that far. Capture runs top-down, before that stopPropagation
    // happens, so clicking RAM still closes CPU's still-open detail first.
    function onPointerDownOutside(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setClicked(false)
    }
    document.addEventListener('pointerdown', onPointerDownOutside, true)
    return () => document.removeEventListener('pointerdown', onPointerDownOutside, true)
  }, [clicked])

  return (
    <span
      ref={ref}
      className={className ? `hint ${className}` : 'hint'}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(event) => {
        event.stopPropagation()
        setClicked((current) => !current)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          setClicked((current) => !current)
        } else if (event.key === 'Escape') {
          setClicked(false)
        }
      }}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      aria-label={detail}
    >
      {label}
      {/* aria-hidden — the same text is already exposed via the wrapper's
          own aria-label above, so a screen reader would otherwise announce
          it twice. */}
      {open ? (
        <span className="hint-detail" role="tooltip" aria-hidden="true">
          {detail}
        </span>
      ) : null}
    </span>
  )
}
