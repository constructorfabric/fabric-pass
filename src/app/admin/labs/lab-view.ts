import type { LabRepository, LabRole } from '@/lib/lab-input'
import type { Lab } from '@/lib/labs'

/** IDEA-156 — what the Labs pages hand to their client components: plain,
 * serializable fields only, and a profile hash only where a public profile
 * actually resolves (a `confirmed` contributor), the same convention the
 * Track Leaders page follows. */
export interface LabPersonView {
  githubId: string
  githubLogin: string
  name: string | null
  role: LabRole
  profileHash: string | null
}

export interface LabView {
  slug: string
  name: string
  description: string
  repositories: LabRepository[]
  people: LabPersonView[]
}

export function toLabView(lab: Lab): LabView {
  return {
    slug: lab.slug,
    name: lab.name,
    description: lab.description ?? '',
    repositories: lab.repositories,
    people: lab.people.map((person) => ({
      githubId: person.githubId,
      githubLogin: person.githubLogin,
      name: person.name ?? null,
      role: person.role,
      profileHash: person.contributorStatus === 'confirmed' ? person.profileHash : null,
    })),
  }
}
