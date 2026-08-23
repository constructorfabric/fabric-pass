import { COMMUNITY_SCOPE, listArtifactLinks } from '@/lib/artifact-links'
import { findByGithubId } from '@/lib/contributors'
import { getSession } from '@/lib/session'
import { PageHeader } from '@/app/page-header'
import { SignInPrompt } from '@/app/sign-in-prompt'

/**
 * IDEA-006 — community-wide, category: 'policy' links from the artifact
 * links registry (IDEA-032). The registry only ever holds the label and
 * URL; the documents themselves live in the governance repository (or
 * wherever else a given policy is actually maintained).
 *
 * Reuses the footer's own link styling (.footer-links, see footer.tsx)
 * rather than inventing a new list treatment — same muted colour, same
 * trailing "→". IDEA-103 — `.document-links` (IDEA-101) keeps it a single
 * column, same as the Vision page, rather than the footer's own flex-wrap.
 *
 * IDEA-047 — each link routes through /policies/visit rather than
 * pointing straight at the external URL, so a real click (not just
 * landing on this page) can back the checklist's "read the community
 * policies" done signal. `target="_blank"` still opens a new tab; that
 * tab's first hop is just this app's own redirect, imperceptible in
 * practice.
 */
export default async function PoliciesPage() {
  const session = await getSession()
  if (!session.github) return <SignInPrompt />

  const contributor = await findByGithubId(session.github.id)
  if (!contributor) return <SignInPrompt />

  const links = await listArtifactLinks(COMMUNITY_SCOPE)
  const policies = links.filter((link) => link.category === 'policy')

  return (
    <>
      <PageHeader title="Community policies" />
      <p className="subtitle">Constructor Fabric's community-wide rules and policies.</p>
      {policies.length > 0 ? (
        <ul className="footer-links document-links">
          {policies.map((policy) => (
            <li key={policy.id}>
              <a href={`/policies/visit?url=${encodeURIComponent(policy.url)}`} target="_blank" rel="noreferrer">
                {policy.label} →
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="search-empty">No policies published yet.</p>
      )}
    </>
  )
}
