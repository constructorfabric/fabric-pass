/**
 * IDEA-156 — the Lab vocabulary and form checks with no database behind
 * them, split out of labs.ts so client components can import them (the
 * same reason track-leader-roles.ts exists beside tracks.ts). labs.ts
 * re-exports everything here.
 */

export const LAB_ROLES = ['leader', 'maintainer'] as const
export type LabRole = (typeof LAB_ROLES)[number]

export const LAB_ROLE_LABELS: Record<LabRole, string> = {
  leader: 'Leader',
  maintainer: 'Maintainer',
}

export function isLabRole(value: string): value is LabRole {
  return (LAB_ROLES as readonly string[]).includes(value)
}

export interface LabRepository {
  /** Always the canonical `https://github.com/<owner>/<repo>` form —
   * parseRepositoryUrl normalizes whatever the Admin typed. */
  url: string
  description?: string
}

/** Mirrors migrations/041_labs.sql's CHECK on labs.slug — lowercase words
 * joined by single hyphens, the shape of a GitHub team slug, since IDEA-157
 * names the Lab's teams after it. */
const LAB_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function isValidLabSlug(slug: string): boolean {
  return LAB_SLUG_PATTERN.test(slug)
}

/** "Agentic Search (v2)" -> "agentic-search-v2": the slug the create form
 * proposes from the name. The Admin can still type their own. */
export function slugifyLabName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Accepts the forms an Admin realistically pastes — a full URL, one without
 * the scheme, or a bare `owner/repo` — with or without a trailing `.git` or
 * slash, and returns the canonical `https://github.com/<owner>/<repo>`.
 * `null` for anything that doesn't name exactly one GitHub repository; a
 * deeper path (`…/tree/main`) is rejected rather than truncated, since it
 * usually means the wrong thing was copied.
 */
export function parseRepositoryUrl(input: string): { url: string; owner: string; name: string } | null {
  const trimmed = input
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^(www\.)?github\.com\//i, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
  const match = /^([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9._-]+)$/.exec(trimmed)
  if (!match || match[2] === '.' || match[2] === '..') return null
  const [, owner, name] = match
  return { url: `https://github.com/${owner}/${name}`, owner, name }
}

/** Two entries naming the same repository (compared case-insensitively, as
 * GitHub does) collapse into the first; its description wins. */
export function dedupeRepositories(repositories: LabRepository[]): LabRepository[] {
  const seen = new Set<string>()
  return repositories.filter((repository) => {
    const key = repository.url.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export interface LabInput {
  name: string
  description?: string
  repositories: LabRepository[]
}

export interface LabCandidate {
  githubId: string
  githubLogin: string
  name?: string
}

export const MAX_LAB_NAME_LENGTH = 100
export const MAX_LAB_DESCRIPTION_LENGTH = 2000
export const MAX_LAB_REPOSITORIES = 20

/**
 * The create/edit form's values, checked and normalized before anything is
 * written. A server action is an HTTP endpoint, so `raw` is treated as
 * untrusted whatever the client's types said: every field is type-checked
 * here, not assumed. Blank repository rows are dropped (the form always
 * shows one empty row to type into); a non-blank one that doesn't name a
 * GitHub repository fails the whole save, naming the offending value.
 */
export function normalizeLabInput(raw: unknown): { ok: true; input: LabInput } | { ok: false; message: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, message: 'Invalid form data.' }
  const { name, description, repositories } = raw as Record<string, unknown>

  const trimmedName = typeof name === 'string' ? name.trim() : ''
  if (!trimmedName) return { ok: false, message: 'A Lab needs a name.' }
  if (trimmedName.length > MAX_LAB_NAME_LENGTH) {
    return { ok: false, message: `The name can be at most ${MAX_LAB_NAME_LENGTH} characters.` }
  }

  const trimmedDescription = typeof description === 'string' ? description.trim() : ''
  if (trimmedDescription.length > MAX_LAB_DESCRIPTION_LENGTH) {
    return { ok: false, message: `The description can be at most ${MAX_LAB_DESCRIPTION_LENGTH} characters.` }
  }

  if (!Array.isArray(repositories)) return { ok: false, message: 'Invalid form data.' }
  const parsed: LabRepository[] = []
  for (const row of repositories) {
    if (typeof row !== 'object' || row === null) return { ok: false, message: 'Invalid form data.' }
    const { url, description: repositoryDescription } = row as Record<string, unknown>
    const rawUrl = typeof url === 'string' ? url.trim() : ''
    const rawDescription = typeof repositoryDescription === 'string' ? repositoryDescription.trim() : ''
    if (!rawUrl && !rawDescription) continue
    const repository = parseRepositoryUrl(rawUrl)
    if (!repository) {
      return { ok: false, message: `"${rawUrl || rawDescription}" is not a GitHub repository — use https://github.com/<owner>/<repo>.` }
    }
    parsed.push({ url: repository.url, ...(rawDescription ? { description: rawDescription } : {}) })
  }
  const deduped = dedupeRepositories(parsed)
  if (deduped.length > MAX_LAB_REPOSITORIES) {
    return { ok: false, message: `A Lab can list at most ${MAX_LAB_REPOSITORIES} repositories.` }
  }

  return {
    ok: true,
    input: { name: trimmedName, ...(trimmedDescription ? { description: trimmedDescription } : {}), repositories: deduped },
  }
}
