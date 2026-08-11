import Link from 'next/link'
import { redirect } from 'next/navigation'
import { COMMUNITY_SCOPE, listArtifactLinks } from '@/lib/artifact-links'
import { countConfirmedContributors, findByGithubId } from '@/lib/contributors'
import { isProfileComplete } from '@/lib/profile-completeness'
import { getSession } from '@/lib/session'
import { anyMembershipSummary } from '@/lib/track-members'
import { listTracks } from '@/lib/tracks'
import { noticeKind, noticeMessage, REAUTH_REQUIRED_MESSAGE, type Notice } from './auth/notice'
import { SearchMark } from './marks'
import { OnboardingChecklist, type ChecklistItemData } from './onboarding-checklist'
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

  const trackMembership = await anyMembershipSummary(existing.githubId)

  // IDEA-047 — each item's state is derived from the real signal it
  // stands for, not self-reported: profile_completeness (IDEA-034's
  // richer Ready/Complete, not just the narrower name+email+company+
  // discord bar every viewer of this page has already cleared to get
  // here), policyLinkClickedAt (a real click on a policy link, IDEA-047's
  // own tracking redirect — not just landing on the page), and this
  // contributor's actual track membership. checklist*HiddenAt overrides
  // all of that once the contributor has dismissed a step themselves;
  // OnboardingChecklist itself hides the whole panel once every item is.
  const checklistItems: ChecklistItemData[] = [
    {
      item: 'profile',
      label: 'Complete your profile',
      href: '/profile',
      state: existing.checklistProfileHiddenAt ? 'hidden' : existing.profileCompleteness !== 'incomplete' ? 'done' : 'todo',
    },
    {
      item: 'policies',
      label: 'Read the community policies',
      href: '/policies',
      state: existing.checklistPoliciesHiddenAt ? 'hidden' : existing.policyLinkClickedAt ? 'done' : 'todo',
    },
    {
      item: 'track',
      label: 'Request to join a track',
      href: '/tracks',
      state: existing.checklistTrackHiddenAt ? 'hidden' : trackMembership === 'approved' ? 'done' : 'todo',
      note: trackMembership === 'pending' ? 'Pending approval' : undefined,
    },
  ]

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
    {
      label: 'People',
      href: '/contributors',
      stat: `${contributorCount} ${contributorCount === 1 ? 'contributor' : 'contributors'}`,
      // A magnifying glass, not a generic "people" icon — the tile's real
      // draw is that it's the one way to search, not just a headcount.
      icon: <SearchMark size={18} />,
    },
  ]

  return (
    <>
      <h2>Home</h2>
      {notice ? <p className={notice.kind}>{notice.message}</p> : null}
      <OnboardingChecklist items={checklistItems} />
      <div className="home-tiles">
        {tiles.map((tile) => (
          <Link key={tile.label} href={tile.href} className="home-tile">
            {tile.icon ? <span className="home-tile-icon">{tile.icon}</span> : null}
            <span className="home-tile-label">{tile.label}</span>
            <span className="home-tile-stat">{tile.stat}</span>
          </Link>
        ))}
      </div>
    </>
  )
}
