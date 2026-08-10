import { findByGithubId } from '@/lib/contributors'
import { getSession } from '@/lib/session'
import { SignInPrompt } from '@/app/sign-in-prompt'
import { ContributorSearch } from '@/app/contributor-search'

/**
 * IDEA-046 — the People tile's destination. IDEA-005's search moved here
 * wholesale from Main, which now has no inline search of its own — see
 * page.tsx's own module doc for why.
 */
export default async function ContributorsPage() {
  const session = await getSession()
  if (!session.github) return <SignInPrompt />

  const contributor = await findByGithubId(session.github.id)
  if (!contributor) return <SignInPrompt />

  return (
    <>
      <h2>People</h2>
      <p className="subtitle">Find a Constructor Fabric contributor by name, email, or username.</p>
      <ContributorSearch />
    </>
  )
}
