import { NextResponse } from 'next/server'
import { authenticateApiKey, authenticateApplicationApiKey } from '@/lib/api-auth'
import { listContributorsForRegistry } from '@/lib/contributors'
import { isAdmin } from '@/lib/roles'
import { listTrackParticipation } from '@/lib/track-members'

async function listMemberRows() {
  const contributors = await listContributorsForRegistry()
  return Promise.all(
    contributors.map(async (contributor) => ({
      githubLogin: contributor.githubLogin,
      name: contributor.name,
      email: contributor.email,
      company: contributor.company,
      discordUsername: contributor.discordUsername,
      telegramUsername: contributor.telegramUsername,
      telegramPhone: contributor.telegramPhone,
      linkedinName: contributor.linkedinName,
      status: contributor.status,
      tracks: await listTrackParticipation(contributor.githubId),
    })),
  )
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
