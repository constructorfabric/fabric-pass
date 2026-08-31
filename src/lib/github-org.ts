import { env } from '@/lib/env'

const GITHUB_API_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
}

/**
 * IDEA-041 — sends a GitHub organization invitation via
 * `PUT /orgs/{org}/memberships/{username}`. This is a real invite, not
 * instant membership: GitHub emails the invitee and they still have to
 * accept it — there's no API that silently adds someone to an org without
 * their own action, which is exactly the security property you'd want.
 *
 * Never throws — best-effort, same discipline as lib/email.ts's send():
 * the caller (admin/actions.ts's setContributorStatusAction) has already
 * committed the Confirm action by the time this runs, and a GitHub API
 * hiccup must not read as if Confirm itself failed. Returns false, not an
 * error, when GITHUB_ORG_TOKEN isn't configured at all.
 */
export async function inviteToGitHubOrg(githubLogin: string, organization: string): Promise<boolean> {
  if (!env.GITHUB_ORG_TOKEN) {
    console.warn(`GITHUB_ORG_TOKEN not configured — would have invited ${githubLogin} to ${organization}`)
    return false
  }

  try {
    const response = await fetch(`https://api.github.com/orgs/${organization}/memberships/${githubLogin}`, {
      method: 'PUT',
      headers: {
        ...GITHUB_API_HEADERS,
        Authorization: `Bearer ${env.GITHUB_ORG_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role: 'member' }),
    })
    if (!response.ok) {
      console.error(`inviteToGitHubOrg(${githubLogin}, ${organization}) failed: GitHub responded ${response.status} ${await response.text()}`)
      return false
    }
    return true
  } catch (error) {
    console.error(`inviteToGitHubOrg(${githubLogin}, ${organization}) failed:`, error)
    return false
  }
}

/**
 * IDEA-115 — `GET /orgs/{org}/teams/{team_slug}`, factored out of
 * ensureGitHubTeam below so a caller that must *never* create a team (the
 * internal-readers grant — an app-created team with no repo permissions
 * wired up would silently claim a grant that doesn't exist) can check
 * existence without its creation side effect. Same never-throw,
 * `GITHUB_ORG_TOKEN`-gated discipline as every function in this file.
 */
export async function teamExists(organization: string, teamSlug: string): Promise<boolean> {
  if (!env.GITHUB_ORG_TOKEN) {
    console.warn(`GITHUB_ORG_TOKEN not configured — would have checked team ${organization}/${teamSlug} exists`)
    return false
  }

  try {
    const response = await fetch(`https://api.github.com/orgs/${organization}/teams/${teamSlug}`, {
      headers: { ...GITHUB_API_HEADERS, Authorization: `Bearer ${env.GITHUB_ORG_TOKEN}` },
    })
    if (response.ok) return true
    if (response.status !== 404) {
      console.error(`teamExists(${organization}, ${teamSlug}) failed: GitHub responded ${response.status} ${await response.text()}`)
    }
    return false
  } catch (error) {
    console.error(`teamExists(${organization}, ${teamSlug}) failed:`, error)
    return false
  }
}

/**
 * IDEA-060 — creates a track's GitHub team if it doesn't already exist yet,
 * via teamExists above then, on a miss, `POST /orgs/{org}/teams`. `teamSlug`
 * is passed straight through as `name` — it's already lowercase-hyphenated
 * (computed from a track's own slug plus the configured pattern, see
 * lib/team-access.ts), so GitHub's own name -> slug derivation lands on
 * exactly this slug, and the membership PUT that follows addresses the team
 * GitHub actually created. Same never-throw, best-effort discipline as
 * inviteToGitHubOrg. Returns `true` when the team is confirmed to exist
 * either way (already there, or just created) — the caller uses that to
 * decide whether attempting the membership PUT is even worth it.
 */
export async function ensureGitHubTeam(organization: string, teamSlug: string): Promise<boolean> {
  if (!env.GITHUB_ORG_TOKEN) {
    console.warn(`GITHUB_ORG_TOKEN not configured — would have ensured team ${organization}/${teamSlug} exists`)
    return false
  }

  try {
    if (await teamExists(organization, teamSlug)) return true

    const created = await fetch(`https://api.github.com/orgs/${organization}/teams`, {
      method: 'POST',
      headers: {
        ...GITHUB_API_HEADERS,
        Authorization: `Bearer ${env.GITHUB_ORG_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: teamSlug }),
    })
    if (!created.ok) {
      console.error(
        `ensureGitHubTeam(${organization}, ${teamSlug}) failed to create: GitHub responded ${created.status} ${await created.text()}`,
      )
      return false
    }
    return true
  } catch (error) {
    console.error(`ensureGitHubTeam(${organization}, ${teamSlug}) failed:`, error)
    return false
  }
}

/**
 * IDEA-042 — adds a contributor to a track's GitHub team via
 * `PUT /orgs/{org}/teams/{team_slug}/memberships/{username}`. Requires the
 * same `admin:org`-level token as inviteToGitHubOrg above (or, at minimum,
 * org-admin/team-maintainer permission over that specific team) — reuses
 * GITHUB_ORG_TOKEN, no separate credential. Same never-throw, best-effort
 * discipline as inviteToGitHubOrg. Callers needing the team to exist first
 * (a track's own team may not, IDEA-060) should call ensureGitHubTeam above
 * before this.
 */
export async function addToGitHubTeam(githubLogin: string, organization: string, teamSlug: string): Promise<boolean> {
  if (!env.GITHUB_ORG_TOKEN) {
    console.warn(`GITHUB_ORG_TOKEN not configured — would have added ${githubLogin} to ${organization}/${teamSlug}`)
    return false
  }

  try {
    const response = await fetch(
      `https://api.github.com/orgs/${organization}/teams/${teamSlug}/memberships/${githubLogin}`,
      {
        method: 'PUT',
        headers: {
          ...GITHUB_API_HEADERS,
          Authorization: `Bearer ${env.GITHUB_ORG_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: 'member' }),
      },
    )
    if (!response.ok) {
      console.error(
        `addToGitHubTeam(${githubLogin}, ${organization}, ${teamSlug}) failed: GitHub responded ${response.status} ${await response.text()}`,
      )
      return false
    }
    return true
  } catch (error) {
    console.error(`addToGitHubTeam(${githubLogin}, ${organization}, ${teamSlug}) failed:`, error)
    return false
  }
}

/**
 * IDEA-062 — the mirror of addToGitHubTeam above, via
 * `DELETE /orgs/{org}/teams/{team_slug}/memberships/{username}`. A 404
 * (already not a member — a stale double-click, or a track they were only
 * ever granted the *other* of contributors/maintainers team for) is treated
 * as success, the same "already in the desired end state" reasoning
 * ensureGitHubTeam already uses for "the team already exists". Same
 * never-throw, best-effort discipline as every function in this file.
 */
export async function removeFromGitHubTeam(githubLogin: string, organization: string, teamSlug: string): Promise<boolean> {
  if (!env.GITHUB_ORG_TOKEN) {
    console.warn(`GITHUB_ORG_TOKEN not configured — would have removed ${githubLogin} from ${organization}/${teamSlug}`)
    return false
  }

  try {
    const response = await fetch(
      `https://api.github.com/orgs/${organization}/teams/${teamSlug}/memberships/${githubLogin}`,
      {
        method: 'DELETE',
        headers: { ...GITHUB_API_HEADERS, Authorization: `Bearer ${env.GITHUB_ORG_TOKEN}` },
      },
    )
    if (!response.ok && response.status !== 404) {
      console.error(
        `removeFromGitHubTeam(${githubLogin}, ${organization}, ${teamSlug}) failed: GitHub responded ${response.status} ${await response.text()}`,
      )
      return false
    }
    return true
  } catch (error) {
    console.error(`removeFromGitHubTeam(${githubLogin}, ${organization}, ${teamSlug}) failed:`, error)
    return false
  }
}

/**
 * IDEA-071's Revoke approval — the most destructive call in this file: full
 * removal from the organization itself, via
 * `DELETE /orgs/{org}/memberships/{username}`, not just one team (contrast
 * removeFromGitHubTeam above). Only ever called after a *second* Admin has
 * approved a pending revoke request (see admin/actions.ts's
 * approveRevokeAction) — this function itself has no notion of that
 * approval gate, it just performs the removal it's asked to. Same 404-is-
 * success, never-throw, `GITHUB_ORG_TOKEN`-gated discipline as every other
 * function here.
 */
export async function removeFromGitHubOrg(githubLogin: string, organization: string): Promise<boolean> {
  if (!env.GITHUB_ORG_TOKEN) {
    console.warn(`GITHUB_ORG_TOKEN not configured — would have removed ${githubLogin} from org ${organization}`)
    return false
  }

  try {
    const response = await fetch(`https://api.github.com/orgs/${organization}/memberships/${githubLogin}`, {
      method: 'DELETE',
      headers: { ...GITHUB_API_HEADERS, Authorization: `Bearer ${env.GITHUB_ORG_TOKEN}` },
    })
    if (!response.ok && response.status !== 404) {
      console.error(
        `removeFromGitHubOrg(${githubLogin}, ${organization}) failed: GitHub responded ${response.status} ${await response.text()}`,
      )
      return false
    }
    return true
  } catch (error) {
    console.error(`removeFromGitHubOrg(${githubLogin}, ${organization}) failed:`, error)
    return false
  }
}

/**
 * IDEA-107 — shared GET-and-paginate shape for the three read-only listing
 * functions below (the first pagination this file needs — every function
 * above targets one resource, never a collection wide enough to paginate).
 * Pages by `page=N` until a short page rather than parsing the `Link`
 * response header — simpler, and correct for this app's scale (the org has
 * ~70 repositories today, one page at per_page=100). Same never-throw,
 * `GITHUB_ORG_TOKEN`-gated, benign-empty-array-on-failure discipline as
 * every function above — `actionDescription` is folded into both the
 * "token not configured" warning and the failure error, so callers don't
 * each need their own duplicate try/catch.
 */
async function fetchAllPages<T>(path: string, actionDescription: string): Promise<T[]> {
  if (!env.GITHUB_ORG_TOKEN) {
    console.warn(`GITHUB_ORG_TOKEN not configured — would have ${actionDescription}`)
    return []
  }

  const results: T[] = []
  const perPage = 100
  // A hard ceiling, not a real expectation (the org has ~70 repositories
  // today) — a backstop against an unbounded loop if GitHub's response
  // shape ever changes under this code, not a limit meant to ever bind.
  const maxPages = 50
  try {
    for (let page = 1; page <= maxPages; page += 1) {
      const separator = path.includes('?') ? '&' : '?'
      const response = await fetch(`https://api.github.com${path}${separator}per_page=${perPage}&page=${page}`, {
        headers: { ...GITHUB_API_HEADERS, Authorization: `Bearer ${env.GITHUB_ORG_TOKEN}` },
      })
      if (!response.ok) {
        console.error(`${actionDescription} failed: GitHub responded ${response.status} ${await response.text()}`)
        return []
      }
      const batch = (await response.json()) as T[]
      results.push(...batch)
      if (batch.length < perPage) break
    }
  } catch (error) {
    console.error(`${actionDescription} failed:`, error)
    return []
  }
  return results
}

interface GitHubRepoResponse {
  name: string
  html_url: string
  archived: boolean
  private: boolean
}

export interface OrgRepository {
  name: string
  htmlUrl: string
  archived: boolean
  private: boolean
}

/** IDEA-107's Repositories screen — every repository in the org, via
 * `GET /orgs/{org}/repos`. Custom-property values come from a separate call
 * (listOrgRepositoryProperties below) — GitHub doesn't include them here. */
export async function listOrgRepositories(organization: string): Promise<OrgRepository[]> {
  const repos = await fetchAllPages<GitHubRepoResponse>(`/orgs/${organization}/repos`, `listed repositories for ${organization}`)
  return repos.map((repo) => ({ name: repo.name, htmlUrl: repo.html_url, archived: repo.archived, private: repo.private }))
}

interface GitHubPropertyValueResponse {
  repository_name: string
  properties: { property_name: string; value: string | null }[]
}

export interface RepoCustomProperties {
  repoName: string
  /** Keyed by the org's actual property names (e.g. "Type", "Track"), read
   * from GitHub's response as-is — not hardcoded here, so a renamed or
   * added property shows up without a code change. */
  properties: Record<string, string | null>
}

/** IDEA-107's Repositories screen — every repository's custom-property
 * values, via `GET /orgs/{org}/properties/values` (one bulk call, not one
 * request per repository). */
export async function listOrgRepositoryProperties(organization: string): Promise<RepoCustomProperties[]> {
  const rows = await fetchAllPages<GitHubPropertyValueResponse>(
    `/orgs/${organization}/properties/values`,
    `listed repository custom properties for ${organization}`,
  )
  return rows.map((row) => ({
    repoName: row.repository_name,
    properties: Object.fromEntries(row.properties.map((property) => [property.property_name, property.value])),
  }))
}

interface GitHubPropertySchemaResponse {
  property_name: string
  value_type: string
  allowed_values?: string[]
}

export interface OrgPropertySchema {
  name: string
  allowedValues: string[]
}

/** IDEA-107's Repositories screen — the allowed values for each
 * `single_select` custom property, via `GET /orgs/{org}/properties/schema`
 * — what the filter dropdowns' options come from, not hardcoded either.
 * Properties of any other value_type (free text, multi-select, ...) have
 * no fixed set of values to build a dropdown from, so they're filtered out
 * here rather than surfaced with an empty options list. */
export async function listOrgPropertySchema(organization: string): Promise<OrgPropertySchema[]> {
  const rows = await fetchAllPages<GitHubPropertySchemaResponse>(
    `/orgs/${organization}/properties/schema`,
    `listed custom property schema for ${organization}`,
  )
  return rows
    .filter((row) => row.value_type === 'single_select')
    .map((row) => ({ name: row.property_name, allowedValues: row.allowed_values ?? [] }))
}
