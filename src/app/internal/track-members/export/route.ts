import { NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { isAuthorized } from '@/lib/internal-auth'
import { toTrackMembersYaml } from '@/lib/track-members-registry'
import { listAllApprovedTrackMemberships } from '@/lib/track-members'

/**
 * IDEA-123 — called by fabric-pass's own scheduled export workflow (see
 * .github/workflows/export-track-members.yml), which writes the response
 * straight into cf-internal's pass/track-members.yaml — same shape as the
 * existing contributors export (internal/contributors/export/route.ts).
 * One-way: track participation is entirely owned by this app's own
 * join-request/approval flow, so there's nothing for cf-internal to hand
 * back — unlike contributors, no matching import route.
 */
export async function GET(request: Request) {
  if (!isAuthorized(request, env.TRACK_MEMBERS_EXPORT_SECRET)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }
  const memberships = await listAllApprovedTrackMemberships()
  return new NextResponse(toTrackMembersYaml(memberships), {
    headers: { 'content-type': 'application/yaml; charset=utf-8' },
  })
}
