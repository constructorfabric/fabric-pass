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
 * IDEA-060 — creates a track's GitHub team if it doesn't already exist yet,
 * via `GET /orgs/{org}/teams/{team_slug}` then, on a 404, `POST
 * /orgs/{org}/teams`. `teamSlug` is passed straight through as `name` —
 * it's already lowercase-hyphenated (computed from a track's own slug plus
 * the configured pattern, see lib/team-access.ts), so GitHub's own
 * name -> slug derivation lands on exactly this slug, and the membership
 * PUT that follows addresses the team GitHub actually created. Same
 * never-throw, best-effort discipline as inviteToGitHubOrg. Returns `true`
 * when the team is confirmed to exist either way (already there, or just
 * created) — the caller uses that to decide whether attempting the
 * membership PUT is even worth it.
 */
export async function ensureGitHubTeam(organization: string, teamSlug: string): Promise<boolean> {
  if (!env.GITHUB_ORG_TOKEN) {
    console.warn(`GITHUB_ORG_TOKEN not configured — would have ensured team ${organization}/${teamSlug} exists`)
    return false
  }

  try {
    const existing = await fetch(`https://api.github.com/orgs/${organization}/teams/${teamSlug}`, {
      headers: { ...GITHUB_API_HEADERS, Authorization: `Bearer ${env.GITHUB_ORG_TOKEN}` },
    })
    if (existing.ok) return true
    if (existing.status !== 404) {
      console.error(
        `ensureGitHubTeam(${organization}, ${teamSlug}) failed: GitHub responded ${existing.status} ${await existing.text()}`,
      )
      return false
    }

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
