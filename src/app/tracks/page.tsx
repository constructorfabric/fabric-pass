import { Button, Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@gears-frontx/ui-kit'
import Link from 'next/link'
import { findByGithubId } from '@/lib/contributors'
import { getSession } from '@/lib/session'
import { listTracks } from '@/lib/tracks'
import { PageHeader } from '@/app/page-header'
import { SignInPrompt } from '@/app/sign-in-prompt'

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
 *
 * IDEA-065 — dropped the leader/repository count chips a card used to carry:
 * both counts only restated detail the linked title already leads to on the
 * track's own page, and neither told a visitor anything actionable from the
 * dashboard itself. A "View track" button replaces them — the same
 * destination as the title link, just a second, more discoverable way in
 * for anyone who doesn't realize the heading itself is clickable.
 */
export default async function TracksPage() {
  const session = await getSession()
  if (!session.github) return <SignInPrompt />

  const contributor = await findByGithubId(session.github.id)
  if (!contributor) return <SignInPrompt />

  const tracks = await listTracks()

  return (
    <>
      <PageHeader title="Tracks" />
      <p className="subtitle">Every track in Constructor Fabric — select one to see its full page.</p>
      <div className="admin-tiles">
        {tracks.map((track) => (
          <Card size="sm" key={track.slug}>
            <CardHeader>
              <CardTitle>
                <h3 className="card-heading">
                  <Link href={`/tracks/${track.slug}`}>{track.name}</Link>
                </h3>
              </CardTitle>
              {track.description ? <CardDescription>{track.description}</CardDescription> : null}
            </CardHeader>
            <CardFooter>
              <Button
                render={<Link href={`/tracks/${track.slug}`} />}
                nativeButton={false}
                variant="outline"
                size="sm"
                aria-label={`View ${track.name}`}
              >
                View track
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </>
  )
}
