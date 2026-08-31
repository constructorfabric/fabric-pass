import { NextResponse } from 'next/server'
import { authenticateApiKey } from '@/lib/api-auth'
import { listContributorsForRegistry } from '@/lib/contributors'
import { isAdmin } from '@/lib/roles'
import { listTrackParticipation } from '@/lib/track-members'

/**
 * IDEA-120 — Fabric Admin only. Same `listContributorsForRegistry` call
 * the Admin table (`admin/page.tsx`) uses — "every contributor, across
 * every status," the same framing that screen's own subtitle already
 * gives it.
 */
export async function GET(request: Request) {
  const caller = await authenticateApiKey(request)
  if (!caller) return new NextResponse('Unauthorized', { status: 401 })
  if (!isAdmin(caller)) return new NextResponse('Not authorized', { status: 403 })

  const contributors = await listContributorsForRegistry()
  const rows = await Promise.all(
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

  return NextResponse.json(rows)
}
