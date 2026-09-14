import { NextResponse } from 'next/server'
import { getAppConfig } from '@/lib/app-config'
import { env } from '@/lib/env'
import { isAuthorized } from '@/lib/internal-auth'
import { seedContributorsFromOrg } from '@/lib/org-seed'

/**
 * IDEA-143 — creates a `draft` contributors row for every GitHub org member
 * this app doesn't already have a row for, closing the gap
 * `/internal/contributors/sync` above can't: that route only ever updates
 * a row matched by `github_id`, so an org member who has never signed in
 * through GitHub OAuth has no row for it to match. See org-seed.ts's
 * seedContributorsFromOrg for the seeding itself.
 *
 * Its own secret, `CONTRIBUTORS_SEED_SECRET` — not a reuse of
 * `CONTRIBUTORS_SYNC_SECRET` — so either can be rotated or revoked
 * independently even though both guard routes under this same
 * `/internal/contributors/` path, same reasoning every other cf-internal
 * sync secret in this app already follows.
 *
 * Unlike lib/invites.ts's best-effort GitHub calls (which silently no-op
 * with `GITHUB_ORG_TOKEN` unset, since the action that triggers them has
 * already succeeded by the time they run), this route's entire purpose
 * *is* the GitHub read — a missing token here isn't a side effect worth
 * swallowing, it's the whole request having nothing to do, so it's
 * reported as a 503 instead of a silent no-op.
 */
export async function POST(request: Request) {
  if (!isAuthorized(request, env.CONTRIBUTORS_SEED_SECRET)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const config = await getAppConfig()
  if (!config?.githubOrganization) {
    return NextResponse.json({ error: 'github_organization is not configured' }, { status: 409 })
  }

  if (!env.GITHUB_ORG_TOKEN) {
    return NextResponse.json({ error: 'GITHUB_ORG_TOKEN is not configured' }, { status: 503 })
  }

  const { members, created, existing, unresolved } = await seedContributorsFromOrg(config.githubOrganization)
  return NextResponse.json({ members, created: created.length, existing, unresolved })
}
