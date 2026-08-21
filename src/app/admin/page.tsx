import { findByGithubId, listConfirmedContributorEmails, listContributorsForRegistry } from '@/lib/contributors'
import { isAdmin } from '@/lib/roles'
import { getSession } from '@/lib/session'
import { CopyEmailListButton } from '@/app/copy-email-list-button'
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

  return (
    <>
      <div className="profile-header">
        <h2>Admin</h2>
        <CopyEmailListButton emails={confirmedEmails} />
      </div>
      <p className="subtitle">Every contributor, across every status.</p>
      <AdminContributorTable
        contributors={contributors.map((c) => ({
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
        }))}
      />
    </>
  )
}
