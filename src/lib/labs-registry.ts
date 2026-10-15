import { stringify } from 'yaml'
import type { Lab } from '@/lib/labs'

interface LabRepositoryEntry {
  url: string
  description?: string
}

interface LabEntry {
  slug: string
  name: string
  description?: string
  repositories: LabRepositoryEntry[]
  leaders: string[]
  maintainers: string[]
}

/**
 * IDEA-156's cf-internal export — `pass/labs.yaml`. One-way, the same
 * direction as `track-members-registry.ts`'s export: Labs are created and
 * edited only in this app, so there is no matching import route.
 *
 * Shaped after `pass/tracks.yaml` so the two files read alike: people are
 * listed by GitHub login (what a human reading the file recognizes), not the
 * numeric id this app keys on.
 */
export function toLabsYaml(labs: Lab[]): string {
  const entries: LabEntry[] = labs.map((lab) => ({
    slug: lab.slug,
    name: lab.name,
    ...(lab.description ? { description: lab.description } : {}),
    repositories: lab.repositories.map((repository) => ({
      url: repository.url,
      ...(repository.description ? { description: repository.description } : {}),
    })),
    leaders: lab.people.filter((person) => person.role === 'leader').map((person) => person.githubLogin),
    maintainers: lab.people.filter((person) => person.role === 'maintainer').map((person) => person.githubLogin),
  }))
  return stringify({ labs: entries })
}
