import { NextResponse, type NextRequest } from 'next/server'
import { COMMUNITY_SCOPE, listArtifactLinks } from '@/lib/artifact-links'
import { markPolicyLinkClicked } from '@/lib/contributors'
import { getSession } from '@/lib/session'

/**
 * IDEA-047 — every policy link on /policies routes through here instead of
 * pointing straight at the external URL, so a click (not just landing on
 * the page) can be recorded as the "read the community policies" checklist
 * item's done signal.
 *
 * `url` is checked against the actual policy links currently in the
 * registry, not redirected to blindly — this endpoint is otherwise a
 * textbook open redirect (any signed-in visitor could be sent a link to
 * this app's own trusted domain that silently forwards them anywhere,
 * `/policies/visit?url=https://evil.example`). The set of valid
 * destinations is small and entirely controlled by cf-internal's
 * pass/artifact-links.yaml, so allowlisting against it costs nothing.
 *
 * Tracking is best-effort and never blocks the redirect: a visitor who
 * isn't signed in (shouldn't normally reach this, since /policies itself
 * requires sign-in, but nothing stops a direct request) still gets sent to
 * the real document, just without a click recorded.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url')
  if (!url) return new NextResponse('Missing url', { status: 400 })

  const links = await listArtifactLinks(COMMUNITY_SCOPE)
  const isKnownPolicyLink = links.some((link) => link.category === 'policy' && link.url === url)
  if (!isKnownPolicyLink) return new NextResponse('Unknown policy link', { status: 400 })

  const session = await getSession()
  if (session.github) await markPolicyLinkClicked(session.github.id)

  return NextResponse.redirect(url, 302)
}
