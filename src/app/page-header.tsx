import { Button } from '@gears-frontx/ui-kit'
import Link from 'next/link'
import { CloseMark } from './marks'

/**
 * IDEA-068 — the same top-right "Close" button the profile views already
 * have (public-profile-view.tsx, form.tsx), extracted since Vision,
 * Policies, Tracks, and People all needed the identical pattern: a page
 * title with a way straight back to Home, for anyone who opens one of
 * these from a bookmark or a link rather than the header's own nav.
 */
export function PageHeader({ title }: { title: string }) {
  return (
    <div className="profile-header">
      <h2>{title}</h2>
      <Button
        render={<Link href="/" />}
        nativeButton={false}
        variant="outline"
        icon={<CloseMark />}
        title="Close"
        aria-label="Close"
      />
    </div>
  )
}
