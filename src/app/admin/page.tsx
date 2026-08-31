import { findByGithubId, listConfirmedContributorEmails, listContributorProfileHashes, listContributorsForRegistry } from '@/lib/contributors'
import { isAdmin } from '@/lib/roles'
import { getSession } from '@/lib/session'
import { HOME_BREADCRUMB } from '@/app/breadcrumb'
import { CopyEmailListButton } from '@/app/copy-email-list-button'
import { listTrackParticipation } from '@/lib/track-members'
import { PageHeader } from '@/app/page-header'
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
  const profileHashByGithubId = await listContributorProfileHashes()

  // IDEA-071 — the revoke requester is always another contributor already
  // in this same list, so their login resolves from a local map instead of
  // a query per row (a naive per-row findByGithubId would run for every
  // revoke_pending *and* every revoked row, since the requester columns are
  // kept, not cleared, once terminal — see contributors.ts's approveRevoke).
  const loginByGithubId = new Map(contributors.map((c) => [c.githubId, c.githubLogin]))

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
      telegramUsername: c.telegramUsername ?? null,
      telegramPhone: c.telegramPhone ?? null,
      linkedinName: c.linkedinName ?? null,
      status: c.status,
      profileCompleteness: c.profileCompleteness,
      githubOrgInvitedAt: c.githubOrgInvitedAt?.toISOString() ?? null,
      discordInvitedAt: c.discordInvitedAt?.toISOString() ?? null,
      tracks: await listTrackParticipation(c.githubId),
      // IDEA-081 — the hash itself is status-independent (md5(id::text)),
      // always passed through; whether it's actually clickable depends on
      // the *live* status at render time, not the status when this page
      // rendered. Gating it here instead would go stale the moment a row's
      // status changes optimistically client-side (Confirm/Revoke) without
      // a reload — see admin-contributor-table.tsx's own status check next
      // to where this is used.
      profileHash: profileHashByGithubId.get(c.githubId) ?? null,
      // IDEA-071 — revokeRequestedByGithubId/revokeReason already came
      // along with listContributorsForRegistry's own `SELECT *`; the
      // requester's login resolves from loginByGithubId above.
      revokeRequestedByGithubId: c.revokeRequestedByGithubId ?? null,
      revokeRequestedByLogin: c.revokeRequestedByGithubId ? (loginByGithubId.get(c.revokeRequestedByGithubId) ?? null) : null,
      revokeReason: c.revokeReason ?? null,
    })),
  )

  return (
    <>
      <PageHeader title="Members" actions={<CopyEmailListButton emails={confirmedEmails} />} breadcrumb={[HOME_BREADCRUMB]} />
      <p className="subtitle">Every contributor, across every status.</p>
      <AdminContributorTable
        contributors={rows}
        currentAdminGithubId={contributor.githubId}
        currentAdminGithubLogin={contributor.githubLogin}
      />
    </>
  )
}
