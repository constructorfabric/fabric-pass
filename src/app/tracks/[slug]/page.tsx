import { createHash } from 'node:crypto'
import { notFound } from 'next/navigation'
import { listArtifactLinks } from '@/lib/artifact-links'
import { findByGithubId } from '@/lib/contributors'
import { getSession } from '@/lib/session'
import { getMyMembership } from '@/lib/track-members'
import { findTrackBySlug, type Track, type TrackLeaderRole } from '@/lib/tracks'
import { getTrackPageTemplate, renderTrackPage, type TrackPageLeader } from '@/lib/track-page-template'
import { Breadcrumb, HOME_BREADCRUMB } from '@/app/breadcrumb'
import { SignInPrompt } from '@/app/sign-in-prompt'
import { JoinTrack } from './join-track'

interface PageProps {
  params: Promise<{ slug: string }>
}

const ROLE_LABELS: Record<TrackLeaderRole, string> = {
  product_manager: 'Product Manager',
  architect: 'Architect',
  developer: 'Developer',
  quality: 'Quality',
  researcher: 'Researcher',
  governance: 'Governance',
}

/** Each leader's display label — always the contributor's GitHub login,
 * never their real name (this page is visible to any signed-in contributor,
 * not just the leader's own team) — linked to their public profile page,
 * keyed the same way getPublicProfile itself is (`md5(id)`, IDEA-055). A
 * leader whose github_id no longer resolves to a contributor row is
 * silently skipped rather than shown broken — shouldn't happen (tracks.ts's
 * syncTracks only ever writes a resolved id), but a row deleted out from
 * under a track since the last sync is exactly the kind of thing worth not
 * crashing the page over. */
async function resolveLeaders(track: Track): Promise<TrackPageLeader[]> {
  const leaders: TrackPageLeader[] = []
  for (const leader of track.leaders) {
    const contributor = await findByGithubId(leader.githubId)
    if (!contributor) continue
    const hash = createHash('md5').update(contributor.id).digest('hex')
    leaders.push({ role: ROLE_LABELS[leader.role], name: `@${contributor.githubLogin}`, profileUrl: `/contributors/${hash}` })
  }
  return leaders
}

/**
 * IDEA-035 — the detail half of the track directory/track page split (see
 * IDEA-007's directory, which links here). Rendered from cf-internal's one
 * shared markdown template (pass/track-page.md) with this track's own data
 * substituted in — see track-page-template.ts for exactly how.
 */
export default async function TrackPage({ params }: PageProps) {
  const session = await getSession()
  if (!session.github) return <SignInPrompt />

  const contributor = await findByGithubId(session.github.id)
  if (!contributor) return <SignInPrompt />

  const { slug } = await params
  const track = await findTrackBySlug(slug)
  if (!track) notFound()

  const [leaders, artifactLinks, template, membership] = await Promise.all([
    resolveLeaders(track),
    listArtifactLinks(track.slug),
    getTrackPageTemplate(track.id),
    getMyMembership(track.id, contributor.githubId),
  ])

  if (!template) {
    return (
      <>
        <Breadcrumb path={[HOME_BREADCRUMB, { label: 'Tracks', href: '/tracks' }]} />
        <h2>{track.name}</h2>
        <p className="subtitle">
          This track's page hasn't been set up yet — cf-internal's <code>pass/track-pages/{track.slug}.md</code> hasn't
          synced.
        </p>
        <JoinTrack trackSlug={track.slug} initialStatus={membership?.status ?? null} />
      </>
    )
  }

  const html = renderTrackPage(template, {
    name: track.name,
    description: track.description,
    leaders,
    repositories: track.repositories,
    artifactLinks,
  })

  return (
    <>
      {/* IDEA-109/127 — this track's own title lives inside the templated
          HTML below (cf-internal's markdown starts with the track's name),
          not a discrete element this page controls, so the breadcrumb
          renders immediately above the templated content the same way it
          renders immediately above every other page's own <h2>. */}
      <Breadcrumb path={[HOME_BREADCRUMB, { label: 'Tracks', href: '/tracks' }]} />
      {/* Trusted content, not user input — the template and every value
          substituted into it come from cf-internal, admin-edited the same
          way pass/tracks.yaml already is (see track-page-template.ts's
          module doc). */}
      <div dangerouslySetInnerHTML={{ __html: html }} />
      <JoinTrack trackSlug={track.slug} initialStatus={membership?.status ?? null} />
    </>
  )
}
