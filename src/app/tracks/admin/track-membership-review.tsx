'use client'

import { Button, Card, CardFooter, CardHeader, CardTitle, Input } from '@gears-frontx/ui-kit'
import { useMemo, useState } from 'react'
import { ActionMessage } from '@/app/action-message'
import { decideJoinRequestAction, readdTrackAccessAction, removeFromTrackAction } from './actions'

interface MemberRow {
  githubId: string
  githubLogin: string
  name?: string
  // 'removed' (IDEA-062) never matches either filter below (`pending`/
  // `approved`) — a removed member simply stops appearing here, same as a
  // 'rejected' one already never did.
  status: 'pending' | 'approved' | 'rejected' | 'removed'
  githubTeamAddedAt: string | null
  discordRoleAddedAt: string | null
}

interface Section {
  trackSlug: string
  trackName: string
  hasTeamOrRole: boolean
  members: MemberRow[]
}

/** IDEA-042's Re-add cooldown — same 15 minutes as IDEA-041's Re-invite. */
const READD_COOLDOWN_MS = 15 * 60 * 1000

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
  const [pendingKey, setPendingKey] = useState<string>()
  const [message, setMessage] = useState<string>()
  const [reauthRequired, setReauthRequired] = useState(false)

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    if (!trimmed) return sections
    return sections
      .map((section) => ({
        ...section,
        members: section.members.filter((member) =>
          [member.githubLogin, member.name].some((field) => field?.toLowerCase().includes(trimmed)),
        ),
      }))
      .filter((section) => section.members.length > 0)
  }, [sections, query])

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
      </div>
      <ActionMessage message={message} reauthRequired={reauthRequired} />
      {filtered.map((section) => {
        const pending = section.members.filter((m) => m.status === 'pending')
        const approved = section.members.filter((m) => m.status === 'approved')
        if (pending.length === 0 && approved.length === 0) return null

        return (
          <section key={section.trackSlug} className="track-review-section">
            <h3>{section.trackName}</h3>

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
                        </CardHeader>
                        <CardFooter className="admin-actions">
                          <Button
                            loading={pendingKey === `${memberKey}:approved`}
                            disabled={busy && pendingKey !== `${memberKey}:approved`}
                            onClick={() => decide(section.trackSlug, member.githubId, 'approved')}
                          >
                            Accept
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
                          {section.hasTeamOrRole ? (
                            // IDEA-042 — "whether team/role assignment succeeded", per
                            // channel. Stamped on attempt, not confirmed API success
                            // (see team-access.ts's module doc), so this reads as
                            // "granted" rather than a hard success guarantee.
                            <p className="subtitle admin-tile-invite-status">
                              GitHub team: {member.githubTeamAddedAt ? `granted ${new Date(member.githubTeamAddedAt).toLocaleString()}` : 'not granted yet'}
                              {' · '}
                              Discord role: {member.discordRoleAddedAt ? `granted ${new Date(member.discordRoleAddedAt).toLocaleString()}` : 'not granted yet'}
                            </p>
                          ) : null}
                        </CardHeader>
                        <CardFooter className="admin-actions">
                          {section.hasTeamOrRole ? (
                            <Button
                              variant="outline"
                              loading={pendingKey === `${memberKey}:readd`}
                              disabled={(busy && pendingKey !== `${memberKey}:readd`) || !canReadd(member)}
                              title="Re-add to this track's GitHub team and Discord role"
                              onClick={() => readd(section.trackSlug, member.githubId)}
                            >
                              Re-add
                            </Button>
                          ) : null}
                          <Button
                            variant="outline"
                            loading={pendingKey === `${memberKey}:remove`}
                            disabled={busy && pendingKey !== `${memberKey}:remove`}
                            title="Remove from this track — revokes its GitHub team and Discord role"
                            onClick={() => remove(section.trackSlug, member.githubId)}
                          >
                            Remove
                          </Button>
                        </CardFooter>
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
