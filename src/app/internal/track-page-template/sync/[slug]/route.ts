import { NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { isAuthorized } from '@/lib/internal-auth'
import { findTrackBySlug } from '@/lib/tracks'
import { syncTrackPageTemplate } from '@/lib/track-page-template'

interface RouteParams {
  params: Promise<{ slug: string }>
}

/**
 * IDEA-117 — called by cf-internal's push-triggered shim workflow once per
 * changed `pass/track-pages/<slug>.md` file, the URL's `slug` matching the
 * filename. One-way — see track-page-template.ts's module doc — so there's
 * no matching export route. No parsing step: the whole request body *is*
 * the template, stored as-is. A slug with no matching track 404s rather
 * than silently no-op-ing on what would otherwise look like a successful
 * sync (e.g. a typo'd filename in cf-internal).
 */
export async function POST(request: Request, { params }: RouteParams) {
  if (!isAuthorized(request, env.TRACK_PAGE_TEMPLATE_SYNC_SECRET)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const { slug } = await params
  const track = await findTrackBySlug(slug)
  if (!track) return new NextResponse(`No track with slug ${slug}`, { status: 404 })

  const content = await request.text()
  await syncTrackPageTemplate(track.id, content)

  return NextResponse.json({ synced: true })
}
