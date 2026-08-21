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
  Field,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@gears-frontx/ui-kit'
import { useMemo, useState } from 'react'
import type { ContributorStatus } from '@/lib/contributors'
import { CONTRIBUTOR_STATUS_LABELS } from '@/lib/contributor-status-labels'
import { PROFILE_COMPLETENESS_LABELS, PROFILE_COMPLETENESS_VALUES, type ProfileCompleteness } from '@/lib/profile-completeness'
import { approveRevokeAction, cancelRevokeAction, reinviteContributorAction, requestRevokeAction, setContributorStatusAction } from './actions'
import { ActionMessage } from '../action-message'
import { CompanyMark, DiscordMark, EmailMark, GitHubMark, StatusMark } from '../marks'
import { ProfileLabels, type TrackLabel } from '../profile-labels'

interface AdminContributorRow {
  githubId: string
  githubLogin: string
  name: string | null
  email: string | null
  company: string | null
  discordUsername: string | null
  status: ContributorStatus
  profileCompleteness: ProfileCompleteness
  /** IDEA-041 — ISO strings, not Date: server-to-client component props
   * serialize through JSON, same as every other field on this row. `null`
   * means never attempted. */
  githubOrgInvitedAt: string | null
  discordInvitedAt: string | null
  /** IDEA-064's track-participation labels. */
  tracks: TrackLabel[]
  /** IDEA-071 — only set while `status === 'revoke_pending'` (or, for
   * `revokeReason`/`revokeRequestedByGithubId`, still present once
   * `revoked` — see contributors.ts's approveRevoke doc comment).
   * `revokeRequestedByLogin` is resolved server-side (page.tsx) purely for
   * display — the authorization check itself compares githubIds. */
  revokeRequestedByGithubId: string | null
  revokeRequestedByLogin: string | null
  revokeReason: string | null
}

/** IDEA-041's Re-invite cooldown, decided this session — see ideas.md. */
const REINVITE_COOLDOWN_MS = 15 * 60 * 1000

/** `true` once 15 minutes have passed since the more recent of the two
 * invite attempts — or immediately, if neither has ever been attempted at
 * all (nothing to wait out). */
function canReinvite(row: AdminContributorRow): boolean {
  const timestamps = [row.githubOrgInvitedAt, row.discordInvitedAt].filter((t): t is string => t !== null)
  if (timestamps.length === 0) return true
  const mostRecent = Math.max(...timestamps.map((t) => new Date(t).getTime()))
  return Date.now() - mostRecent > REINVITE_COOLDOWN_MS
}

// Duplicated from contributors.ts's CONTRIBUTOR_STATUSES rather than
// imported — that module pulls in `pg` (via lib/db), which must never reach
// this 'use client' component's browser bundle (the type-only import above
// is erased at compile time and stays safe; a value import of the same
// constant would not be).
const CONTRIBUTOR_STATUS_VALUES = ['draft', 'confirmed', 'blocked', 'revoke_pending', 'revoked'] as const
const STATUS_FILTER_OPTIONS = ['all', ...CONTRIBUTOR_STATUS_VALUES] as const
type StatusFilter = (typeof STATUS_FILTER_OPTIONS)[number]

const COMPLETENESS_FILTER_OPTIONS = ['all', ...PROFILE_COMPLETENESS_VALUES] as const
type CompletenessFilter = (typeof COMPLETENESS_FILTER_OPTIONS)[number]

/** Kit Badge speaks semantic intent, not color — these map the domain
 * values onto that vocabulary. Status is an Admin's judgment call
 * (draft = nothing decided yet → muted), completeness is derived from the
 * profile itself (ready = filled but unconfirmed email → informational). */
const STATUS_VARIANTS: Record<ContributorStatus, 'muted' | 'success' | 'danger' | 'warning'> = {
  draft: 'muted',
  confirmed: 'success',
  blocked: 'danger',
  revoke_pending: 'warning',
  revoked: 'danger',
}

/**
 * IDEA-071's Revoke — requires a typed reason (the confirm button stays
 * disabled until non-empty); only *requests* the revoke, so its own copy is
 * explicit that GitHub access isn't touched yet. Local `reason` state lives
 * here, not lifted into the parent's `rows` — the dialog's own draft text
 * has nothing to do with any row's persisted data until it's actually
 * submitted.
 */
function RevokeDialog({
  label,
  loading,
  disabled,
  onConfirm,
}: {
  label: string
  loading: boolean
  disabled: boolean
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')

  return (
    <Dialog onOpenChange={(open) => { if (!open) setReason('') }}>
      <DialogTrigger render={<Button variant="outline" loading={loading} disabled={disabled} />}>Revoke</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke {label}?</DialogTitle>
          <DialogDescription>
            This requests removing them from the default GitHub team and from the GitHub organization entirely. Nothing happens to
            GitHub until a second Admin approves.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel>Reason</FieldLabel>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this contributor being revoked?"
          />
        </Field>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <DialogClose render={<Button variant="destructive" disabled={!reason.trim()} onClick={() => onConfirm(reason)} />}>
            Request Revoke
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * IDEA-071's Approve Revoking — shows the stored reason read-only; the
 * approval itself is the confirmation, so there's no second reason to type
 * (the approver is confirming the existing stated reason, not making a new
 * one).
 */
function ApproveRevokeDialog({
  label,
  reason,
  requestedByLogin,
  loading,
  disabled,
  onConfirm,
}: {
  label: string
  reason: string | null
  requestedByLogin: string | null
  loading: boolean
  disabled: boolean
  onConfirm: () => void
}) {
  return (
    <Dialog>
      <DialogTrigger render={<Button loading={loading} disabled={disabled} />}>Approve Revoking</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Approve revoking {label}?</DialogTitle>
          <DialogDescription>
            {requestedByLogin ? `Requested by @${requestedByLogin}. ` : ''}
            {reason ? `Reason: ${reason}` : 'No reason was given.'} This removes them from the default GitHub team and from the
            GitHub organization entirely.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <DialogClose render={<Button variant="destructive" onClick={onConfirm} />}>Approve Revoking</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The `items` prop each kit Select needs to render the closed trigger's
 * label without opening the popup first (see the kit's select doc). The
 * 'all' entry is labelled with the filter's own name, same as the old
 * native <select>'s first option. */
const STATUS_FILTER_ITEMS = [
  { value: 'all', label: 'Status' },
  ...CONTRIBUTOR_STATUS_VALUES.map((status) => ({ value: status, label: CONTRIBUTOR_STATUS_LABELS[status] })),
]

const COMPLETENESS_FILTER_ITEMS = [
  { value: 'all', label: 'Completeness' },
  ...PROFILE_COMPLETENESS_VALUES.map((value) => ({ value, label: PROFILE_COMPLETENESS_LABELS[value] })),
]

/**
 * IDEA-012's "same search as IDEA-005" — adapted, not reused directly: that
 * search is confirmed-only and server-side, deliberately, since Main never
 * has the whole contributor list in hand. This page already does (every
 * status, fetched once by the server component above), so filtering it
 * client-side against what's already loaded is both simpler and more
 * useful here — an admin filtering for a `draft` signup to Confirm would
 * find nothing through IDEA-005's own confirmed-only search.
 *
 * IDEA-036 added the status/completeness dropdowns and the tile layout
 * below, replacing the table (IDEA-012's original shape) that needed
 * horizontal scroll to see every column at once. A later pass made each
 * tile full-width (one per row) with Full Name as the primary identifier —
 * everything else (GitHub, Email, Company, Discord) is a labelled property
 * of that person, not a peer of the name.
 */
export function AdminContributorTable({
  contributors,
  currentAdminGithubId,
  currentAdminGithubLogin,
}: {
  contributors: AdminContributorRow[]
  /** IDEA-071 — who's viewing this table, so "Approve Revoking" can be
   * hidden for the Admin who requested this specific revoke (the server
   * action re-checks this too; this is only what decides whether the
   * button renders at all). */
  currentAdminGithubId: string
  /** IDEA-071 — only for revoke()'s optimistic update below, so the row
   * shows "Revoke requested by @you" immediately instead of only after a
   * reload resolves it server-side. */
  currentAdminGithubLogin: string
}) {
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [completenessFilter, setCompletenessFilter] = useState<CompletenessFilter>('all')
  const [rows, setRows] = useState(contributors)
  // `${githubId}:${action}` — the action suffix lets the clicked button
  // alone show the kit Button's loading spinner while the row's other
  // actions only disable, instead of every button spinning for one request.
  const [pendingAction, setPendingAction] = useState<string>()
  const [message, setMessage] = useState<string>()
  const [reauthRequired, setReauthRequired] = useState(false)

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false
      if (completenessFilter !== 'all' && row.profileCompleteness !== completenessFilter) return false
      if (!trimmed) return true
      return [row.githubLogin, row.name, row.email, row.status].some((field) => field?.toLowerCase().includes(trimmed))
    })
  }, [rows, query, statusFilter, completenessFilter])

  async function setStatus(githubId: string, status: 'confirmed' | 'blocked') {
    setPendingAction(`${githubId}:${status}`)
    setMessage(undefined)
    setReauthRequired(false)
    const result = await setContributorStatusAction(githubId, status)
    setPendingAction(undefined)
    if (!result.ok) {
      setMessage(result.message)
      setReauthRequired(Boolean(result.reauthRequired))
      return
    }
    setRows((current) => current.map((row) => (row.githubId === githubId ? { ...row, status } : row)))
  }

  async function reinvite(githubId: string) {
    setPendingAction(`${githubId}:reinvite`)
    setMessage(undefined)
    setReauthRequired(false)
    const result = await reinviteContributorAction(githubId)
    setPendingAction(undefined)
    if (!result.ok) {
      setMessage(result.message)
      setReauthRequired(Boolean(result.reauthRequired))
      return
    }
    // Optimistic: the server stamps each channel independently based on
    // which config values are actually set (see invites.ts), but this
    // client-side row doesn't know which those were — setting both is a
    // conservative approximation, not a lie the server disagrees with,
    // since a channel that wasn't really touched just shows a cooldown
    // that expires normally rather than one that's inaccurately short.
    const now = new Date().toISOString()
    setRows((current) =>
      current.map((row) => (row.githubId === githubId ? { ...row, githubOrgInvitedAt: now, discordInvitedAt: now } : row)),
    )
  }

  async function revoke(githubId: string, reason: string) {
    setPendingAction(`${githubId}:revoke`)
    setMessage(undefined)
    setReauthRequired(false)
    const result = await requestRevokeAction(githubId, reason)
    setPendingAction(undefined)
    if (!result.ok) {
      setMessage(result.message)
      setReauthRequired(Boolean(result.reauthRequired))
      return
    }
    setRows((current) =>
      current.map((row) =>
        row.githubId === githubId
          ? {
              ...row,
              status: 'revoke_pending',
              revokeRequestedByGithubId: currentAdminGithubId,
              revokeRequestedByLogin: currentAdminGithubLogin,
              revokeReason: reason,
            }
          : row,
      ),
    )
  }

  async function approveRevoke(githubId: string) {
    setPendingAction(`${githubId}:approve-revoke`)
    setMessage(undefined)
    setReauthRequired(false)
    const result = await approveRevokeAction(githubId)
    setPendingAction(undefined)
    if (!result.ok) {
      setMessage(result.message)
      setReauthRequired(Boolean(result.reauthRequired))
      return
    }
    setRows((current) => current.map((row) => (row.githubId === githubId ? { ...row, status: 'revoked' } : row)))
  }

  async function cancelRevoke(githubId: string) {
    setPendingAction(`${githubId}:cancel-revoke`)
    setMessage(undefined)
    setReauthRequired(false)
    const result = await cancelRevokeAction(githubId)
    setPendingAction(undefined)
    if (!result.ok) {
      setMessage(result.message)
      setReauthRequired(Boolean(result.reauthRequired))
      return
    }
    setRows((current) =>
      current.map((row) =>
        row.githubId === githubId
          ? { ...row, status: 'confirmed', revokeRequestedByGithubId: null, revokeRequestedByLogin: null, revokeReason: null }
          : row,
      ),
    )
  }

  return (
    <>
      <div className="admin-filters">
        <Input
          type="text"
          className="admin-filter-input"
          placeholder="Filter by name, email, username, or status…"
          value={query}
          onValueChange={setQuery}
          autoComplete="off"
        />
        {/* variant="filter" is the kit's compact toolbar filter chip — the
            trigger's label stays muted even with a value chosen, since a
            filter's message is "this narrows the list". */}
        <Select
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as StatusFilter)}
          items={STATUS_FILTER_ITEMS}
        >
          <SelectTrigger variant="filter" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTER_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={completenessFilter}
          onValueChange={(value) => setCompletenessFilter(value as CompletenessFilter)}
          items={COMPLETENESS_FILTER_ITEMS}
        >
          <SelectTrigger variant="filter" aria-label="Filter by completeness">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COMPLETENESS_FILTER_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ActionMessage message={message} reauthRequired={reauthRequired} />
      <div className="admin-tiles">
        {filtered.map((row) => {
          const busy = pendingAction?.startsWith(`${row.githubId}:`) ?? false
          return (
            <Card size="sm" key={row.githubId}>
              <CardHeader>
                <CardTitle>
                  <h3 className="card-heading">{row.name ?? `@${row.githubLogin}`}</h3>
                </CardTitle>
                {/* IDEA-080 — "Confirmed" duplicates ProfileLabels' own
                    "Contributor" identity badge just below for a `confirmed`
                    row, so it's suppressed for that one status only. Every
                    other status (Draft/Ignored/Pending Revoke/Revoked) stays
                    — those carry real information ProfileLabels' simplified
                    Stranger/Contributor grouping doesn't, per IDEA-071's own
                    reasoning for keeping this badge at all. */}
                {row.status !== 'confirmed' ? (
                  <CardAction>
                    <Badge
                      variant={STATUS_VARIANTS[row.status]}
                      icon={<StatusMark />}
                      title={`Status: ${CONTRIBUTOR_STATUS_LABELS[row.status]} — set by an Admin, not the contributor`}
                    >
                      {CONTRIBUTOR_STATUS_LABELS[row.status]}
                    </Badge>
                  </CardAction>
                ) : null}
              </CardHeader>

              <CardContent className="admin-tile-content">
                <div className="admin-tile-properties">
                  <span className="admin-tile-property" title="GitHub">
                    <GitHubMark size={14} />@{row.githubLogin}
                  </span>
                  {row.email ? (
                    <span className="admin-tile-property" title="Email">
                      <EmailMark size={14} />
                      {row.email}
                    </span>
                  ) : null}
                  {row.company ? (
                    <span className="admin-tile-property" title="Company">
                      <CompanyMark size={14} />
                      {row.company}
                    </span>
                  ) : null}
                  {row.discordUsername ? (
                    <span className="admin-tile-property" title="Discord">
                      <DiscordMark size={14} />
                      {row.discordUsername}
                    </span>
                  ) : null}
                </div>

                <ProfileLabels
                  confirmed={row.status === 'confirmed' || row.status === 'revoke_pending'}
                  tracks={row.tracks}
                  completeness={row.profileCompleteness}
                />

                {row.status === 'confirmed' ? (
                  // IDEA-041 — "whether an invite was sent and when", per
                  // channel. Stamped on attempt, not confirmed delivery/accept
                  // (see invites.ts's module doc), so this reads as "invited"
                  // rather than "joined".
                  <p className="subtitle admin-tile-invite-status">
                    GitHub: {row.githubOrgInvitedAt ? `invited ${new Date(row.githubOrgInvitedAt).toLocaleString()}` : 'not invited yet'}
                    {' · '}
                    Discord: {row.discordInvitedAt ? `invited ${new Date(row.discordInvitedAt).toLocaleString()}` : 'not invited yet'}
                  </p>
                ) : null}

                {row.status === 'revoke_pending' ? (
                  // IDEA-071 — visible without opening the Approve dialog
                  // first, so a second Admin can decide at a glance.
                  <p className="subtitle admin-tile-invite-status">
                    Revoke requested{row.revokeRequestedByLogin ? ` by @${row.revokeRequestedByLogin}` : ''}
                    {row.revokeReason ? `: ${row.revokeReason}` : ''}
                  </p>
                ) : null}
              </CardContent>

              <CardFooter className="admin-actions">
                {row.status === 'draft' || row.status === 'blocked' ? (
                  <Button
                    loading={pendingAction === `${row.githubId}:confirmed`}
                    disabled={busy && pendingAction !== `${row.githubId}:confirmed`}
                    onClick={() => setStatus(row.githubId, 'confirmed')}
                  >
                    Confirm
                  </Button>
                ) : null}
                {row.status === 'draft' ? (
                  <Button
                    variant="outline"
                    loading={pendingAction === `${row.githubId}:blocked`}
                    disabled={busy && pendingAction !== `${row.githubId}:blocked`}
                    onClick={() => setStatus(row.githubId, 'blocked')}
                  >
                    Ignore
                  </Button>
                ) : null}
                {row.status === 'confirmed' ? (
                  <RevokeDialog
                    label={row.name ?? `@${row.githubLogin}`}
                    loading={pendingAction === `${row.githubId}:revoke`}
                    disabled={busy && pendingAction !== `${row.githubId}:revoke`}
                    onConfirm={(reason) => revoke(row.githubId, reason)}
                  />
                ) : null}
                {row.status === 'revoke_pending' ? (
                  <>
                    {row.revokeRequestedByGithubId !== currentAdminGithubId ? (
                      <ApproveRevokeDialog
                        label={row.name ?? `@${row.githubLogin}`}
                        reason={row.revokeReason}
                        requestedByLogin={row.revokeRequestedByLogin}
                        loading={pendingAction === `${row.githubId}:approve-revoke`}
                        disabled={busy && pendingAction !== `${row.githubId}:approve-revoke`}
                        onConfirm={() => approveRevoke(row.githubId)}
                      />
                    ) : null}
                    <Button
                      variant="outline"
                      loading={pendingAction === `${row.githubId}:cancel-revoke`}
                      disabled={busy && pendingAction !== `${row.githubId}:cancel-revoke`}
                      onClick={() => cancelRevoke(row.githubId)}
                    >
                      Cancel
                    </Button>
                  </>
                ) : null}
                {row.status === 'confirmed' ? (
                  <Button
                    variant="outline"
                    loading={pendingAction === `${row.githubId}:reinvite`}
                    disabled={(busy && pendingAction !== `${row.githubId}:reinvite`) || !canReinvite(row)}
                    title="Re-send the GitHub org invite and the Discord invite email"
                    onClick={() => reinvite(row.githubId)}
                  >
                    Re-invite
                  </Button>
                ) : null}
              </CardFooter>
            </Card>
          )
        })}
      </div>
    </>
  )
}
