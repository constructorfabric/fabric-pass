import { COMMUNITY_SCOPE, listArtifactLinks } from '@/lib/artifact-links'
import { findByGithubId } from '@/lib/contributors'
import { getSession } from '@/lib/session'
import { PageHeader } from '@/app/page-header'
import { SignInPrompt } from '@/app/sign-in-prompt'

/**
 * IDEA-046 — community-wide, category: 'vision' links from the artifact
 * links registry (IDEA-032), same shape as /policies (IDEA-006). The
 * registry only ever holds the label and URL; the documents themselves
 * live wherever they're actually maintained (constructorfabric.org, the
 * governance repository, etc.).
 */
export default async function VisionPage() {
  const session = await getSession()
  if (!session.github) return <SignInPrompt />

  const contributor = await findByGithubId(session.github.id)
  if (!contributor) return <SignInPrompt />

  const links = await listArtifactLinks(COMMUNITY_SCOPE)
  const vision = links.filter((link) => link.category === 'vision')

  return (
    <>
      <PageHeader title="Vision" />
      <p className="subtitle">Documents describing Constructor Fabric's overall vision and direction.</p>
      {vision.length > 0 ? (
        <ul className="footer-links vision-links">
          {vision.map((link) => (
            <li key={link.id}>
              <a href={link.url} target="_blank" rel="noreferrer">
                {link.label} →
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="search-empty">No vision documents published yet.</p>
      )}
    </>
  )
}
