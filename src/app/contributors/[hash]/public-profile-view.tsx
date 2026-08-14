import Link from 'next/link'
import { Fragment, type ReactNode } from 'react'
import { CloseMark, CompanyMark, DiscordMark, EmailMark, ExternalLinkMark, GitHubMark, LinkedInMark, StatusMark, TelegramMark } from '@/app/marks'
import { CopyButton } from '@/app/copy-button'
import { CONTRIBUTOR_STATUS_LABELS } from '@/lib/contributor-status-labels'
import type { PublicProfile } from '@/lib/contributors'

interface ContactRow {
  key: string
  icon: ReactNode
  iconClassName: string
  identifier: string
  copyValue: string
  copyLabel: string
  openHref?: string
  openLabel?: string
  /** mailto: shouldn't get target="_blank" (there's no "new tab" for a mail
   * client to open into) — every http(s) row does. */
  openExternal?: boolean
}

/**
 * Read-only, always — this is never the signed-in contributor's own form
 * (see ContributorForm for that), so there is nothing here to edit and
 * nothing that autosaves. Each contact method is a link only when there's
 * somewhere real to send it: LinkedIn never gets one (see PublicProfile's
 * doc comment — no username/vanity-URL claim to build one from), and a
 * Telegram contact known only by phone shows as plain text rather than a
 * fake "open chat" link a phone number can't actually back. Every row still
 * gets a copy action regardless — the raw value is copyable even when
 * there's nowhere to open it to.
 *
 * IDEA-038 — the status badge is hardcoded to 'confirmed' rather than a
 * field on PublicProfile: getPublicProfile only ever returns a `confirmed`
 * row (see its own doc comment), so there's no other value this could
 * show, and adding a column just to carry a constant isn't worth it. Shown
 * for badge-shape consistency with the Admin table and search results, per
 * this session's item-2 decision (status only, never completeness, on
 * anyone's profile but your own).
 *
 * Follow-up to IDEA-004/038 — copying a contact value had no affordance at
 * all before this: the only one-click action was opening the external
 * service. Each row is now icon / identifier / copy button / open button,
 * laid out as a headerless table (.contact-table, a CSS grid) so every
 * row's columns line up regardless of which fields a given contributor has
 * filled in. Rendered via a Fragment per row rather than a wrapping <div>
 * — the four cells need to be direct children of the grid container for
 * column alignment to hold across rows; a wrapping element would opt its
 * own row out of the shared column tracks.
 */
export function PublicProfileView({ profile }: { profile: PublicProfile }) {
  const rows: ContactRow[] = [
    {
      key: 'github',
      icon: <GitHubMark size={18} />,
      iconClassName: 'contact-icon-github',
      identifier: `@${profile.githubLogin}`,
      copyValue: profile.githubLogin,
      copyLabel: 'Copy GitHub username',
      openHref: `https://github.com/${profile.githubLogin}`,
      openLabel: 'Open on GitHub',
      openExternal: true,
    },
  ]

  if (profile.emailLabel) {
    rows.push({
      key: 'email',
      icon: <EmailMark size={18} />,
      iconClassName: 'contact-icon-email',
      identifier: profile.emailLabel,
      copyValue: profile.emailLabel,
      copyLabel: 'Copy email address',
      openHref: `mailto:${profile.emailLabel}`,
      openLabel: 'Send email',
    })
  }

  // discordId and discordLabel are independently optional on PublicProfile's
  // own type, but getPublicProfile only ever sets them together (both come
  // from the same discordSource row) — this guard is for the type checker,
  // not a real runtime gap; matches the safe-degradation shape every other
  // row here already uses.
  if (profile.discordId && profile.discordLabel) {
    rows.push({
      key: 'discord',
      icon: <DiscordMark size={18} />,
      iconClassName: 'contact-icon-discord',
      identifier: profile.discordLabel,
      copyValue: profile.discordLabel,
      copyLabel: 'Copy Discord handle',
      openHref: `https://discord.com/users/${profile.discordId}`,
      openLabel: 'Open in Discord',
      openExternal: true,
    })
  }

  if (profile.telegramUsername) {
    rows.push({
      key: 'telegram',
      icon: <TelegramMark size={18} />,
      iconClassName: 'contact-icon-telegram',
      identifier: `@${profile.telegramUsername}`,
      copyValue: profile.telegramUsername,
      copyLabel: 'Copy Telegram username',
      openHref: `https://t.me/${profile.telegramUsername}`,
      openLabel: 'Open in Telegram',
      openExternal: true,
    })
  } else if (profile.telegramPhone) {
    rows.push({
      key: 'telegram',
      icon: <TelegramMark size={18} />,
      iconClassName: 'contact-icon-telegram',
      identifier: profile.telegramPhone,
      copyValue: profile.telegramPhone,
      copyLabel: 'Copy Telegram phone number',
    })
  }

  if (profile.linkedinLabel) {
    rows.push({
      key: 'linkedin',
      icon: <LinkedInMark size={18} />,
      iconClassName: 'contact-icon-linkedin',
      identifier: profile.linkedinLabel,
      copyValue: profile.linkedinLabel,
      copyLabel: 'Copy LinkedIn name',
    })
  }

  return (
    <>
      <div className="profile-header">
        <h2>{profile.name}</h2>
        <Link href="/" className="icon-button-square" title="Close" aria-label="Close">
          <CloseMark size={16} />
        </Link>
      </div>
      <span className="admin-status admin-status-confirmed" title={`Status: ${CONTRIBUTOR_STATUS_LABELS.confirmed}`}>
        <StatusMark size={13} />
        {CONTRIBUTOR_STATUS_LABELS.confirmed}
      </span>
      {profile.company ? (
        <p className="subtitle subtitle-with-icon">
          <CompanyMark size={14} />
          {profile.company}
        </p>
      ) : null}

      <div className="contact-table">
        {rows.map((row) => (
          <Fragment key={row.key}>
            <span className={`contact-icon ${row.iconClassName}`}>{row.icon}</span>
            <span className="contact-identifier">{row.identifier}</span>
            <CopyButton value={row.copyValue} label={row.copyLabel} />
            {row.openHref ? (
              <a
                className="icon-button-square icon-button-square-sm"
                href={row.openHref}
                target={row.openExternal ? '_blank' : undefined}
                rel={row.openExternal ? 'noreferrer' : undefined}
                title={row.openLabel}
                aria-label={row.openLabel}
              >
                <ExternalLinkMark size={15} />
              </a>
            ) : (
              <span className="contact-action-spacer" aria-hidden="true" />
            )}
          </Fragment>
        ))}
      </div>
    </>
  )
}
