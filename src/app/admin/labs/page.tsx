import { findByGithubId } from '@/lib/contributors'
import { listLabs } from '@/lib/labs'
import { isAdmin } from '@/lib/roles'
import { getSession } from '@/lib/session'
import { HOME_BREADCRUMB } from '@/app/breadcrumb'
import { PageHeader } from '@/app/page-header'
import { SignInPrompt } from '@/app/sign-in-prompt'
import { toLabView } from './lab-view'
import { LabsView } from './labs-view'

/**
 * IDEA-156 — Admin-only. Every Lab — a research or prototyping effort
 * outside the tracks — with its repositories and the people leading and
 * maintaining it, plus the form that creates a new one. Each Lab is edited
 * on its own page, /admin/labs/[slug].
 */
export default async function LabsPage() {
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

  const labs = await listLabs()

  return (
    <>
      <PageHeader title="Labs" breadcrumb={[HOME_BREADCRUMB, { label: 'Members', href: '/admin' }]} />
      <p className="subtitle">
        Research and prototyping repositories that belong to no track, each with its own Leaders and Maintainers.
      </p>
      <LabsView labs={labs.map(toLabView)} />
    </>
  )
}
