import { NextResponse } from 'next/server'
import { syncArtifactLinks } from '@/lib/artifact-links'
import { parseArtifactLinksYaml } from '@/lib/artifact-links-registry'
import { env } from '@/lib/env'
import { syncEvents } from '@/lib/events'
import { isAuthorized } from '@/lib/internal-auth'

/** Called by cf-internal's push-triggered shim workflow whenever
 * pass/artifact-links.yaml changes. One-way — see artifact-links.ts's
 * module doc — so there's no matching export route. IDEA-165 — the same
 * file's `events:` list rides along on this call (see lib/events.ts), so
 * events need no secret or shim workflow of their own. */
export async function POST(request: Request) {
  if (!isAuthorized(request, env.ARTIFACT_LINKS_SYNC_SECRET)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const body = await request.text()
  const { links, invalidRowCount, events, invalidEventCount } = parseArtifactLinksYaml(body)
  const { synced, rejected } = await syncArtifactLinks(links)
  const eventsSynced = await syncEvents(events)

  if (invalidRowCount > 0) {
    console.warn(`artifact-links sync: ${invalidRowCount} row(s) skipped — missing/invalid scope, category, label, or url`)
  }
  if (rejected > 0) {
    console.warn(`artifact-links sync: ${rejected} row(s) skipped — scope names neither "community" nor a real track slug`)
  }

  if (invalidEventCount > 0) {
    console.warn(`artifact-links sync: ${invalidEventCount} event(s) skipped — missing/invalid title, dates, or urls`)
  }

  return NextResponse.json({
    synced,
    skipped: invalidRowCount + rejected,
    events: { synced: eventsSynced, skipped: invalidEventCount },
  })
}
