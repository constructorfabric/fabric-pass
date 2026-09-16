import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { authenticateApiKey } from '@/lib/api-auth'
import { getPublicProfile } from '@/lib/contributors'
import { isAdmin } from '@/lib/roles'
import { listTrackParticipation } from '@/lib/track-members'

/**
 * IDEA-120 — any valid personal API key (IDEA-119). Returns exactly the
 * same fields the public profile screen shows for this contributor's own
 * row, via the same `getPublicProfile` call `/contributors/[hash]` itself
 * renders from — the two can't drift apart on their own, since a change to
 * what that function returns reaches both at once.
 *
 * 404s (not an empty 200) when the contributor's own profile hasn't
 * resolved yet — `getPublicProfile` only ever resolves a `confirmed`
 * contributor, the same gate the public profile page itself has.
 *
 * IDEA-110 — passes the authenticated `contributor` itself as the viewer,
 * not a stranger's `{ isAdmin: false }`: this endpoint only ever returns
 * the caller's *own* profile, so an API key holder must keep seeing their
 * own locked Telegram/LinkedIn here exactly as they would on /profile.
 */
export async function GET(request: Request) {
  const contributor = await authenticateApiKey(request)
  if (!contributor) return new NextResponse('Unauthorized', { status: 401 })

  const hash = createHash('md5').update(contributor.id).digest('hex')
  const profile = await getPublicProfile(hash, { githubId: contributor.githubId, isAdmin: isAdmin(contributor) })
  if (!profile) {
    return new NextResponse("Profile not available yet — your account isn't confirmed.", { status: 404 })
  }

  const tracks = await listTrackParticipation(contributor.githubId)
  return NextResponse.json({ ...profile, tracks })
}
