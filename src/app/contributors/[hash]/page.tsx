import { redirect } from 'next/navigation'
import { findByGithubId, getPublicProfile } from '@/lib/contributors'
import { isAdmin } from '@/lib/roles'
import { getSession } from '@/lib/session'
import { listTrackParticipation } from '@/lib/track-members'
import { SignInPrompt } from '@/app/sign-in-prompt'
import { PublicProfileView } from './public-profile-view'

interface PageProps {
  params: Promise<{ hash: string }>
}

/**
 * IDEA-004's public contributor profile — reachable by direct link (this
 * page) and from search (IDEA-005's ContributorSearch). Signed-in
 * contributors only, same gate as the rest of the app; a hash that doesn't
 * resolve to a `confirmed` contributor reads as "not found" rather than a
 * hard crash, whether that's because it's malformed, points at a `draft`
 * signup, or the row has simply never existed. Opening your own profile
 * link redirects to the editable /profile instead of showing this same
 * page read-only a second time.
 *
 * IDEA-110 — loads the viewer's own row to compute their Admin role (the
 * same `caller`/`isAdmin` pattern admin/actions.ts uses), then passes
 * `{ githubId, isAdmin }` on to getPublicProfile so a locked Telegram/
 * LinkedIn is only ever included for an Admin or the profile's own owner.
 * A session whose row is gone is simply not an Admin, matching
 * layout.tsx's own `contributor ? isAdmin(contributor) : false`.
 */
export default async function ContributorPage({ params }: PageProps) {
  const session = await getSession()
  if (!session.github) return <SignInPrompt />

  const viewer = await findByGithubId(session.github.id)
  const admin = viewer ? isAdmin(viewer) : false

  const { hash } = await params
  const profile = await getPublicProfile(hash, { githubId: session.github.id, isAdmin: admin })
  if (!profile) {
    return (
      <>
        <h2>Contributor not found</h2>
        <p className="subtitle">This profile doesn&apos;t exist, or isn&apos;t public yet.</p>
      </>
    )
  }

  if (profile.githubId === session.github.id) {
    redirect('/profile')
  }

  const tracks = await listTrackParticipation(profile.githubId)

  return <PublicProfileView profile={profile} tracks={tracks} />
}
