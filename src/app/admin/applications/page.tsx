import { getApplicationApiKey, listApplications } from '@/lib/applications'
import { findByGithubId } from '@/lib/contributors'
import { env } from '@/lib/env'
import { isAdmin } from '@/lib/roles'
import { getSession } from '@/lib/session'
import { HOME_BREADCRUMB } from '@/app/breadcrumb'
import { PageHeader } from '@/app/page-header'
import { SignInPrompt } from '@/app/sign-in-prompt'
import { ApplicationsView } from './applications-view'

/**
 * IDEA-121 — Admin-only. A simple registry of external applications (name,
 * admin contact) each with its own API key, same generate/mask/regenerate
 * mechanic as a contributor's own personal key (IDEA-119,
 * `api-key-control.tsx`).
 */
export default async function ApplicationsPage() {
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

  const applications = await listApplications()
  const rows = await Promise.all(
    applications.map(async (application) => {
      const apiKey = await getApplicationApiKey(application.id)
      return {
        id: application.id,
        name: application.name,
        contactName: application.contactName,
        contactEmail: application.contactEmail,
        apiKey: apiKey ? { maskedKey: apiKey.maskedKey, createdAt: apiKey.createdAt.toISOString() } : null,
      }
    }),
  )

  return (
    <>
      <PageHeader title="Applications" breadcrumb={[HOME_BREADCRUMB, { label: 'Members', href: '/admin' }]} />
      <p className="subtitle">External applications with API access, and their keys.</p>
      <ApplicationsView applications={rows} apiOrigin={env.APP_URL} />
    </>
  )
}
