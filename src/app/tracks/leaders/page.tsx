import { findByGithubId } from '@/lib/contributors'
import { nominatedCandidatesByTrackId } from '@/lib/leader-nominations'
import { isAdmin, adminTrackIds } from '@/lib/roles'
import { getSession } from '@/lib/session'
import { appointedLeadersByTrackId } from '@/lib/track-leaders'
import { listTracks } from '@/lib/tracks'
import { HOME_BREADCRUMB } from '@/app/breadcrumb'
import { PageHeader } from '@/app/page-header'
import { SignInPrompt } from '@/app/sign-in-prompt'
import { TrackLeadersReview } from './track-leaders-review'

/**
 * IDEA-149 — the leadership counterpart to the Track Members page
 * (tracks/admin): one section per track with its appointed leaders as tiles,
 * and a red warning wherever a track has no leader at all. Same audience and
 * same scoping as that page — a global Admin sees every track, a Track Admin
 * only the track(s) they administer (per roles.ts's adminTrackIds, IDEA-011).
 */
export default async function TrackLeadersPage() {
  const session = await getSession()
  if (!session.github) return <SignInPrompt />

  const contributor = await findByGithubId(session.github.id)
  if (!contributor) return <SignInPrompt />

  const allTracks = await listTracks()
  const admin = isAdmin(contributor)
  const ownTrackIds = admin ? null : new Set(await adminTrackIds(contributor.githubId))

  // Same role-check-not-data-check reasoning as tracks/admin/page.tsx — a
  // global Admin with zero tracks synced is "nothing to show yet", not
  // "not authorized".
  if (!admin && (!ownTrackIds || ownTrackIds.size === 0)) {
    return (
      <>
        <h2>Not authorized</h2>
        <p className="subtitle">This page is only available to Track Admins and Admins.</p>
      </>
    )
  }

  const tracks = admin ? allTracks : allTracks.filter((track) => ownTrackIds!.has(track.id))
  const trackIds = tracks.map((track) => track.id)
  const [appointed, nominated] = await Promise.all([appointedLeadersByTrackId(trackIds), nominatedCandidatesByTrackId(trackIds)])

  const sections = tracks.map((track) => ({
    trackSlug: track.slug,
    trackName: track.name,
    // IDEA-150 — the candidates awaiting a decision, above the appointed
    // leaders in the review component's own rendering order.
    candidates: (nominated.get(track.id) ?? []).map((candidate) => ({
      githubId: candidate.githubId,
      githubLogin: candidate.githubLogin,
      name: candidate.name ?? null,
      votes: candidate.votes,
      profileHash: candidate.contributorStatus === 'confirmed' ? candidate.profileHash : null,
    })),
    leaders: (appointed.get(track.id) ?? []).map((leader) => ({
      githubId: leader.githubId,
      githubLogin: leader.githubLogin,
      name: leader.name ?? null,
      role: leader.role,
      profileHash: leader.contributorStatus === 'confirmed' ? leader.profileHash : null,
    })),
  }))

  return (
    <>
      <PageHeader title="Track Leaders" breadcrumb={[HOME_BREADCRUMB]} />
      <p className="subtitle">Who leads {admin ? 'every track' : 'your track(s)'}.</p>
      <TrackLeadersReview sections={sections} />
    </>
  )
}
