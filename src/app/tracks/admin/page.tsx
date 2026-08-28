import { getAppConfig } from '@/lib/app-config'
import { findByGithubId } from '@/lib/contributors'
import { isAdmin, adminTrackIds } from '@/lib/roles'
import { getSession } from '@/lib/session'
import { listConfirmedTrackMemberEmails, listTrackMembership, listTrackParticipation } from '@/lib/track-members'
import { listTracks } from '@/lib/tracks'
import { PageHeader } from '@/app/page-header'
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
  // IDEA-042/060 — only a track with a computable GitHub team (the global
  // pattern is configured at all — every track gets the same one) or its
  // own Discord role ever has anything for Re-add to do; the review UI uses
  // this to decide whether to show that button at all.
  const config = await getAppConfig()
  const hasGithubTeamPattern = Boolean(config?.githubOrganization && config.githubTrackTeamPattern)

  const sections = await Promise.all(
    tracks.map(async (track) => ({
      trackSlug: track.slug,
      trackName: track.name,
      hasTeamOrRole: hasGithubTeamPattern || Boolean(track.discordRoleId),
      members: await Promise.all(
        (await listTrackMembership(track.id)).map(async (member) => ({
          githubId: member.githubId,
          githubLogin: member.githubLogin,
          name: member.name,
          status: member.status,
          role: member.role,
          githubTeamAddedAt: member.githubTeamAddedAt?.toISOString() ?? null,
          discordRoleAddedAt: member.discordRoleAddedAt?.toISOString() ?? null,
          company: member.company ?? null,
          // IDEA-082 — the same contacts unified onto the Admin table.
          email: member.email ?? null,
          discordUsername: member.discordUsername ?? null,
          telegramUsername: member.telegramUsername ?? null,
          telegramPhone: member.telegramPhone ?? null,
          linkedinName: member.linkedinName ?? null,
          // IDEA-048 — a public profile only ever resolves for a `confirmed`
          // contributor (getPublicProfile's own gate), so a non-confirmed
          // requester's hash is dropped here rather than linking to a page
          // that would just 404.
          profileHash: member.contributorStatus === 'confirmed' ? member.profileHash : null,
          // IDEA-064's per-track rank badges — this member's participation
          // across every track, not just this one (same per-row query shape
          // admin/page.tsx already uses).
          tracks: await listTrackParticipation(member.githubId),
          // IDEA-093 — `false` for a config-assigned Track Admin with no
          // join request of their own; gates the review screen's own
          // Promote/Demote/Remove/Re-add actions.
          hasMembershipRow: member.hasMembershipRow,
        })),
      ),
      confirmedEmails: await listConfirmedTrackMemberEmails(track.id),
    })),
  )

  return (
    <>
      <PageHeader title="Track Members" />
      <p className="subtitle">Review join requests and members for {admin ? 'every track' : 'your track(s)'}.</p>
      <TrackMembershipReview sections={sections} />
    </>
  )
}
