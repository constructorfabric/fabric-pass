import Link from 'next/link'
import { redirect } from 'next/navigation'
import { COMMUNITY_SCOPE, listArtifactLinks } from '@/lib/artifact-links'
import { countConfirmedContributors, findByGithubId } from '@/lib/contributors'
import { isProfileComplete } from '@/lib/profile-completeness'
import { getSession } from '@/lib/session'
import { anyMembershipSummary } from '@/lib/track-members'
import { listTracks } from '@/lib/tracks'
import { noticeKind, noticeMessage, REAUTH_REQUIRED_MESSAGE, type Notice } from './auth/notice'
import { OnboardingChecklist } from './onboarding-checklist'
import { SignInPrompt } from './sign-in-prompt'

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

/** No year — "short format" per IDEA-046's own wording, and every one of
 * these dates is recent enough in practice that the year adds noise, not
 * information. `undefined` means the category is empty — "Not published
 * yet", the same wording /vision and /policies already use for the same
 * state, rather than a slightly-off "Updated never". */
function formatShortDate(date: Date | undefined): string {
  return date ? `Updated ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : 'Not published yet'
}

/** The most recent `updated_at` among a set of artifact links — which, per
 * artifact-links.ts's own module doc, means "last time pass/artifact-links.yaml
 * was synced," not a true per-document edit date (the sync is a full delete
 * + re-insert on every push, so every row's timestamp moves together). */
function latestUpdate(links: { updatedAt: Date }[]): Date | undefined {
  return links.reduce<Date | undefined>((latest, link) => (!latest || link.updatedAt > latest ? link.updatedAt : latest), undefined)
}

/**
 * Main — IDEA-001's root page, rebuilt by IDEA-046 into a "Home" tile grid:
 * Vision, Policies, Tracks, People, each a stat and a link out to its own
 * page. IDEA-005's search, previously embedded inline here, moved wholesale
 * to the new /contributors page behind the People tile — Home carries no
 * inline search of its own any more.
 *
 * The completeness redirect below predates the tiles and still applies for
 * the same reason it always did: nothing on this page needs a complete
 * profile to render (the tiles are static links, not data drawn from the
 * viewer), but keeping the redirect means a fresh sign-up still lands on
 * /profile first, same as before.
 */
export default async function Page({ searchParams }: PageProps) {
  const session = await getSession()
  const params = await searchParams
  const message = noticeMessage(params.notice, params.provider)
  const notice: Notice | undefined = message ? { message, kind: noticeKind(params.notice) } : undefined

  if (!session.github) {
    return <SignInPrompt notice={notice} />
  }

  const existing = await findByGithubId(session.github.id)
  if (!existing) {
    return <SignInPrompt notice={{ message: REAUTH_REQUIRED_MESSAGE, kind: 'error' }} />
  }

  if (!isProfileComplete(existing)) {
    const query = new URLSearchParams()
    if (typeof params.notice === 'string') query.set('notice', params.notice)
    if (typeof params.provider === 'string') query.set('provider', params.provider)
    redirect(query.size > 0 ? `/profile?${query.toString()}` : '/profile')
  }

  // IDEA-015's checklist stays visible until IDEA-034's full completeness
  // (mandatory fields + confirmed email + optional Telegram/LinkedIn) —
  // deliberately richer than the name+email check just above that gates
  // reaching Home at all, since every viewer of this page already passes
  // that narrower check and gating the checklist on it too would make it
  // vanish immediately for everyone. IDEA-034's own notes explicitly
  // anticipate this checklist reusing its richer completeness for exactly
  // this. Its "complete profile" step, though, still reports the original,
  // narrower isProfileComplete (name+email — literally what IDEA-015 asked
  // for) — always true by the time this renders, which correctly shows a
  // contributor they've already cleared that bar and have two steps left.
  const showChecklist = existing.profileCompleteness !== 'complete'
  const trackMembership = showChecklist ? await anyMembershipSummary(existing.githubId) : 'none'

  const [communityLinks, tracks, contributorCount] = await Promise.all([
    listArtifactLinks(COMMUNITY_SCOPE),
    listTracks(),
    countConfirmedContributors(),
  ])
  const visionLinks = communityLinks.filter((link) => link.category === 'vision')
  const policyLinks = communityLinks.filter((link) => link.category === 'policy')

  const tiles = [
    { label: 'Vision', href: '/vision', stat: formatShortDate(latestUpdate(visionLinks)) },
    { label: 'Policies', href: '/policies', stat: formatShortDate(latestUpdate(policyLinks)) },
    { label: 'Tracks', href: '/tracks', stat: `${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'}` },
    { label: 'People', href: '/contributors', stat: `${contributorCount} confirmed` },
  ]

  return (
    <>
      <h2>Home</h2>
      {notice ? <p className={notice.kind}>{notice.message}</p> : null}
      {showChecklist ? <OnboardingChecklist profileComplete={isProfileComplete(existing)} trackMembership={trackMembership} /> : null}
      <div className="home-tiles">
        {tiles.map((tile) => (
          <Link key={tile.label} href={tile.href} className="home-tile">
            <span className="home-tile-label">{tile.label}</span>
            <span className="home-tile-stat">{tile.stat}</span>
          </Link>
        ))}
      </div>
    </>
  )
}
