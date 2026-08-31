import { findContributorGithubIdByApiKey } from '@/lib/api-keys'
import { findApplicationByApiKey } from '@/lib/applications'
import { findByGithubId, type Contributor } from '@/lib/contributors'

function extractBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? ''
  const match = header.match(/^Bearer (.+)$/)
  return match ? match[1] : null
}

/**
 * IDEA-120 — extracts and verifies the `Authorization: Bearer <key>` header
 * on an incoming `/api/*` request, resolving it to the contributor it
 * belongs to. `null` for a missing/malformed header, an unknown key, or a
 * key whose contributor row is somehow gone — every one of these reads as
 * "not authenticated" to a caller, never an error to distinguish. This is
 * independent of the session-cookie auth every other page in this app
 * uses — an API key is its own credential, not a proxy for a browser
 * session.
 */
export async function authenticateApiKey(request: Request): Promise<Contributor | null> {
  const token = extractBearerToken(request)
  if (!token) return null

  const githubId = await findContributorGithubIdByApiKey(token)
  if (!githubId) return null

  return findByGithubId(githubId)
}

/** IDEA-121 — the same Bearer check as `authenticateApiKey` above, against
 * `application_api_keys` instead of `contributor_api_keys`. Returns the
 * application's own id, not a `Contributor` — an application isn't a
 * person, so there's no `Contributor` row for it to resolve to. */
export async function authenticateApplicationApiKey(request: Request): Promise<string | null> {
  const token = extractBearerToken(request)
  if (!token) return null

  return findApplicationByApiKey(token)
}
