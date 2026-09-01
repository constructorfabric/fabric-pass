import { NextResponse } from 'next/server'
import { authenticateApiKey, authenticateApplicationApiKey } from '@/lib/api-auth'
import { listContributorsForRegistry } from '@/lib/contributors'
import { isAdmin } from '@/lib/roles'
import { listCurrentCapacities } from '@/lib/track-capacity'
import { listTrackParticipation } from '@/lib/track-members'

/**
 * IDEA-128 — each `tracks` entry's capacity ratio (0-1, default 1, same as
 * the cf-internal export's own `capacity` field). Capacities are fetched
 * per distinct track rather than per contributor-track pair —
 * `listCurrentCapacities` already exists for exactly this "every current
 * ratio for this track at once" shape (built for the Track Admin
 * member-list screen), and this endpoint returns every contributor at
 * once, so the same batching avoids one query per row.
 */
async function listMemberRows() {
  const contributors = await listContributorsForRegistry()
  const participationByContributor = await Promise.all(
    contributors.map((contributor) => listTrackParticipation(contributor.githubId)),
  )

  const trackIds = new Set(participationByContributor.flat().map((track) => track.trackId))
  const capacitiesByTrack = new Map(
    await Promise.all(
      Array.from(trackIds, async (trackId) => [trackId, await listCurrentCapacities(trackId)] as const),
    ),
  )

  return contributors.map((contributor, index) => ({
    githubLogin: contributor.githubLogin,
    name: contributor.name,
    email: contributor.email,
    company: contributor.company,
    discordUsername: contributor.discordUsername,
    telegramUsername: contributor.telegramUsername,
    telegramPhone: contributor.telegramPhone,
    linkedinName: contributor.linkedinName,
    status: contributor.status,
    tracks: participationByContributor[index].map((track) => ({
      ...track,
      capacity: capacitiesByTrack.get(track.trackId)?.get(contributor.githubId) ?? 1,
    })),
  }))
}

/**
 * IDEA-120 — Fabric Admin only. Same `listContributorsForRegistry` call
 * the Admin table (`admin/page.tsx`) uses — "every contributor, across
 * every status," the same framing that screen's own subtitle already
 * gives it.
 *
 * IDEA-121 — also authorizes a valid application API key, since a member
 * directory is the one scope from IDEA-120's three endpoints that makes
 * sense for a non-human integration (unlike `/api/me`, tied to one person,
 * or a track's own `/api/tracks/<slug>/members`, tied to that track's own
 * admin). An application key is checked first — it's a decisive yes/no on
 * its own, with no separate role check the way a personal key needs.
 */
export async function GET(request: Request) {
  const applicationId = await authenticateApplicationApiKey(request)
  if (applicationId) return NextResponse.json(await listMemberRows())

  const caller = await authenticateApiKey(request)
  if (!caller) return new NextResponse('Unauthorized', { status: 401 })
  if (!isAdmin(caller)) return new NextResponse('Not authorized', { status: 403 })

  return NextResponse.json(await listMemberRows())
}
