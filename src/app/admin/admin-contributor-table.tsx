'use client'

import { useMemo, useState } from 'react'
import type { ContributorStatus } from '@/lib/contributors'
import { CONTRIBUTOR_STATUS_LABELS } from '@/lib/contributor-status-labels'
import { PROFILE_COMPLETENESS_LABELS, PROFILE_COMPLETENESS_VALUES, type ProfileCompleteness } from '@/lib/profile-completeness'
import { reinviteContributorAction, setContributorStatusAction } from './actions'
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
  const [pendingGithubId, setPendingGithubId] = useState<string>()
  const [message, setMessage] = useState<string>()

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
    setPendingGithubId(githubId)
    setMessage(undefined)
    const result = await setContributorStatusAction(githubId, status)
    setPendingGithubId(undefined)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    setRows((current) => current.map((row) => (row.githubId === githubId ? { ...row, status } : row)))
  }

  async function reinvite(githubId: string) {
    setPendingGithubId(githubId)
    setMessage(undefined)
    const result = await reinviteContributorAction(githubId)
    setPendingGithubId(undefined)
    if (!result.ok) {
      setMessage(result.message)
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
        <input
          type="text"
          placeholder="Filter by name, email, username, or status…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
          <option value="all">Status</option>
          {CONTRIBUTOR_STATUS_VALUES.map((status) => (
            <option key={status} value={status}>
              {CONTRIBUTOR_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        <select value={completenessFilter} onChange={(e) => setCompletenessFilter(e.target.value as CompletenessFilter)}>
          <option value="all">Completeness</option>
          {PROFILE_COMPLETENESS_VALUES.map((value) => (
            <option key={value} value={value}>
              {PROFILE_COMPLETENESS_LABELS[value]}
            </option>
          ))}
        </select>
      </div>
      {message ? (
        <p className="error" role="alert">
          {message}
        </p>
      ) : null}
      <div className="admin-tiles">
        {filtered.map((row) => (
          <div className="admin-tile" key={row.githubId}>
            <div className="admin-tile-header">
              <h3 className="admin-tile-name">{row.name ?? `@${row.githubLogin}`}</h3>
              <span
                className={`admin-status admin-status-${row.status}`}
                title={`Status: ${CONTRIBUTOR_STATUS_LABELS[row.status]} — set by an Admin, not the contributor`}
              >
                <StatusMark size={13} />
                {CONTRIBUTOR_STATUS_LABELS[row.status]}
              </span>
            </div>

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

            <span
              className={`completeness-badge completeness-badge-${row.profileCompleteness}`}
              title={`Profile completeness: ${PROFILE_COMPLETENESS_LABELS[row.profileCompleteness]} — derived from what the contributor has filled in, not admin-set`}
            >
              <CompletenessMark size={13} />
              {PROFILE_COMPLETENESS_LABELS[row.profileCompleteness]}
            </span>

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

            <div className="admin-actions">
              <button
                type="button"
                className="button-primary"
                disabled={pendingGithubId === row.githubId || row.status === 'confirmed'}
                onClick={() => setStatus(row.githubId, 'confirmed')}
              >
                Confirm
              </button>
              <button
                type="button"
                className="button-secondary"
                disabled={pendingGithubId === row.githubId || row.status === 'blocked'}
                onClick={() => setStatus(row.githubId, 'blocked')}
              >
                Block
              </button>
              {row.status === 'confirmed' ? (
                <button
                  type="button"
                  className="button-secondary"
                  disabled={pendingGithubId === row.githubId || !canReinvite(row)}
                  title="Re-send the GitHub org invite and the Discord invite email"
                  onClick={() => reinvite(row.githubId)}
                >
                  Re-invite
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
