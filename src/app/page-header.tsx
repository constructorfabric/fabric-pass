import { Button } from '@gears-frontx/ui-kit'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Breadcrumb, type BreadcrumbSegment } from './breadcrumb'
import { CloseMark } from './marks'

/**
 * IDEA-068 — the same top-right "Close" button the profile views already
 * have (public-profile-view.tsx, form.tsx), extracted since Vision,
 * Policies, Tracks, and People all needed the identical pattern: a page
 * title with a way straight back to Home, for anyone who opens one of
 * these from a bookmark or a link rather than the header's own nav.
 *
 * IDEA-083 — optional `actions`, rendered between the title and the Close
 * button, so a page like Admin can keep its own button (e.g.
 * CopyEmailListButton) alongside the Close button instead of managing its
 * own header row.
 *
 * IDEA-109 — optional `breadcrumb`, rendered below the title row — omitted
 * (not just an empty nav) when a caller doesn't pass one, since Home itself
 * has nothing above it to show.
 */
export function PageHeader({ title, actions, breadcrumb }: { title: string; actions?: ReactNode; breadcrumb?: BreadcrumbSegment[] }) {
  return (
    <>
      <div className="profile-header">
        <h2>{title}</h2>
        <div className="page-header-actions">
          {actions}
          <Button
            render={<Link href="/" />}
            nativeButton={false}
            variant="outline"
            icon={<CloseMark />}
            title="Close"
            aria-label="Close"
          />
        </div>
      </div>
      {breadcrumb ? <Breadcrumb path={breadcrumb} /> : null}
    </>
  )
}
