import { NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { isAuthorized } from '@/lib/internal-auth'
import { toLabsYaml } from '@/lib/labs-registry'
import { listLabs } from '@/lib/labs'

/**
 * IDEA-156 — called by fabric-pass's own scheduled export workflow
 * (.github/workflows/export-labs.yml), which writes the response straight
 * into cf-internal's pass/labs.yaml — same shape as the track-members
 * export (internal/track-members/export/route.ts). One-way: Labs are edited
 * only in this app, so there's no matching import route.
 *
 * LABS_EXPORT_SECRET is optional (see env.ts) — with it unset there is no
 * secret to check a caller against, so the route reports itself as not
 * configured rather than answering anyone.
 */
export async function GET(request: Request) {
  if (!env.LABS_EXPORT_SECRET) {
    return new NextResponse('Labs export is not configured', { status: 503 })
  }
  if (!isAuthorized(request, env.LABS_EXPORT_SECRET)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }
  const labs = await listLabs()
  return new NextResponse(toLabsYaml(labs), {
    headers: { 'content-type': 'application/yaml; charset=utf-8' },
  })
}
