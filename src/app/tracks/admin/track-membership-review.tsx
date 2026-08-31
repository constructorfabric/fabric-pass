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
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@gears-frontx/ui-kit'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ActionMessage } from '@/app/action-message'
import { CopyEmailListButton } from '@/app/copy-email-list-button'
import { CheckMark, CompanyMark, DiscordMark, EmailMark, ExternalLinkMark, GitHubMark, LinkedInMark, TelegramMark } from '@/app/marks'
import { TrackBadges, type TrackLabel } from '@/app/profile-labels'
import {
  decideJoinRequestAction,
  demoteToContributorAction,
  promoteToMaintainerAction,
  readdTrackAccessAction,
  removeFromTrackAction,
} from './actions'

interface MemberRow {
  githubId: string
  githubLogin: string
  name?: string
  // 'removed' (IDEA-062) never matches either filter below (`pending`/
  // `approved`) — a removed member simply stops appearing here, same as a
  // 'rejected' one already never did.
  status: 'pending' | 'approved' | 'rejected' | 'removed'
  // IDEA-063 — only meaningful while status === 'approved', same as the
  // server-side column it mirrors.
  role: 'contributor' | 'maintainer'
  githubTeamAddedAt: string | null
  discordRoleAddedAt: string | null
  /** IDEA-048 — the requester's company, if set, and a link to their public
   * profile. `profileHash` is `null` whenever no public profile actually
   * resolves (a non-`confirmed` requester) — page.tsx does that check, this
   * component only renders what it's given. */
  company: string | null
  profileHash: string | null
  /** IDEA-081/082 — the same contacts unified onto the Admin table. */
  email: string | null
  discordUsername: string | null
  telegramUsername: string | null
  telegramPhone: string | null
  linkedinName: string | null
  /** IDEA-064's per-track rank badges — this member's participation across
   * every track (not just this one). IDEA-082 drops the org-wide
   * Stranger/Contributor identity and profile-completeness badges this
   * screen used to also show via `ProfileLabels`; those stay Admin-table-only. */
  tracks: TrackLabel[]
  /** IDEA-093 — `false` for a Track Admin assigned straight from
   * pass/tracks.yaml with no join request of their own on this track
   * (track-members.ts's listTrackMembership synthesizes them into this
   * list so they're visible/filterable at all). Gates Promote/Demote/
   * Remove/Re-add below — none of those server actions have a real
   * `track_members` row to act on for a row like this. */
  hasMembershipRow: boolean
}

interface Section {
  trackSlug: string
  trackName: string
  hasTeamOrRole: boolean
  members: MemberRow[]
  /** IDEA-066 — this track's approved members with a confirmed contributor
   * status and a confirmed email; the caller (tracks/admin/page.tsx) does
   * the filtering, this component only renders the button. */
  confirmedEmails: string[]
}

/** IDEA-091's role filter — a single rank per member, computed the same way
 * `rankOf` in profile-labels.tsx already does (crown overrides role): a
 * pending request is always `pending` regardless of `role`'s stored default
 * (IDEA-063 — `role` is only meaningful once approved); once approved, that
 * track's own admin status (from `member.tracks`, not a separate field on
 * this row) takes precedence over the stored contributor/maintainer role. */
const ROLE_FILTER_OPTIONS = ['all', 'pending', 'contributor', 'maintainer', 'track_admin'] as const
type RoleFilter = (typeof ROLE_FILTER_OPTIONS)[number]

const ROLE_FILTER_LABELS: Record<RoleFilter, string> = {
  all: 'Role',
  pending: 'Requestor',
  contributor: 'Track Contributor',
  maintainer: 'Track Maintainer',
  track_admin: 'Track Admin',
}

const ROLE_FILTER_ITEMS = ROLE_FILTER_OPTIONS.map((value) => ({ value, label: ROLE_FILTER_LABELS[value] }))

function memberRoleFilterValue(section: Section, member: MemberRow): Exclude<RoleFilter, 'all'> {
  if (member.status === 'pending') return 'pending'
  const isTrackAdmin = member.tracks.some((track) => track.trackSlug === section.trackSlug && track.isTrackAdmin)
  if (isTrackAdmin) return 'track_admin'
  return member.role === 'maintainer' ? 'maintainer' : 'contributor'
}

/** IDEA-042's Re-add cooldown — same 15 minutes as IDEA-041's Re-invite. */
const READD_COOLDOWN_MS = 15 * 60 * 1000

/** A grant date, not a log timestamp — month/day/year only, no time-of-day
 * or seconds. Unlike Home's formatShortDate, the year stays: a grant can be
 * genuinely old, not just "recently updated". Locale and time zone are
 * pinned explicitly, not `undefined` — this is a 'use client' component
 * that's server-rendered before it's hydrated, and the server's default
 * locale/time zone won't generally match the browser's, which would
 * otherwise make this string (and the title's below) mismatch between the
 * two renders. */
function formatGrantedDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function formatGrantedTitle(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' })
}

function canReadd(member: MemberRow): boolean {
  const timestamps = [member.githubTeamAddedAt, member.discordRoleAddedAt].filter((t): t is string => t !== null)
  if (timestamps.length === 0) return true
  const mostRecent = Math.max(...timestamps.map((t) => new Date(t).getTime()))
  return Date.now() - mostRecent > READD_COOLDOWN_MS
}

/**
 * IDEA-014 — one section per track the caller administers (or every track,
 * for a global Admin — see page.tsx), each split into that track's pending
 * requests (Accept/Reject) and its current members (read-only here — IDEA-017
 * covers self-service leaving, not a Track Admin removing someone).
 * Search reuses the same client-side-filter-what's-already-loaded pattern as
 * IDEA-012's Admin table (admin-contributor-table.tsx), adapted: this page
 * loads every track it's allowed to show up front, so filtering it in the
 * browser is simpler than round-tripping per keystroke — same reasoning
 * admin-contributor-table.tsx's own doc comment gives for the same choice.
 */
export function TrackMembershipReview({ sections: initialSections }: { sections: Section[] }) {
  const [sections, setSections] = useState(initialSections)
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all')
  const [pendingKey, setPendingKey] = useState<string>()
  const [message, setMessage] = useState<string>()
  const [reauthRequired, setReauthRequired] = useState(false)

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    if (!trimmed && roleFilter === 'all') return sections
    return sections
      .map((section) => ({
        ...section,
        members: section.members.filter((member) => {
          if (roleFilter !== 'all' && memberRoleFilterValue(section, member) !== roleFilter) return false
          if (!trimmed) return true
          return [member.githubLogin, member.name].some((field) => field?.toLowerCase().includes(trimmed))
        }),
      }))
      .filter((section) => section.members.length > 0)
  }, [sections, query, roleFilter])

  // `${trackSlug}/${githubId}:${action}` — the action suffix is what lets
  // the clicked button alone show the kit Button's loading spinner while its
  // sibling only disables, instead of both spinning for one request.
  async function decide(trackSlug: string, githubId: string, decision: 'approved' | 'rejected') {
    const key = `${trackSlug}/${githubId}:${decision}`
    setPendingKey(key)
    setMessage(undefined)
    setReauthRequired(false)
    const result = await decideJoinRequestAction(trackSlug, githubId, decision)
    setPendingKey(undefined)
    if (!result.ok) {
      setMessage(result.message)
      setReauthRequired(Boolean(result.reauthRequired))
      return
    }
    // Approving also triggers the server-side team/role grant
    // (tracks/admin/actions.ts's decideJoinRequestAction calls
    // grantTrackAccess) — this client state has no way to know which of
    // the two channels that actually touched, so it approximates "both"
    // the same conservative way readd()'s own optimistic update does,
    // rather than leaving Re-add showing no cooldown at all right after a
    // grant attempt just happened.
    const now = new Date().toISOString()
    // IDEA-113 — an Accept can change more than this row's `status`: the
    // grant above may also flip `role`/`tracks` (e.g. IDEA-116 additionally
    // making a Track Admin an approved Governance contributor). The server
    // action returns the fresh listTrackParticipation() for this
    // requester on approval — merge it in, rather than leaving those two
    // fields frozen at their pre-decision values until a reload.
    const freshTrack = result.tracks?.find((t) => t.trackSlug === trackSlug)
    setSections((current) =>
      current.map((section) =>
        section.trackSlug !== trackSlug
          ? section
          : {
              ...section,
              members: section.members.map((m) =>
                m.githubId === githubId
                  ? {
                      ...m,
                      status: decision,
                      ...(decision === 'approved' ? { githubTeamAddedAt: now, discordRoleAddedAt: now } : {}),
                      ...(result.tracks ? { tracks: result.tracks, role: freshTrack?.role ?? m.role } : {}),
                    }
                  : m,
              ),
            },
      ),
    )
  }

  async function readd(trackSlug: string, githubId: string) {
    const key = `${trackSlug}/${githubId}:readd`
    setPendingKey(key)
    setMessage(undefined)
    setReauthRequired(false)
    const result = await readdTrackAccessAction(trackSlug, githubId)
    setPendingKey(undefined)
    if (!result.ok) {
      setMessage(result.message)
      setReauthRequired(Boolean(result.reauthRequired))
      return
    }
    // Same conservative-approximation reasoning as the Admin table's own
    // Re-invite optimistic update (admin-contributor-table.tsx) — the
    // server stamps each channel independently based on what the track
    // actually has configured.
    const now = new Date().toISOString()
    setSections((current) =>
      current.map((section) =>
        section.trackSlug !== trackSlug
          ? section
          : {
              ...section,
              members: section.members.map((m) =>
                m.githubId === githubId ? { ...m, githubTeamAddedAt: now, discordRoleAddedAt: now } : m,
              ),
            },
      ),
    )
  }

  async function remove(trackSlug: string, githubId: string) {
    const key = `${trackSlug}/${githubId}:remove`
    setPendingKey(key)
    setMessage(undefined)
    setReauthRequired(false)
    const result = await removeFromTrackAction(trackSlug, githubId)
    setPendingKey(undefined)
    if (!result.ok) {
      setMessage(result.message)
      setReauthRequired(Boolean(result.reauthRequired))
      return
    }
    // The member's row still exists (status now 'removed' server-side) but
    // this component only ever shows 'pending'/'approved' rows — dropping
    // it from local state is the client-side equivalent of that filter,
    // not a lie about what actually happened to the row.
    setSections((current) =>
      current.map((section) =>
        section.trackSlug !== trackSlug
          ? section
          : { ...section, members: section.members.filter((m) => m.githubId !== githubId) },
      ),
    )
  }

  // Shared by promote() and demote() below — both just flip `role` locally
  // on success, the server having already done the same (setTrackMemberRole
  // is idempotent, so there's nothing to reconcile if this races with
  // another admin's click).
  function setLocalRole(trackSlug: string, githubId: string, role: 'contributor' | 'maintainer') {
    setSections((current) =>
      current.map((section) =>
        section.trackSlug !== trackSlug
          ? section
          : { ...section, members: section.members.map((m) => (m.githubId === githubId ? { ...m, role } : m)) },
      ),
    )
  }

  async function promote(trackSlug: string, githubId: string) {
    const key = `${trackSlug}/${githubId}:promote`
    setPendingKey(key)
    setMessage(undefined)
    setReauthRequired(false)
    const result = await promoteToMaintainerAction(trackSlug, githubId)
    setPendingKey(undefined)
    if (!result.ok) {
      setMessage(result.message)
      setReauthRequired(Boolean(result.reauthRequired))
      return
    }
    setLocalRole(trackSlug, githubId, 'maintainer')
  }

  async function demote(trackSlug: string, githubId: string) {
    const key = `${trackSlug}/${githubId}:demote`
    setPendingKey(key)
    setMessage(undefined)
    setReauthRequired(false)
    const result = await demoteToContributorAction(trackSlug, githubId)
    setPendingKey(undefined)
    if (!result.ok) {
      setMessage(result.message)
      setReauthRequired(Boolean(result.reauthRequired))
      return
    }
    setLocalRole(trackSlug, githubId, 'contributor')
  }

  return (
    <>
      <div className="admin-filters">
        <Input
          type="text"
          className="admin-filter-input"
          placeholder="Filter by name or username…"
          value={query}
          onValueChange={setQuery}
          autoComplete="off"
        />
        {/* variant="filter" — same compact toolbar chip as the Admin page's
            Status/Completeness dropdowns (admin-contributor-table.tsx). */}
        <Select value={roleFilter} onValueChange={(value) => setRoleFilter(value as RoleFilter)} items={ROLE_FILTER_ITEMS}>
          <SelectTrigger variant="filter" aria-label="Filter by track role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLE_FILTER_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ActionMessage message={message} reauthRequired={reauthRequired} />
      {filtered.map((section) => {
        const pending = section.members.filter((m) => m.status === 'pending')
        const approved = section.members.filter((m) => m.status === 'approved')
        if (pending.length === 0 && approved.length === 0) return null

        return (
          <section key={section.trackSlug} className="track-review-section">
            <div className="track-review-section-header">
              <h3>{section.trackName}</h3>
              <CopyEmailListButton emails={section.confirmedEmails} />
            </div>

            {pending.length > 0 ? (
              <>
                <p className="subtitle">Pending requests</p>
                <div className="admin-tiles">
                  {pending.map((member) => {
                    const memberKey = `${section.trackSlug}/${member.githubId}`
                    const busy = pendingKey?.startsWith(`${memberKey}:`) ?? false
                    return (
                      <Card size="sm" key={member.githubId}>
                        <CardHeader>
                          <CardTitle>
                            <h3 className="card-heading">{member.name ?? `@${member.githubLogin}`}</h3>
                          </CardTitle>
                          {member.profileHash ? (
                            <CardAction>
                              <Button
                                render={<Link href={`/contributors/${member.profileHash}`} />}
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
                          {member.company ? (
                            <p className="subtitle subtitle-with-icon">
                              <CompanyMark size={14} />
                              {member.company}
                            </p>
                          ) : null}

                          <div className="admin-tile-properties">
                            <span className="admin-tile-property" title="GitHub">
                              <GitHubMark size={14} />@{member.githubLogin}
                            </span>
                            {member.email ? (
                              <span className="admin-tile-property" title="Email">
                                <EmailMark size={14} />
                                {member.email}
                              </span>
                            ) : null}
                            {member.discordUsername ? (
                              <span className="admin-tile-property" title="Discord">
                                <DiscordMark size={14} />
                                {member.discordUsername}
                              </span>
                            ) : null}
                            {member.telegramUsername || member.telegramPhone ? (
                              <span className="admin-tile-property" title="Telegram">
                                <TelegramMark size={14} />
                                {member.telegramUsername ? `@${member.telegramUsername}` : member.telegramPhone}
                              </span>
                            ) : null}
                            {member.linkedinName ? (
                              <span className="admin-tile-property" title="LinkedIn">
                                <LinkedInMark size={14} />
                                {member.linkedinName}
                              </span>
                            ) : null}
                          </div>

                          <div className="profile-labels">
                            <TrackBadges tracks={member.tracks} />
                          </div>
                        </CardContent>
                        <CardFooter className="admin-actions">
                          <Button
                            loading={pendingKey === `${memberKey}:approved`}
                            disabled={busy && pendingKey !== `${memberKey}:approved`}
                            onClick={() => decide(section.trackSlug, member.githubId, 'approved')}
                          >
                            Add to Track
                          </Button>
                          <Button
                            variant="outline"
                            loading={pendingKey === `${memberKey}:rejected`}
                            disabled={busy && pendingKey !== `${memberKey}:rejected`}
                            onClick={() => decide(section.trackSlug, member.githubId, 'rejected')}
                          >
                            Reject
                          </Button>
                        </CardFooter>
                      </Card>
                    )
                  })}
                </div>
              </>
            ) : null}

            {approved.length > 0 ? (
              <>
                <p className="subtitle">Members</p>
                {/* IDEA-062 — every approved member now gets the Card layout
                    (Remove applies regardless of whether the track has a
                    GitHub team/Discord role configured); the team/role
                    status line and Re-add button (IDEA-042) stay conditional
                    on hasTeamOrRole, the only part that's genuinely
                    track-specific. */}
                <div className="admin-tiles">
                  {approved.map((member) => {
                    const memberKey = `${section.trackSlug}/${member.githubId}`
                    const busy = pendingKey?.startsWith(`${memberKey}:`) ?? false
                    return (
                      <Card size="sm" key={member.githubId}>
                        <CardHeader>
                          <CardTitle>
                            <h3 className="card-heading">{member.name ?? `@${member.githubLogin}`}</h3>
                          </CardTitle>
                          {member.profileHash ? (
                            <CardAction>
                              <Button
                                render={<Link href={`/contributors/${member.profileHash}`} />}
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
                          {member.company ? (
                            <p className="subtitle subtitle-with-icon">
                              <CompanyMark size={14} />
                              {member.company}
                            </p>
                          ) : null}

                          <div className="admin-tile-properties">
                            <span className="admin-tile-property" title="GitHub">
                              <GitHubMark size={14} />@{member.githubLogin}
                            </span>
                            {member.email ? (
                              <span className="admin-tile-property" title="Email">
                                <EmailMark size={14} />
                                {member.email}
                              </span>
                            ) : null}
                            {member.discordUsername ? (
                              <span className="admin-tile-property" title="Discord">
                                <DiscordMark size={14} />
                                {member.discordUsername}
                              </span>
                            ) : null}
                            {member.telegramUsername || member.telegramPhone ? (
                              <span className="admin-tile-property" title="Telegram">
                                <TelegramMark size={14} />
                                {member.telegramUsername ? `@${member.telegramUsername}` : member.telegramPhone}
                              </span>
                            ) : null}
                            {member.linkedinName ? (
                              <span className="admin-tile-property" title="LinkedIn">
                                <LinkedInMark size={14} />
                                {member.linkedinName}
                              </span>
                            ) : null}
                          </div>

                          <div className="profile-labels">
                            <TrackBadges tracks={member.tracks} />
                          </div>
                          {section.hasTeamOrRole ? (
                            // IDEA-042 — "whether team/role assignment succeeded", per
                            // channel. Stamped on attempt, not confirmed API success
                            // (see team-access.ts's module doc), so this reads as
                            // "granted" rather than a hard success guarantee. Two
                            // small status pills, not a log-style sentence — a
                            // checkmark plus a short grant date reads at a glance.
                            <div className="admin-tile-properties">
                              <Badge
                                variant={member.githubTeamAddedAt ? 'success' : 'muted'}
                                shape="plain"
                                icon={member.githubTeamAddedAt ? <CheckMark size={12} /> : undefined}
                                title={member.githubTeamAddedAt ? `GitHub team granted ${formatGrantedTitle(member.githubTeamAddedAt)}` : 'GitHub team not granted yet'}
                              >
                                GitHub team{member.githubTeamAddedAt ? ` · ${formatGrantedDate(member.githubTeamAddedAt)}` : ' · not granted'}
                              </Badge>
                              <Badge
                                variant={member.discordRoleAddedAt ? 'success' : 'muted'}
                                shape="plain"
                                icon={member.discordRoleAddedAt ? <CheckMark size={12} /> : undefined}
                                title={member.discordRoleAddedAt ? `Discord role granted ${formatGrantedTitle(member.discordRoleAddedAt)}` : 'Discord role not granted yet'}
                              >
                                Discord role{member.discordRoleAddedAt ? ` · ${formatGrantedDate(member.discordRoleAddedAt)}` : ' · not granted'}
                              </Badge>
                            </div>
                          ) : null}
                        </CardContent>
                        {/* IDEA-093 — a config-assigned Track Admin with no
                            join request of their own has no real
                            `track_members` row for any of these actions to
                            act on (setTrackMemberRole/removeTrackMember
                            both throw NotApprovedError without one); the
                            crown badge above already shows their standing. */}
                        {member.hasMembershipRow ? (
                          <CardFooter className="admin-actions">
                            {/* IDEA-070 — Promote to Maintainer is this row's
                                primary action (no `variant`, first in the
                                row) when available; Demote takes its place,
                                same position, once already a Maintainer. */}
                            {member.role === 'maintainer' ? (
                              <Button
                                variant="outline"
                                loading={pendingKey === `${memberKey}:demote`}
                                disabled={busy && pendingKey !== `${memberKey}:demote`}
                                title="Demote to Contributor — revokes this track's maintainer GitHub team"
                                onClick={() => demote(section.trackSlug, member.githubId)}
                              >
                                Demote to Contributor
                              </Button>
                            ) : (
                              <Button
                                loading={pendingKey === `${memberKey}:promote`}
                                disabled={busy && pendingKey !== `${memberKey}:promote`}
                                title="Promote to Maintainer — grants this track's maintainer GitHub team"
                                onClick={() => promote(section.trackSlug, member.githubId)}
                              >
                                Promote to Maintainer
                              </Button>
                            )}
                            {section.hasTeamOrRole ? (
                              <Button
                                variant="outline"
                                loading={pendingKey === `${memberKey}:readd`}
                                disabled={(busy && pendingKey !== `${memberKey}:readd`) || !canReadd(member)}
                                title="Re-add to this track's GitHub team and Discord role"
                                onClick={() => readd(section.trackSlug, member.githubId)}
                              >
                                Re-add to Track
                              </Button>
                            ) : null}
                            <Dialog>
                              <DialogTrigger
                                render={
                                  <Button
                                    variant="outline"
                                    loading={pendingKey === `${memberKey}:remove`}
                                    disabled={busy && pendingKey !== `${memberKey}:remove`}
                                    title="Remove from this track — revokes its GitHub team and Discord role"
                                  />
                                }
                              >
                                Remove
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>Remove {member.name ?? `@${member.githubLogin}`} from {section.trackName}?</DialogTitle>
                                  <DialogDescription>
                                    This revokes their GitHub team and Discord role for this track. They can request to join again
                                    later.
                                  </DialogDescription>
                                </DialogHeader>
                                <DialogFooter>
                                  <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                                  <DialogClose
                                    render={<Button variant="destructive" onClick={() => remove(section.trackSlug, member.githubId)} />}
                                  >
                                    Remove
                                  </DialogClose>
                                </DialogFooter>
                              </DialogContent>
                            </Dialog>
                          </CardFooter>
                        ) : null}
                      </Card>
                    )
                  })}
                </div>
              </>
            ) : null}
          </section>
        )
      })}
    </>
  )
}
