import { Card, CardDescription, CardHeader, CardTitle } from '@gears-frontx/ui-kit'
import Link from 'next/link'
import { findByGithubId } from '@/lib/contributors'
import { getSession } from '@/lib/session'
import { listTracks } from '@/lib/tracks'
import { SignInPrompt } from '@/app/sign-in-prompt'

const LEADER_SLOTS = [
  'productManagerGithubId',
  'architectGithubId',
  'developerGithubId',
  'qualityGithubId',
  'researcherGithubId',
] as const

/**
 * IDEA-007 — the compact directory half of the track directory/track page
 * split (see IDEA-035's own page for the full detail view this links out
 * to). Always reads live from `tracks` via listTracks() — no hardcoded
 * list, so a track added/renamed/removed in pass/tracks.yaml shows up here
 * with no code change.
 *
 * Reuses the Admin page's tile styles (.admin-tile*, IDEA-036/037) rather
 * than inventing a new card look — full-width, name as the primary
 * identifier, everything else a small labelled property underneath.
 */
export default async function TracksPage() {
  const session = await getSession()
  if (!session.github) return <SignInPrompt />

  const contributor = await findByGithubId(session.github.id)
  if (!contributor) return <SignInPrompt />

  const tracks = await listTracks()

  return (
    <>
      <h2>Tracks</h2>
      <p className="subtitle">Every track in Constructor Fabric — select one to see its full page.</p>
      <div className="admin-tiles">
        {tracks.map((track) => {
          const leaderCount = LEADER_SLOTS.filter((slot) => track[slot]).length
          return (
            <Card size="sm" key={track.slug}>
              <CardHeader>
                <CardTitle>
                  <h3 className="card-heading">
                    <Link href={`/tracks/${track.slug}`}>{track.name}</Link>
                  </h3>
                </CardTitle>
                {track.description ? <CardDescription>{track.description}</CardDescription> : null}
                {/* .admin-tile-properties (the labelled chips) stays the
                    app's own — the kit Card has no property-list part. Kept
                    in the header rather than a CardContent so a track card
                    reads as one block, matching the old tile's density. */}
                <div className="admin-tile-properties">
                  <span className="admin-tile-property">
                    {track.repositories.length} {track.repositories.length === 1 ? 'repository' : 'repositories'}
                  </span>
                  <span className="admin-tile-property">
                    {leaderCount} {leaderCount === 1 ? 'leader' : 'leaders'}
                  </span>
                </div>
              </CardHeader>
            </Card>
          )
        })}
      </div>
    </>
  )
}
