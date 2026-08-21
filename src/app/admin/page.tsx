import { findByGithubId, listConfirmedContributorEmails, listContributorsForRegistry } from '@/lib/contributors'
import { isAdmin } from '@/lib/roles'
import { getSession } from '@/lib/session'
import { CopyEmailListButton } from '@/app/copy-email-list-button'
import { listTrackParticipation } from '@/lib/track-members'
import { SignInPrompt } from '@/app/sign-in-prompt'
import { AdminContributorTable } from './admin-contributor-table'

/**
 * IDEA-012 — Admin-only. Reuses listContributorsForRegistry rather than a
 * new query: it already returns every column for every contributor
 * regardless of status, which is exactly "the full contributor table" —
 * including profileCompleteness (IDEA-034), which IDEA-036's table adds a
 * column and filter for.
 */
export default async function AdminPage() {
  const session = await getSession()
  if (!session.github) return <SignInPrompt />

  const contributor = await findByGithubId(session.github.id)
  if (!contributor || !isAdmin(contributor)) {
    return (
      <>
        <h2>Not authorized</h2>
        <p className="subtitle">This page is only available to Admins.</p>
      </>
    )
  }

  const contributors = await listContributorsForRegistry()
  const confirmedEmails = await listConfirmedContributorEmails()

  // IDEA-064's track-participation labels — one lookup per contributor,
  // same per-row shape as tracks/admin/page.tsx's own per-track member
  // lookups; this app's contributor count doesn't warrant a bulk query.
  const rows = await Promise.all(
    contributors.map(async (c) => ({
      githubId: c.githubId,
      githubLogin: c.githubLogin,
      name: c.name ?? null,
      email: c.email ?? null,
      company: c.company ?? null,
      discordUsername: c.discordUsername ?? null,
      status: c.status,
      profileCompleteness: c.profileCompleteness,
      githubOrgInvitedAt: c.githubOrgInvitedAt?.toISOString() ?? null,
      discordInvitedAt: c.discordInvitedAt?.toISOString() ?? null,
      tracks: await listTrackParticipation(c.githubId),
      // IDEA-071 — revokeRequestedByGithubId/revokeReason already came
      // along with listContributorsForRegistry's own `SELECT *`; only the
      // requester's login needs its own lookup, and only for the rare
      // revoke_pending row that actually has one to resolve.
      revokeRequestedByGithubId: c.revokeRequestedByGithubId ?? null,
      revokeRequestedByLogin: c.revokeRequestedByGithubId
        ? ((await findByGithubId(c.revokeRequestedByGithubId))?.githubLogin ?? null)
        : null,
      revokeReason: c.revokeReason ?? null,
    })),
  )

  return (
    <>
      <div className="profile-header">
        <h2>Admin</h2>
        <CopyEmailListButton emails={confirmedEmails} />
      </div>
      <p className="subtitle">Every contributor, across every status.</p>
      <AdminContributorTable contributors={rows} currentAdminGithubId={contributor.githubId} />
    </>
  )
}
