import { findContributorGithubIdByApiKey } from '@/lib/api-keys'
import { findByGithubId, type Contributor } from '@/lib/contributors'

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
  const header = request.headers.get('authorization') ?? ''
  const match = header.match(/^Bearer (.+)$/)
  if (!match) return null

  const githubId = await findContributorGithubIdByApiKey(match[1])
  if (!githubId) return null

  return findByGithubId(githubId)
}
