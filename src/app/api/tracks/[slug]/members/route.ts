import { NextResponse } from 'next/server'
import { authenticateApiKey } from '@/lib/api-auth'
import { isAdmin, isTrackAdmin } from '@/lib/roles'
import { listTrackMembership, listTrackParticipation } from '@/lib/track-members'
import { findTrackBySlug } from '@/lib/tracks'

interface RouteParams {
  params: Promise<{ slug: string }>
}

/**
 * IDEA-120 — a Track Admin of this specific track, or a Fabric Admin. Same
 * `listTrackMembership` call the Track Admin review screen
 * (`tracks/admin/page.tsx`) uses for this same track, filtered to
 * `approved` — "a list of track contributors," not the pending-request
 * queue, which is a separate, in-progress decision this API doesn't expose.
 */
export async function GET(request: Request, { params }: RouteParams) {
  const caller = await authenticateApiKey(request)
  if (!caller) return new NextResponse('Unauthorized', { status: 401 })

  const { slug } = await params
  const track = await findTrackBySlug(slug)
  if (!track) return new NextResponse(`No track with slug ${slug}`, { status: 404 })

  const authorized = isAdmin(caller) || (await isTrackAdmin(caller.githubId, track.id))
  if (!authorized) return new NextResponse('Not authorized', { status: 403 })

  const members = await listTrackMembership(track.id)
  const approved = members.filter((member) => member.status === 'approved')

  const rows = await Promise.all(
    approved.map(async (member) => ({
      githubLogin: member.githubLogin,
      name: member.name,
      email: member.email,
      company: member.company,
      discordUsername: member.discordUsername,
      telegramUsername: member.telegramUsername,
      telegramPhone: member.telegramPhone,
      linkedinName: member.linkedinName,
      role: member.role,
      tracks: await listTrackParticipation(member.githubId),
    })),
  )

  return NextResponse.json(rows)
}
