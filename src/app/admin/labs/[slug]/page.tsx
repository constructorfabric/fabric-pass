import { notFound } from 'next/navigation'
import { findByGithubId } from '@/lib/contributors'
import { findLabBySlug } from '@/lib/labs'
import { isAdmin } from '@/lib/roles'
import { getSession } from '@/lib/session'
import { HOME_BREADCRUMB } from '@/app/breadcrumb'
import { PageHeader } from '@/app/page-header'
import { SignInPrompt } from '@/app/sign-in-prompt'
import { LabEditor } from '../lab-editor'
import { toLabView } from '../lab-view'

interface PageProps {
  params: Promise<{ slug: string }>
}

/** IDEA-156 — one Lab's own page: its details, its Leaders and
 * Maintainers, and Delete. Admin-only, like the list it's opened from. */
export default async function LabPage({ params }: PageProps) {
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

  const { slug } = await params
  const lab = await findLabBySlug(slug)
  if (!lab) notFound()

  return (
    <>
      <PageHeader
        title={lab.name}
        breadcrumb={[HOME_BREADCRUMB, { label: 'Members', href: '/admin' }, { label: 'Labs', href: '/admin/labs' }]}
      />
      <LabEditor lab={toLabView(lab)} />
    </>
  )
}
