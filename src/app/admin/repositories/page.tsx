import { getAppConfig } from '@/lib/app-config'
import { findByGithubId } from '@/lib/contributors'
import { listOrgPropertySchema, listOrgRepositories, listOrgRepositoryProperties } from '@/lib/github-org'
import { isAdmin } from '@/lib/roles'
import { getSession } from '@/lib/session'
import { PageHeader } from '@/app/page-header'
import { SignInPrompt } from '@/app/sign-in-prompt'
import { RepositoriesTable } from './repositories-table'

/**
 * IDEA-107 — Admin-only. Lists every repository in the org's GitHub
 * organization with its Type/Track custom-property labels, read live from
 * GitHub on every load rather than cached in this app's own DB: this is
 * occasional-use, Admin-only tooling, not something that needs its own sync
 * job or migration. Read-only by design — editing a repository's custom
 * properties happens on GitHub's own repo settings page, which the
 * repository's name links straight to.
 *
 * "Type" and "Track" are the two property *names* this screen looks for —
 * a deliberate constant matching what was actually asked for, not a
 * generic n-properties display. Their *allowed values* (what the filter
 * dropdowns offer) come from GitHub's schema, not hardcoded — see
 * lib/github-org.ts's listOrgPropertySchema.
 */
export default async function RepositoriesPage() {
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

  const config = await getAppConfig()
  const organization = config?.githubOrganization

  if (!organization) {
    return (
      <>
        <PageHeader title="Repositories" />
        <p className="subtitle">Not configured — no GitHub organization is set yet.</p>
      </>
    )
  }

  const [repos, properties, schema] = await Promise.all([
    listOrgRepositories(organization),
    listOrgRepositoryProperties(organization),
    listOrgPropertySchema(organization),
  ])

  // listOrgRepositories never throws — an empty result here means either
  // GITHUB_ORG_TOKEN isn't configured, or GitHub rejected the call (missing
  // scope, wrong org), not "this org genuinely has zero repositories."
  if (repos.length === 0) {
    return (
      <>
        <PageHeader title="Repositories" />
        <p className="subtitle">
          Couldn&apos;t load repositories from GitHub for {organization} — GITHUB_ORG_TOKEN may not be configured, or
          may not have permission to read the organization&apos;s repositories and custom properties.
        </p>
      </>
    )
  }

  const propertiesByRepo = new Map(properties.map((row) => [row.repoName, row.properties]))
  const rows = repos.map((repo) => ({
    name: repo.name,
    htmlUrl: repo.htmlUrl,
    archived: repo.archived,
    type: propertiesByRepo.get(repo.name)?.Type ?? null,
    track: propertiesByRepo.get(repo.name)?.Track ?? null,
  }))

  return (
    <>
      <PageHeader title="Repositories" />
      <p className="subtitle">Every repository in {organization}, with its Type and Track labels.</p>
      <RepositoriesTable
        repositories={rows}
        typeOptions={schema.find((property) => property.name === 'Type')?.allowedValues ?? []}
        trackOptions={schema.find((property) => property.name === 'Track')?.allowedValues ?? []}
      />
    </>
  )
}
