import { getAppConfig } from '@/lib/app-config'
import type { Contributor } from '@/lib/contributors'
import {
  addToGitHubTeam,
  ensureGitHubTeam,
  grantTeamRepository,
  removeFromGitHubTeam,
  removeTeamRepository,
  type TeamRepositoryPermission,
} from '@/lib/github-org'
import { inviteConfirmedContributor } from '@/lib/invites'
import { LAB_ROLES, parseRepositoryUrl, type LabRepository, type LabRole } from '@/lib/lab-input'

/**
 * IDEA-157 — the GitHub half of a Lab (IDEA-156). Each Lab has two teams,
 * named after its slug on the same convention tracks use:
 * `{slug}-leaders`, granted `maintain` on every Lab repository, and
 * `{slug}-maintainers`, granted `push` (GitHub's "Write"). Putting someone
 * on a Lab adds them to their role's team; removing them takes them out.
 * Access goes through team grants only, never direct collaborators.
 *
 * Every function here is best-effort and never throws: the in-app write has
 * already succeeded by the time it runs, the same discipline team-access.ts
 * keeps for tracks. All of it needs `githubOrganization` configured, and
 * github-org.ts no-ops (with a logged reason) without GITHUB_ORG_TOKEN.
 *
 * A Lab repository outside the configured organization is skipped: a team
 * can only be granted repositories its own organization owns.
 */

export const LAB_TEAM_PERMISSIONS: Record<LabRole, TeamRepositoryPermission> = {
  leader: 'maintain',
  maintainer: 'push',
}

const LAB_TEAM_SUFFIXES: Record<LabRole, string> = {
  leader: 'leaders',
  maintainer: 'maintainers',
}

export function labTeamSlug(labSlug: string, role: LabRole): string {
  return `${labSlug}-${LAB_TEAM_SUFFIXES[role]}`
}

interface LabRef {
  slug: string
  repositories: LabRepository[]
}

/** The Lab's repositories that this organization owns, as owner/name pairs
 * — GitHub compares owners case-insensitively. */
function orgRepositories(organization: string, repositories: LabRepository[]): { owner: string; name: string }[] {
  return repositories.flatMap((repository) => {
    const parsed = parseRepositoryUrl(repository.url)
    if (!parsed) return []
    if (parsed.owner.toLowerCase() !== organization.toLowerCase()) {
      console.warn(`lab access: ${repository.url} is outside ${organization} — no team grant`)
      return []
    }
    return [{ owner: parsed.owner, name: parsed.name }]
  })
}

/** Creates the role's team if needed (closed, so it can be a code owner)
 * and grants it its permission on every Lab repository. Idempotent — safe
 * to run on every add. Returns whether the team is ready for members. */
async function ensureLabTeam(organization: string, lab: LabRef, role: LabRole): Promise<boolean> {
  const teamSlug = labTeamSlug(lab.slug, role)
  if (!(await ensureGitHubTeam(organization, teamSlug, { privacy: 'closed' }))) return false
  for (const repository of orgRepositories(organization, lab.repositories)) {
    await grantTeamRepository(organization, teamSlug, repository.owner, repository.name, LAB_TEAM_PERMISSIONS[role])
  }
  return true
}

/**
 * Someone was just put on a Lab with `role`, or switched to it from
 * `previousRole`. Invites them to the org first if they were never invited
 * (team membership needs org membership — the same step grantTrackAccess
 * takes), adds them to the role's team, and on a switch takes them out of
 * the old role's team.
 */
export async function grantLabAccess(contributor: Contributor, lab: LabRef, role: LabRole, previousRole: LabRole | null): Promise<void> {
  try {
    const config = await getAppConfig()
    const organization = config?.githubOrganization
    if (!organization) return

    if (!contributor.githubOrgInvitedAt) await inviteConfirmedContributor(contributor)

    if (await ensureLabTeam(organization, lab, role)) {
      await addToGitHubTeam(contributor.githubLogin, organization, labTeamSlug(lab.slug, role))
    }
    if (previousRole && previousRole !== role) {
      await removeFromGitHubTeam(contributor.githubLogin, organization, labTeamSlug(lab.slug, previousRole))
    }
  } catch (error) {
    console.error(`grantLabAccess(${contributor.githubId}, ${lab.slug}, ${role}) failed:`, error)
  }
}

/** Someone holding `role` was just taken off a Lab: out of the role's team.
 * Org membership is untouched — it was never the Lab's to give. */
export async function revokeLabAccess(contributor: Contributor, lab: LabRef, role: LabRole): Promise<void> {
  try {
    const config = await getAppConfig()
    const organization = config?.githubOrganization
    if (!organization) return

    await removeFromGitHubTeam(contributor.githubLogin, organization, labTeamSlug(lab.slug, role))
  } catch (error) {
    console.error(`revokeLabAccess(${contributor.githubId}, ${lab.slug}, ${role}) failed:`, error)
  }
}

function repositoryKey(repository: { owner: string; name: string }): string {
  return `${repository.owner}/${repository.name}`.toLowerCase()
}

/**
 * A Lab's repository list was just edited. Each newly listed repository is
 * granted to both teams, and each dropped one is taken away from both —
 * but only for a team that has members to use it: a role nobody holds yet
 * gets its team (and grants) on the first add, via grantLabAccess.
 */
export async function syncLabRepositories(
  lab: LabRef & { roles: LabRole[] },
  before: LabRepository[],
): Promise<void> {
  try {
    const config = await getAppConfig()
    const organization = config?.githubOrganization
    if (!organization) return

    const previous = orgRepositories(organization, before)
    const current = orgRepositories(organization, lab.repositories)
    const previousKeys = new Set(previous.map(repositoryKey))
    const currentKeys = new Set(current.map(repositoryKey))
    const added = current.filter((repository) => !previousKeys.has(repositoryKey(repository)))
    const removed = previous.filter((repository) => !currentKeys.has(repositoryKey(repository)))

    for (const role of LAB_ROLES) {
      const teamSlug = labTeamSlug(lab.slug, role)
      if (lab.roles.includes(role)) {
        for (const repository of added) {
          await grantTeamRepository(organization, teamSlug, repository.owner, repository.name, LAB_TEAM_PERMISSIONS[role])
        }
      }
      // Removal doesn't depend on who holds the role now: a team emptied
      // since may still hold the grant from when it had members.
      for (const repository of removed) {
        await removeTeamRepository(organization, teamSlug, repository.owner, repository.name)
      }
    }
  } catch (error) {
    console.error(`syncLabRepositories(${lab.slug}) failed:`, error)
  }
}

/**
 * A Lab was just deleted: every person on it leaves their team, and both
 * teams lose every Lab repository. The emptied teams themselves are left in
 * place — deleting a GitHub team is not something this app does anywhere,
 * and one with no members and no repositories grants nothing.
 */
export async function revokeDeletedLabAccess(
  lab: LabRef,
  people: { contributor: Contributor; role: LabRole }[],
): Promise<void> {
  try {
    const config = await getAppConfig()
    const organization = config?.githubOrganization
    if (!organization) return

    for (const { contributor, role } of people) {
      await removeFromGitHubTeam(contributor.githubLogin, organization, labTeamSlug(lab.slug, role))
    }
    for (const role of LAB_ROLES) {
      for (const repository of orgRepositories(organization, lab.repositories)) {
        await removeTeamRepository(organization, labTeamSlug(lab.slug, role), repository.owner, repository.name)
      }
    }
  } catch (error) {
    console.error(`revokeDeletedLabAccess(${lab.slug}) failed:`, error)
  }
}
