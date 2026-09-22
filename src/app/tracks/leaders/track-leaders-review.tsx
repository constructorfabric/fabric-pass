'use client'

import { Badge, Button, Card, CardAction, CardContent, CardHeader, CardTitle } from '@gears-frontx/ui-kit'
import Link from 'next/link'
import { CrownMark, ExternalLinkMark, GitHubMark } from '@/app/marks'
import { NominateLeaderButton } from '@/app/nominate-leader'
import { TRACK_LEADER_ROLE_LABELS, type TrackLeaderRole } from '@/lib/track-leader-roles'

interface LeaderRow {
  githubId: string
  githubLogin: string
  name: string | null
  role: TrackLeaderRole
  /** `null` whenever no public profile actually resolves (a non-`confirmed`
   * contributor) — page.tsx does that check, this component only renders
   * what it's given. Same convention as the Track Members screen. */
  profileHash: string | null
}

interface Section {
  trackSlug: string
  trackName: string
  leaders: LeaderRow[]
}

/** IDEA-149's exact wording — what's wrong and what to do about it. */
const NO_LEADERS_WARNING =
  "No leaders are appointed to this track. Invite the community to nominate candidates, or to nominate themselves, on the track's page."

/**
 * IDEA-149 — one section per track with that track's appointed leaders as
 * tiles, built like the Track Members screen (same Card/tile structure; the
 * tile actions differ — they arrive with IDEA-150's decisions). A track with
 * no leaders shows a red warning in its own section and is summarised in a
 * warning block at the top of the page whose link scrolls to that section.
 */
export function TrackLeadersReview({ sections }: { sections: Section[] }) {
  const leaderless = sections.filter((section) => section.leaders.length === 0)

  return (
    <>
      {leaderless.length > 0 ? (
        <div className="track-leaders-warning" role="alert">
          <h3>
            {leaderless.length === 1
              ? 'One track has no leaders appointed'
              : `${leaderless.length} tracks have no leaders appointed`}
          </h3>
          <ul>
            {leaderless.map((section) => (
              <li key={section.trackSlug}>
                <a href={`#${section.trackSlug}`}>{section.trackName}</a>
              </li>
            ))}
          </ul>
          <p>{NO_LEADERS_WARNING}</p>
        </div>
      ) : null}

      {sections.map((section) => (
        <section key={section.trackSlug} id={section.trackSlug} className="track-review-section">
          <div className="track-review-section-header">
            <h3>{section.trackName}</h3>
            {/* IDEA-018 — Admins nominate from here too, the same form the
                track page uses. An Admin's own nomination still goes through
                the normal review (IDEA-150) — this adds a candidate, it
                doesn't appoint one. */}
            <NominateLeaderButton trackSlug={section.trackSlug} trackName={section.trackName} size="sm" />
          </div>

          {section.leaders.length === 0 ? (
            <p className="track-leaders-warning track-leaders-warning-in-section">{NO_LEADERS_WARNING}</p>
          ) : (
            <div className="admin-tiles">
              {section.leaders.map((leader) => (
                <Card size="sm" key={`${leader.githubId}-${leader.role}`}>
                  <CardHeader>
                    <CardTitle>
                      <h3 className="card-heading">{leader.name ?? `@${leader.githubLogin}`}</h3>
                    </CardTitle>
                    {leader.profileHash ? (
                      <CardAction>
                        <Button
                          render={<Link href={`/contributors/${leader.profileHash}`} />}
                          nativeButton={false}
                          variant="outline"
                          size="sm"
                          icon={<ExternalLinkMark />}
                          title="Open public profile"
                          aria-label="Open public profile"
                        />
                      </CardAction>
                    ) : null}
                  </CardHeader>
                  <CardContent className="admin-tile-content">
                    <div className="admin-tile-properties">
                      <span className="admin-tile-property" title="GitHub">
                        <GitHubMark size={14} />@{leader.githubLogin}
                      </span>
                    </div>

                    <div className="profile-labels">
                      {/* The same crown/warning pairing TrackBadges gives a
                          Track Admin — a leader *is* that track's admin
                          (IDEA-118 derives track_admins from track_leaders);
                          the label names the profile they lead as. */}
                      <Badge
                        variant="warning"
                        icon={<CrownMark size={12} />}
                        title={`${TRACK_LEADER_ROLE_LABELS[leader.role]} — track leader`}
                      >
                        {TRACK_LEADER_ROLE_LABELS[leader.role]}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      ))}
    </>
  )
}
