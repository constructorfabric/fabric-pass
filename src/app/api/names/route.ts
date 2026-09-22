import { NextResponse } from 'next/server'
import { findByGithubId, listNamesByLogins } from '@/lib/contributors'
import { getSession } from '@/lib/session'

/**
 * IDEA-145 — the browser extension's read path for turning a GitHub login
 * into the person's name, in place of the extension reading the whole
 * `pass/contributors.yaml` out of the private cf-internal repository.
 *
 * Authenticated by the `contributor_registry_session` cookie (`getSession`),
 * deliberately not a Bearer API key the way `/api/me` and `/api/members`
 * are: `/api/members` is Admin-only and returns the full registry with
 * contact details, and a personal key (IDEA-119/120) only ever reaches
 * `/api/me`, one contributor's own row. Neither shape fits a browser
 * extension that needs *other* people's names on every page it decorates,
 * and asking every contributor to paste an API key into an extension is
 * setup nobody will actually do. "Signed into pass in this browser" is
 * state a contributor already has, so the session cookie is the credential
 * that makes this endpoint usable at all.
 *
 * Accepted trade-off: this endpoint learns which GitHub logins a viewer is
 * looking at on any given page. That's why the query string is never
 * logged and every response carries `Cache-Control: no-store` — the same
 * mitigation, and the same names-only response, People search already
 * gives any signed-in contributor.
 *
 * `unknown` echoes back every requested login that didn't resolve — a bot
 * account, an outsider, a typo — so the extension can negative-cache it
 * and stop asking about that login on every subsequent page, rather than
 * re-querying for the same non-contributor forever.
 */
export const MAX_LOGINS_PER_REQUEST = 100

function noStore(body: unknown, status: number): NextResponse {
  const response =
    typeof body === 'string' ? new NextResponse(body, { status }) : NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

/** Trims each entry, drops empties, lowercases, and dedupes while keeping
 * first-seen order — the order `unknown` below then echoes back in. */
function parseLogins(raw: string | null): string[] {
  if (!raw) return []

  const seen = new Set<string>()
  const logins: string[] = []
  for (const piece of raw.split(',')) {
    const login = piece.trim().toLowerCase()
    if (!login || seen.has(login)) continue
    seen.add(login)
    logins.push(login)
  }
  return logins
}

export async function GET(request: Request) {
  const session = await getSession()
  const contributor = session.github ? await findByGithubId(session.github.id) : null
  if (!contributor) return noStore('Unauthorized', 401)

  const logins = parseLogins(new URL(request.url).searchParams.get('logins'))
  if (logins.length === 0) return noStore('Missing or empty logins parameter.', 400)
  if (logins.length > MAX_LOGINS_PER_REQUEST) {
    return noStore(`At most ${MAX_LOGINS_PER_REQUEST} logins are allowed per request.`, 400)
  }

  const namesByLogin = await listNamesByLogins(logins)
  const names: Record<string, string> = {}
  const unknown: string[] = []
  for (const login of logins) {
    const name = namesByLogin.get(login)
    if (name) names[login] = name
    else unknown.push(login)
  }

  return noStore({ names, unknown }, 200)
}
