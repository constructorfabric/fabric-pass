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
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@gears-frontx/ui-kit'
import { useMemo, useState } from 'react'
import type { ContributorStatus } from '@/lib/contributors'
import { CONTRIBUTOR_STATUS_LABELS } from '@/lib/contributor-status-labels'
import { PROFILE_COMPLETENESS_LABELS, PROFILE_COMPLETENESS_VALUES, type ProfileCompleteness } from '@/lib/profile-completeness'
import { reinviteContributorAction, setContributorStatusAction } from './actions'
import { ActionMessage } from '../action-message'
import { CompanyMark, CompletenessMark, DiscordMark, EmailMark, GitHubMark, StatusMark } from '../marks'

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
const CONTRIBUTOR_STATUS_VALUES = ['draft', 'confirmed', 'blocked'] as const
const STATUS_FILTER_OPTIONS = ['all', ...CONTRIBUTOR_STATUS_VALUES] as const
type StatusFilter = (typeof STATUS_FILTER_OPTIONS)[number]

const COMPLETENESS_FILTER_OPTIONS = ['all', ...PROFILE_COMPLETENESS_VALUES] as const
type CompletenessFilter = (typeof COMPLETENESS_FILTER_OPTIONS)[number]

/** Kit Badge speaks semantic intent, not color — these map the domain
 * values onto that vocabulary. Status is an Admin's judgment call
 * (draft = nothing decided yet → muted), completeness is derived from the
 * profile itself (ready = filled but unconfirmed email → informational). */
const STATUS_VARIANTS: Record<ContributorStatus, 'muted' | 'success' | 'danger'> = {
  draft: 'muted',
  confirmed: 'success',
  blocked: 'danger',
}

const COMPLETENESS_VARIANTS: Record<ProfileCompleteness, 'warning' | 'info' | 'success'> = {
  incomplete: 'warning',
  ready: 'info',
  complete: 'success',
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
export function AdminContributorTable({ contributors }: { contributors: AdminContributorRow[] }) {
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
                <CardAction>
                  <Badge
                    variant={STATUS_VARIANTS[row.status]}
                    icon={<StatusMark />}
                    title={`Status: ${CONTRIBUTOR_STATUS_LABELS[row.status]} — set by an Admin, not the contributor`}
                  >
                    {CONTRIBUTOR_STATUS_LABELS[row.status]}
                  </Badge>
                </CardAction>
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

                <Badge
                  variant={COMPLETENESS_VARIANTS[row.profileCompleteness]}
                  icon={<CompletenessMark />}
                  title={`Profile completeness: ${PROFILE_COMPLETENESS_LABELS[row.profileCompleteness]} — derived from what the contributor has filled in, not admin-set`}
                >
                  {PROFILE_COMPLETENESS_LABELS[row.profileCompleteness]}
                </Badge>

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
              </CardContent>

              <CardFooter className="admin-actions">
                <Button
                  loading={pendingAction === `${row.githubId}:confirmed`}
                  disabled={(busy && pendingAction !== `${row.githubId}:confirmed`) || row.status === 'confirmed'}
                  onClick={() => setStatus(row.githubId, 'confirmed')}
                >
                  Confirm
                </Button>
                <Button
                  variant="outline"
                  loading={pendingAction === `${row.githubId}:blocked`}
                  disabled={(busy && pendingAction !== `${row.githubId}:blocked`) || row.status === 'blocked'}
                  onClick={() => setStatus(row.githubId, 'blocked')}
                >
                  Block
                </Button>
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
