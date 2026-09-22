'use client'

import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@gears-frontx/ui-kit'
import Link from 'next/link'
import { useState } from 'react'
import { ActionMessage } from '@/app/action-message'
import { CrownMark, ExternalLinkMark, GitHubMark, StatusMark } from '@/app/marks'
import { NominateLeaderButton } from '@/app/nominate-leader'
import { TRACK_LEADER_ROLE_LABELS, TRACK_LEADER_ROLES, type TrackLeaderRole } from '@/lib/track-leader-roles'
import { changeLeaderProfileAction, decideNominationAction, demoteLeaderAction } from './actions'

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

/** IDEA-150 — one candidate awaiting a decision. `votes` is the
 * accumulating nomination count straight from the (track, candidate,
 * nominator) rows. */
interface CandidateRow {
  githubId: string
  githubLogin: string
  name: string | null
  votes: number
  profileHash: string | null
}

interface Section {
  trackSlug: string
  trackName: string
  candidates: CandidateRow[]
  leaders: LeaderRow[]
}

const PROFILE_ITEMS = TRACK_LEADER_ROLES.map((role) => ({ value: role, label: TRACK_LEADER_ROLE_LABELS[role] }))

const VOTE_LABEL = (votes: number) => (votes === 1 ? '1 nomination' : `${votes} nominations`)

function displayName(row: { name: string | null; githubLogin: string }) {
  return row.name ?? `@${row.githubLogin}`
}

/**
 * IDEA-149/150 — one section per track: nominated candidates awaiting a
 * decision at the top (IDEA-150), the appointed leaders as tiles below
 * (IDEA-149), and a red warning wherever a track has no leader at all.
 * Tile actions: each candidate gets "Make Decision" (Approve with a
 * required profile choice / Decline / Cancel, one form); each leader tile
 * can change its profile or demote the leader to a Maintainer membership.
 */
export function TrackLeadersReview({ sections: initialSections }: { sections: Section[] }) {
  const [sections, setSections] = useState(initialSections)
  const [message, setMessage] = useState<string>()
  const [reauthRequired, setReauthRequired] = useState(false)
  // `${trackSlug}/${githubId}:${action}` — the action suffix lets the
  // clicked button alone spin while its siblings only disable, same shape
  // as track-membership-review.tsx.
  const [pendingKey, setPendingKey] = useState<string>()

  const leaderless = sections.filter((section) => section.leaders.length === 0)

  function mapSection(trackSlug: string, map: (section: Section) => Section) {
    setSections((current) => current.map((section) => (section.trackSlug === trackSlug ? map(section) : section)))
  }

  async function decide(trackSlug: string, candidate: CandidateRow, decision: 'approve' | 'decline', profile?: TrackLeaderRole) {
    const key = `${trackSlug}/${candidate.githubId}:decide`
    setPendingKey(key)
    setMessage(undefined)
    setReauthRequired(false)
    const result = await decideNominationAction(trackSlug, candidate.githubId, decision, profile)
    setPendingKey(undefined)
    if (!result.ok) {
      setMessage(result.message)
      setReauthRequired(Boolean(result.reauthRequired))
      return
    }
    mapSection(trackSlug, (section) => ({
      ...section,
      candidates: section.candidates.filter((c) => c.githubId !== candidate.githubId),
      ...(decision === 'approve' && profile
        ? {
            leaders: [
              ...section.leaders.filter((l) => !(l.githubId === candidate.githubId && l.role === profile)),
              {
                githubId: candidate.githubId,
                githubLogin: candidate.githubLogin,
                name: candidate.name,
                role: profile,
                profileHash: candidate.profileHash,
              },
            ].sort((a, b) => TRACK_LEADER_ROLES.indexOf(a.role) - TRACK_LEADER_ROLES.indexOf(b.role)),
          }
        : {}),
    }))
  }

  async function changeProfile(trackSlug: string, leader: LeaderRow, newRole: TrackLeaderRole) {
    const key = `${trackSlug}/${leader.githubId}:profile`
    setPendingKey(key)
    setMessage(undefined)
    setReauthRequired(false)
    const result = await changeLeaderProfileAction(trackSlug, leader.githubId, leader.role, newRole)
    setPendingKey(undefined)
    if (!result.ok) {
      setMessage(result.message)
      setReauthRequired(Boolean(result.reauthRequired))
      return
    }
    mapSection(trackSlug, (section) => ({
      ...section,
      // setTrackLeaderRole may have deduped a person holding both profiles
      // into one — dropping the old row here matches that end state.
      leaders: section.leaders
        .filter((l) => !(l.githubId === leader.githubId && l.role === leader.role))
        .concat([{ ...leader, role: newRole }])
        .sort((a, b) => TRACK_LEADER_ROLES.indexOf(a.role) - TRACK_LEADER_ROLES.indexOf(b.role)),
    }))
  }

  async function demote(trackSlug: string, leader: LeaderRow) {
    const key = `${trackSlug}/${leader.githubId}:demote`
    setPendingKey(key)
    setMessage(undefined)
    setReauthRequired(false)
    const result = await demoteLeaderAction(trackSlug, leader.githubId)
    setPendingKey(undefined)
    if (!result.ok) {
      setMessage(result.message)
      setReauthRequired(Boolean(result.reauthRequired))
      return
    }
    // Demotion takes every profile at once, not just this tile's.
    mapSection(trackSlug, (section) => ({
      ...section,
      leaders: section.leaders.filter((l) => l.githubId !== leader.githubId),
    }))
  }

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
      <ActionMessage message={message} reauthRequired={reauthRequired} />

      {sections.map((section) => {
        const sectionKey = section.trackSlug
        return (
          <section key={section.trackSlug} id={section.trackSlug} className="track-review-section">
            <div className="track-review-section-header">
              <h3>{section.trackName}</h3>
              {/* IDEA-018 — Admins nominate from here too, the same form the
                track page uses. An Admin's own nomination still goes through
                the normal review (IDEA-150) — this adds a candidate, it
                doesn't appoint one. */}
              <NominateLeaderButton trackSlug={section.trackSlug} trackName={section.trackName} size="sm" />
            </div>

            {section.candidates.length > 0 ? (
              <>
                <p className="subtitle">Nominated candidates</p>
                <div className="admin-tiles">
                  {section.candidates.map((candidate) => {
                    const memberKey = `${sectionKey}/${candidate.githubId}`
                    const busy = pendingKey?.startsWith(`${memberKey}:`) ?? false
                    return (
                      <Card size="sm" key={candidate.githubId}>
                        <CardHeader>
                          <CardTitle>
                            <h3 className="card-heading">{displayName(candidate)}</h3>
                          </CardTitle>
                          {candidate.profileHash ? (
                            <CardAction>
                              <Button
                                render={<Link href={`/contributors/${candidate.profileHash}`} />}
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
                              <GitHubMark size={14} />@{candidate.githubLogin}
                            </span>
                          </div>
                          <div className="profile-labels">
                            <Badge variant="warning" icon={<StatusMark />} title="Awaiting an Admin's decision">
                              {VOTE_LABEL(candidate.votes)}
                            </Badge>
                          </div>
                        </CardContent>
                        <CardFooter className="admin-actions">
                          {/* IDEA-150 — one form, not separate Approve/Decline
                              buttons: approving requires choosing the profile
                              the candidate will lead as, and the single form
                              is what makes that a precondition rather than a
                              separate click's afterthought. */}
                          <DecisionDialog
                            section={section}
                            candidate={candidate}
                            busy={busy}
                            pending={pendingKey === `${memberKey}:decide`}
                            onDecide={(decision, profile) => decide(sectionKey, candidate, decision, profile)}
                          />
                        </CardFooter>
                      </Card>
                    )
                  })}
                </div>
              </>
            ) : null}

            <p className="subtitle">Leaders</p>
            {section.leaders.length === 0 ? (
              <p className="track-leaders-warning track-leaders-warning-in-section">{NO_LEADERS_WARNING}</p>
            ) : (
              <div className="admin-tiles">
                {section.leaders.map((leader) => {
                  const memberKey = `${sectionKey}/${leader.githubId}`
                  const busy = pendingKey?.startsWith(`${memberKey}:`) ?? false
                  return (
                    <Card size="sm" key={`${leader.githubId}-${leader.role}`}>
                      <CardHeader>
                        <CardTitle>
                          <h3 className="card-heading">{displayName(leader)}</h3>
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
                      <CardFooter className="admin-actions">
                        <ChangeProfileDialog
                          section={section}
                          leader={leader}
                          busy={busy}
                          pending={pendingKey === `${memberKey}:profile`}
                          onChange={(newRole) => changeProfile(sectionKey, leader, newRole)}
                        />
                        <DemoteDialog
                          section={section}
                          leader={leader}
                          busy={busy}
                          pending={pendingKey === `${memberKey}:demote`}
                          onConfirm={() => demote(sectionKey, leader)}
                        />
                      </CardFooter>
                    </Card>
                  )
                })}
              </div>
            )}
          </section>
        )
      })}
    </>
  )
}

/** IDEA-149's exact wording — what's wrong and what to do about it. */
const NO_LEADERS_WARNING =
  "No leaders are appointed to this track. Invite the community to nominate candidates, or to nominate themselves, on the track's page."

/** IDEA-150 — the candidate's "Make Decision" form: a profile Select plus
 * Approve / Decline / Cancel. Approving without a profile is impossible —
 * the button stays disabled until one is chosen, and the action re-checks
 * server-side anyway. */
function DecisionDialog({
  section,
  candidate,
  busy,
  pending,
  onDecide,
}: {
  section: Section
  candidate: CandidateRow
  busy: boolean
  pending: boolean
  onDecide: (decision: 'approve' | 'decline', profile?: TrackLeaderRole) => void
}) {
  const [profile, setProfile] = useState<TrackLeaderRole | null>(null)

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            loading={pending}
            disabled={busy && !pending}
            title={`Approve or decline ${displayName(candidate)}'s nomination for ${section.trackName}`}
          />
        }
      >
        Make Decision
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Decide {displayName(candidate)}'s nomination for {section.trackName}
          </DialogTitle>
          <DialogDescription>
            {VOTE_LABEL(candidate.votes)} recorded. Approving appoints them as a leader with the profile chosen below;
            declining drops them from the candidate list.
          </DialogDescription>
        </DialogHeader>
        <div className="nomination-profile-select">
          <Select items={PROFILE_ITEMS} value={profile} onValueChange={(next) => setProfile(next as TrackLeaderRole)}>
            <SelectTrigger aria-label="Leader profile" className="nomination-profile-trigger">
              <SelectValue placeholder="Choose the profile they will lead as…" />
            </SelectTrigger>
            <SelectContent>
              {PROFILE_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={pending} />}>Cancel</DialogClose>
          <DialogClose
            render={
              <Button
                variant="destructive"
                disabled={busy && !pending}
                onClick={() => onDecide('decline')}
              />
            }
          >
            Decline
          </DialogClose>
          <DialogClose
            render={
              <Button
                loading={pending}
                disabled={!profile || (busy && !pending)}
                title={profile ? `Appoint as ${TRACK_LEADER_ROLE_LABELS[profile]}` : 'Choose a profile first'}
                onClick={() => profile && onDecide('approve', profile)}
              />
            }
          >
            Approve
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** IDEA-150 — change one leader tile's profile: the same six-profile
 * Select, preselected with the current one. */
function ChangeProfileDialog({
  section,
  leader,
  busy,
  pending,
  onChange,
}: {
  section: Section
  leader: LeaderRow
  busy: boolean
  pending: boolean
  onChange: (newRole: TrackLeaderRole) => void
}) {
  const [profile, setProfile] = useState<TrackLeaderRole | null>(leader.role)

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="outline"
            loading={pending}
            disabled={busy && !pending}
            title={`Change the profile ${displayName(leader)} leads ${section.trackName} as`}
          />
        }
      >
        Change Profile
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change {displayName(leader)}'s profile on {section.trackName}</DialogTitle>
          <DialogDescription>
            They currently lead as {TRACK_LEADER_ROLE_LABELS[leader.role]}. Changing the profile rewrites this leadership
            row; they stay a track admin either way.
          </DialogDescription>
        </DialogHeader>
        <div className="nomination-profile-select">
          <Select items={PROFILE_ITEMS} value={profile} onValueChange={(next) => setProfile(next as TrackLeaderRole)}>
            <SelectTrigger aria-label="Leader profile" className="nomination-profile-trigger">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROFILE_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={pending} />}>Cancel</DialogClose>
          <DialogClose
            render={
              <Button
                loading={pending}
                disabled={(busy && !pending) || !profile || profile === leader.role}
                title={profile ? `Lead as ${TRACK_LEADER_ROLE_LABELS[profile]}` : 'Choose a profile'}
                onClick={() => profile && profile !== leader.role && onChange(profile)}
              />
            }
          >
            Save
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** IDEA-150's "Demote to Maintainer" — a confirm step, same shape as the
 * Track Members screen's Remove dialog: demotion takes every profile the
 * person holds on this track and lands them on a Maintainer membership. */
function DemoteDialog({
  section,
  leader,
  busy,
  pending,
  onConfirm,
}: {
  section: Section
  leader: LeaderRow
  busy: boolean
  pending: boolean
  onConfirm: () => void
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="outline"
            loading={pending}
            disabled={busy && !pending}
            title={`Remove ${displayName(leader)} from ${section.trackName}'s leadership`}
          />
        }
      >
        Demote to Maintainer
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Demote {displayName(leader)} from {section.trackName}'s leadership?
          </DialogTitle>
          <DialogDescription>
            Every profile they lead this track as goes at once, and they land on a Maintainer membership of the track.
            Their Governance seat, if it was granted automatically for being a track admin, is revoked with it.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={pending} />}>Cancel</DialogClose>
          <DialogClose
            render={
              <Button variant="destructive" onClick={onConfirm} />
            }
          >
            Demote
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
