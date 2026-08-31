import Link from 'next/link'
import { ChevronRightMark } from './marks'

export interface BreadcrumbSegment {
  label: string
  href: string
}

/** Every breadcrumb starts here — a shared constant so every call site
 * spells the label/href the same way instead of retyping `{ label: 'Home',
 * href: '/' }`. */
export const HOME_BREADCRUMB: BreadcrumbSegment = { label: 'Home', href: '/' }

/**
 * IDEA-109 — the real position in the page hierarchy (always starting from
 * Home), not a trail of previously visited pages. `path` is the *ancestor*
 * chain only — the current page's own title is already rendered as this
 * page's own heading right above, so repeating it here as a final,
 * non-clickable crumb would just duplicate that text; every segment this
 * component does render is a real link to that screen.
 */
export function Breadcrumb({ path }: { path: BreadcrumbSegment[] }) {
  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      {path.map((segment, index) => (
        <span className="breadcrumb-segment" key={segment.href}>
          <Link href={segment.href}>{segment.label}</Link>
          {index < path.length - 1 ? <ChevronRightMark size={14} /> : null}
        </span>
      ))}
    </nav>
  )
}
