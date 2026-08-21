/**
 * The four mandatory fields — Full Name, Email, Company, and Discord —
 * checked the same way everywhere a contributor's profile is judged
 * complete: contributors.ts's isProfileComplete, over a stored row, and
 * form.tsx's Save gate, over a form's live draft values (via
 * missingMandatoryFields below). One rule, one place, so the two readings
 * of "complete" can't drift apart — including Main's redirect and the
 * post-sign-in landing page, both of which key off the same rule.
 *
 * Discord is checked via `discordUsername` rather than `discordId`: it's
 * the field contributors.ts's resolveProviderLabels already treats as "is
 * Discord linked" (hasOwnDiscord), and it's what form.tsx has on hand
 * client-side (discordLabel) — there is no raw discordId in the browser.
 *
 * Client-safe (no @/lib/db import): form.tsx ('use client') imports
 * missingMandatoryFields directly. form-schema.ts's validateField pulls in
 * @/lib/contributors (and, through it, `pg`) for isDetailField — a chain
 * that must never reach the browser bundle — so this rule can't live there.
 */
export function missingMandatoryFields(values: {
  name?: string
  email?: string
  company?: string
  discordUsername?: string
}): string[] {
  const missing: string[] = []
  if (!values.name?.trim()) missing.push('Full Name')
  if (!values.email?.trim()) missing.push('Email')
  if (!values.company?.trim()) missing.push('Company')
  if (!values.discordUsername?.trim()) missing.push('Discord')
  return missing
}

/** The boolean reading of missingMandatoryFields above, over a stored row
 * rather than a form's live draft — see contributors.ts's isProfileComplete. */
export function isProfileComplete(values: {
  name?: string
  email?: string
  company?: string
  discordUsername?: string
}): boolean {
  return missingMandatoryFields(values).length === 0
}

/**
 * IDEA-034's three-state reading of a profile — Incomplete/Ready/Complete —
 * layered on top of the mandatory-field check above rather than replacing
 * it: Incomplete is exactly "not profile-complete, or complete but the
 * email isn't confirmed yet"; Ready and Complete both require every
 * mandatory field filled *and* the email confirmed, differing only in
 * whether Telegram and LinkedIn (this app's two optional identity links)
 * are also linked.
 *
 * Takes pre-resolved booleans (`discordLinked`, not `discordUsername`) so
 * one function serves both callers identically: contributors.ts derives
 * them from raw DB columns for the persisted `profile_completeness`
 * column, form.tsx derives them from the same `discordLabel`/`telegramLabel`/
 * `linkedinLabel` props it already renders with, for the live badge shown
 * while editing.
 *
 * `linkedinEnabled` matters because LinkedIn is this app's one optional
 * provider (see lib/env.ts, lib/providers/index.ts's isProviderConfigured)
 * — on a deploy that never configured it, nobody could ever link it, so it
 * must not be required for Complete there. It's passed in rather than
 * imported here to keep this module client-safe (isProviderConfigured pulls
 * in lib/env.ts, harmless server-side, but this file is also imported
 * directly by form.tsx).
 */
export const PROFILE_COMPLETENESS_VALUES = ['incomplete', 'ready', 'complete'] as const
export type ProfileCompleteness = (typeof PROFILE_COMPLETENESS_VALUES)[number]

/** Shared between the Profile page's own badge and the Admin page's
 * completeness column/filter (IDEA-036), so the two never drift apart.
 * IDEA-067 — plain language over the raw state name: "Ready" alone reads as
 * a status with no subject, not obviously about a profile. */
export const PROFILE_COMPLETENESS_LABELS: Record<ProfileCompleteness, string> = {
  incomplete: 'Incomplete Profile',
  ready: 'Profile Ready',
  complete: 'Full Profile',
}

/** IDEA-067 — the one `Badge` variant mapping for profile completeness,
 * shared by every reader (`ProfileLabels`, and previously duplicated in
 * `admin-contributor-table.tsx`/`form.tsx` separately) so the same state
 * never paints two different colors depending on which page shows it. */
export const PROFILE_COMPLETENESS_VARIANTS: Record<ProfileCompleteness, 'warning' | 'info' | 'success'> = {
  incomplete: 'warning',
  ready: 'info',
  complete: 'success',
}

export interface ProfileCompletenessInput {
  name?: string
  email?: string
  company?: string
  discordLinked: boolean
  emailConfirmed: boolean
  telegramLinked: boolean
  linkedinLinked: boolean
  linkedinEnabled: boolean
}

export function computeProfileCompleteness(input: ProfileCompletenessInput): ProfileCompleteness {
  const mandatoryFilled =
    Boolean(input.name?.trim()) && Boolean(input.email?.trim()) && Boolean(input.company?.trim()) && input.discordLinked
  if (!mandatoryFilled || !input.emailConfirmed) return 'incomplete'
  const optionalComplete = input.telegramLinked && (!input.linkedinEnabled || input.linkedinLinked)
  return optionalComplete ? 'complete' : 'ready'
}

/** What's still missing, for the info-icon explanation next to the badge —
 * covers both Incomplete (mandatory items) and Ready (optional items); for
 * Complete this is always empty. Checks name/email/company directly rather
 * than reusing missingMandatoryFields, which takes a `discordUsername`
 * string this input doesn't have (only the resolved `discordLinked`
 * boolean) — passing it undefined would report Discord missing even when
 * `discordLinked` is true. */
export function missingForCompleteness(input: ProfileCompletenessInput): string[] {
  const missing: string[] = []
  if (!input.name?.trim()) missing.push('Full Name')
  if (!input.email?.trim()) missing.push('Email')
  if (!input.company?.trim()) missing.push('Company')
  if (!input.discordLinked) missing.push('Discord')
  if (input.email?.trim() && !input.emailConfirmed) missing.push('Email confirmation')
  if (!input.telegramLinked) missing.push('Telegram')
  if (input.linkedinEnabled && !input.linkedinLinked) missing.push('LinkedIn')
  return missing
}
