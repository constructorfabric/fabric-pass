import { redirect } from 'next/navigation'
import { getPublicProfile } from '@/lib/contributors'
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
 */
export default async function ContributorPage({ params }: PageProps) {
  const session = await getSession()
  if (!session.github) return <SignInPrompt />

  const { hash } = await params
  const profile = await getPublicProfile(hash)
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
