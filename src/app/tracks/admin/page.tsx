import { findByGithubId } from '@/lib/contributors'
import { isAdmin, adminTrackIds } from '@/lib/roles'
import { getSession } from '@/lib/session'
import { listTrackMembership } from '@/lib/track-members'
import { listTracks } from '@/lib/tracks'
import { SignInPrompt } from '@/app/sign-in-prompt'
import { TrackMembershipReview } from './track-membership-review'

/**
 * IDEA-014 — a global Admin sees every track's membership and pending
 * requests; a Track Admin sees only the track(s) they administer (per
 * roles.ts's adminTrackIds, IDEA-011). Neither role sees this page item at
 * all otherwise (see user-menu.tsx, gated in layout.tsx).
 */
export default async function TrackAdminPage() {
  const session = await getSession()
  if (!session.github) return <SignInPrompt />

  const contributor = await findByGithubId(session.github.id)
  if (!contributor) return <SignInPrompt />

  const allTracks = await listTracks()
  const admin = isAdmin(contributor)
  const ownTrackIds = admin ? null : new Set(await adminTrackIds(contributor.githubId))

  // Authorization is a role check, not a data check — a global Admin is
  // authorized here regardless of how many tracks currently exist (even
  // zero, e.g. right after a deploy before pass/tracks.yaml has ever
  // synced). Basing "authorized" on `tracks.length` would have
  // misclassified that as "not authorized" instead of "nothing to show
  // yet" for a real Admin.
  if (!admin && (!ownTrackIds || ownTrackIds.size === 0)) {
    return (
      <>
        <h2>Not authorized</h2>
        <p className="subtitle">This page is only available to Track Admins and Admins.</p>
      </>
    )
  }

  const tracks = admin ? allTracks : allTracks.filter((track) => ownTrackIds!.has(track.id))

  const sections = await Promise.all(
    tracks.map(async (track) => ({
      trackSlug: track.slug,
      trackName: track.name,
      // IDEA-042 — only a track with a GitHub team or Discord role
      // configured ever has anything for Re-add to do; the review UI uses
      // this to decide whether to show that button at all.
      hasTeamOrRole: Boolean(track.githubTeam || track.discordRoleId),
      members: (await listTrackMembership(track.id)).map((member) => ({
        githubId: member.githubId,
        githubLogin: member.githubLogin,
        name: member.name,
        status: member.status,
        githubTeamAddedAt: member.githubTeamAddedAt?.toISOString() ?? null,
        discordRoleAddedAt: member.discordRoleAddedAt?.toISOString() ?? null,
      })),
    })),
  )

  return (
    <>
      <h2>Track membership</h2>
      <p className="subtitle">Review join requests and members for {admin ? 'every track' : 'your track(s)'}.</p>
      <TrackMembershipReview sections={sections} />
    </>
  )
}
