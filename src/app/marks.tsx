/**
 * Service marks, inline so a button costs no extra request and inherits the
 * text colour it sits on.
 */

interface Props {
  size?: number
}

export function GitHubMark({ size = 20 }: Props) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

export function TelegramMark({ size = 20 }: Props) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M21.94 4.3 18.6 20.03c-.25 1.11-.91 1.39-1.84.86l-5.09-3.75-2.46 2.36c-.27.27-.5.5-1.03.5l.37-5.2 9.47-8.56c.41-.37-.09-.57-.64-.2L5.68 13.4.64 11.82c-1.1-.34-1.12-1.1.23-1.63L20.52 2.7c.91-.34 1.71.2 1.42 1.6Z" />
    </svg>
  )
}

export function EmailMark({ size = 20 }: Props) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M1.5 8.67v8.58a3 3 0 0 0 3 3h15a3 3 0 0 0 3-3V8.67l-8.928 5.493a3 3 0 0 1-3.144 0L1.5 8.67Z" />
      <path d="M22.5 6.908V6.75a3 3 0 0 0-3-3h-15a3 3 0 0 0-3 3v.158l9.714 5.978a1.5 1.5 0 0 0 1.572 0L22.5 6.908Z" />
    </svg>
  )
}

export function PencilMark({ size = 20 }: Props) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M13.586 3.586a2 2 0 1 1 2.828 2.828l-.793.793-2.828-2.828.793-.793ZM11.379 5.793 3 14.172V17h2.828l8.38-8.379-2.83-2.828Z" />
    </svg>
  )
}

export function CloseMark({ size = 20 }: Props) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none" aria-hidden="true">
      <path
        d="M4.5 4.5l11 11M15.5 4.5l-11 11"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** IDEA-034's completeness badge — a plain "i in a circle", the hint
 * lives in the element's own title attribute rather than anything drawn
 * here. */
export function InfoMark({ size = 20 }: Props) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 9v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="6.25" r="1" fill="currentColor" />
    </svg>
  )
}

export function LinkedInMark({ size = 20 }: Props) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286ZM5.337 7.433a2.062 2.062 0 1 1 0-4.124 2.062 2.062 0 0 1 0 4.124ZM7.114 20.452H3.556V9h3.558v11.452Z" />
    </svg>
  )
}

/** IDEA-036's Admin tiles — a company/organization a contributor's row
 * lists, alongside GitHub/Email/Discord's own marks. */
export function CompanyMark({ size = 20 }: Props) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none" aria-hidden="true">
      <rect x="3" y="7.5" width="14" height="9.5" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 7.5V5.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

/** IDEA-036's Admin tiles — marks the org-membership `status` badge as
 * distinct from the profile-completeness one (CompletenessMark below),
 * since the two are easy to mistake for each other at a glance otherwise. */
export function StatusMark({ size = 20 }: Props) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none" aria-hidden="true">
      <path d="M10 2.5 16 4.75v4.5c0 3.75-2.5 6.5-6 7.25-3.5-.75-6-3.5-6-7.25v-4.5L10 2.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

/** IDEA-036's Admin tiles — the derived profile-completeness badge
 * (IDEA-034), distinct from the admin-set `status` badge (StatusMark). */
export function CompletenessMark({ size = 20 }: Props) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none" aria-hidden="true">
      <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.5 10.2 8.7 12.5 13.5 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** IDEA-046's Home — a plain magnifying glass on the People tile, calling
 * out that it's the one tile that leads to a search rather than a plain
 * list/directory page. */
export function SearchMark({ size = 20 }: Props) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M17 17l-4.35-4.35" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/** The public profile's per-row copy action — two overlapping rounded
 * squares, the standard "copy" glyph. */
export function CopyMark({ size = 20 }: Props) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none" aria-hidden="true">
      <rect x="7" y="7" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** copy-button.tsx's brief "just copied" confirmation, swapped in for
 * CopyMark rather than a separate toast. */
export function CheckMark({ size = 20 }: Props) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none" aria-hidden="true">
      <path d="M4.5 10.5 8 14 15.5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** The public profile's per-row "open" action — a box with an arrow
 * breaking out its top-right corner, the standard "opens elsewhere" glyph. */
export function ExternalLinkMark({ size = 20 }: Props) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none" aria-hidden="true">
      <path
        d="M8.25 4.5H5.5A1.5 1.5 0 0 0 4 6v8.5A1.5 1.5 0 0 0 5.5 16H14a1.5 1.5 0 0 0 1.5-1.5v-2.75"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M10.5 4.5H15.5V9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15.5 4.5 9 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/** IDEA-064's track-participation labels — a star marks a Track Maintainer,
 * the middle of the three ranks. IDEA-087 moved plain Contributor to
 * DiamondMark below, freeing the star to mean only Maintainer. */
export function StarMark({ size = 20 }: Props) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M10 2 11.88 7.41 17.61 7.53 13.04 10.99 14.7 16.47 10 13.2 5.3 16.47 6.96 10.99 2.39 7.53 8.12 7.41 Z" />
    </svg>
  )
}

/** IDEA-087's track-participation labels — a diamond marks a plain Track
 * Contributor, the lowest of the three ranks, distinct from the star now
 * reserved for Maintainer. */
export function DiamondMark({ size = 20 }: Props) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M10 2 17 10 10 18 3 10 Z" />
    </svg>
  )
}

/** IDEA-106's account-menu avatar badge — the same diamond as DiamondMark,
 * outlined rather than filled: a confirmed contributor with no track
 * participation at all, one rank below a Track Contributor. */
export function DiamondOutlineMark({ size = 20 }: Props) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none" aria-hidden="true">
      <path d="M10 2 17 10 10 18 3 10 Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

/** IDEA-106's account-menu avatar badge — a signed-in contributor an Admin
 * hasn't confirmed yet (see identity-badge.tsx's own Stranger/Contributor
 * wording), the lowest rank the badge shows. */
export function QuestionMark({ size = 20 }: Props) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M7.8 7.8a2.2 2.2 0 1 1 3.4 1.85c-.7.45-1.2.85-1.2 1.85"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="10" cy="14" r="1" fill="currentColor" />
    </svg>
  )
}

/** IDEA-064's track-participation labels — a crown marks a Track Admin, the
 * highest rank shown on any track label. IDEA-106 also uses it for the
 * account-menu avatar badge's Admin state — an org-wide Admin and a Track
 * Admin render identically there; both mean "administrative authority,"
 * just at different scope. */
export function CrownMark({ size = 20 }: Props) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M3 15.5h14l.9-8-4.4 3-3.5-5.5-3.5 5.5-4.4-3 .9 8Z" />
    </svg>
  )
}

/** IDEA-109's breadcrumb separator — the industry-standard chevron
 * (GitHub, Google Drive, AWS console, ...) between each path segment. */
export function ChevronRightMark({ size = 20 }: Props) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none" aria-hidden="true">
      <path d="M7.5 4.5l6 5.5-6 5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function DiscordMark({ size = 20 }: Props) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.6 12.6 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.011c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .079.01c.12.099.246.198.373.292a.077.077 0 0 1-.006.128c-.598.349-1.22.65-1.873.891a.077.077 0 0 0-.041.107c.36.698.772 1.363 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.029.077.077 0 0 0 .032-.055c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.031-.029ZM8.02 15.331c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.211 0 2.176 1.095 2.157 2.419 0 1.334-.956 2.419-2.157 2.419Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.419 0 1.334-.946 2.419-2.157 2.419Z" />
    </svg>
  )
}
