import type { ProviderName } from '@/lib/providers/types'

/** The rendered form of a notice — `noticeMessage` + `noticeKind` combined
 * into what page.tsx and form.tsx actually need to display one. */
export interface Notice {
  message: string
  kind: 'error' | 'success'
}

/**
 * A one-shot notice from an OAuth redirect, carried as a query parameter
 * rather than in the session. `session.error` used to hold this, but a
 * Server Component cannot clear a cookie during render, so a stale banner
 * would persist across every later visit until an unrelated success cleared
 * it. A query parameter disappears on the next navigation for free, which is
 * exactly the one-shot lifetime this notice needs.
 *
 * The code is a fixed, closed set chosen only by callback/route.ts — never
 * free text — so nothing reaches page.tsx from the URL except a lookup key.
 */
export type NoticeCode =
  | 'expired'
  | 'link-failed'
  | 'telegram-no-contact'
  | 'identity-changed'
  | 'reauth-required'
  | 'email-confirmed'
  | 'confirmation-expired'
  | 'invalid-confirmation-link'
  | 'confirmation-resent'

/**
 * The one message shown for a session that outlives its row — from the
 * OAuth-callback notice below (`reauth-required`, hit when a Discord/Telegram
 * link callback lands against an already-deleted row) and, identically, from
 * `saveField` when an autosave hits the same condition mid-visit (see
 * app/actions.ts). One underlying cause gets one copy of the wording, not two
 * that could drift apart.
 */
export const REAUTH_REQUIRED_MESSAGE = 'Your session no longer matches a saved contributor. Please sign in with GitHub again.'

function isNoticeCode(value: string): value is NoticeCode {
  return (
    value === 'expired' ||
    value === 'link-failed' ||
    value === 'telegram-no-contact' ||
    value === 'identity-changed' ||
    value === 'reauth-required' ||
    value === 'email-confirmed' ||
    value === 'confirmation-expired' ||
    value === 'invalid-confirmation-link' ||
    value === 'confirmation-resent'
  )
}

/** Builds the redirect target that carries a one-shot notice to `page.tsx`. */
export function withNotice(base: URL, code: NoticeCode, provider?: ProviderName): URL {
  const url = new URL(base)
  url.searchParams.set('notice', code)
  if (provider) url.searchParams.set('provider', provider)
  return url
}

/**
 * The inverse of `withNotice`: turns the query parameters `page.tsx` reads
 * back into the same contributor-facing message the callback route would
 * have shown, or `undefined` if there is nothing to show (including an
 * unrecognized or tampered code, which fails safe by showing nothing).
 */
export function noticeMessage(
  rawCode: string | string[] | undefined,
  rawProvider: string | string[] | undefined,
): string | undefined {
  const code = typeof rawCode === 'string' ? rawCode : undefined
  const provider = typeof rawProvider === 'string' ? rawProvider : undefined
  if (!code || !isNoticeCode(code)) return undefined

  switch (code) {
    case 'expired':
      return 'That sign-in link has expired. Please try again.'
    case 'link-failed':
      return provider ? `Linking ${provider} did not complete. Please try again.` : undefined
    case 'telegram-no-contact':
      return 'Your Telegram account has no username, and no phone number was shared, so it could not be linked.'
    case 'identity-changed':
      // Discord/Telegram transactions are bound to the GitHub identity that
      // started them (see session.ts). A mismatch here means someone signed
      // in as a different GitHub account in the same browser before this
      // callback landed — retrying under the account that's signed in now
      // works fine, it just has to be started over.
      return provider
        ? `You signed in as a different GitHub account while linking ${provider}. Please start the ${provider} link again.`
        : 'You signed in as a different GitHub account partway through. Please try again.'
    case 'reauth-required':
      // The session cookie named a contributor row that no longer exists —
      // retrying the same action can never succeed, only signing in again can.
      return REAUTH_REQUIRED_MESSAGE
    case 'email-confirmed':
      return 'Your email has been confirmed.'
    case 'confirmation-expired':
      // Genuinely expired — an already-used link reports success instead
      // (confirmEmail is idempotent), so this only shows when the 24h window
      // really has passed and "click resend" really is the fix.
      return 'That confirmation link has expired. Use "Resend confirmation email" below to get a new one.'
    case 'invalid-confirmation-link':
      return 'That confirmation link is not valid. Use "Resend confirmation email" below to get a new one.'
    case 'confirmation-resent':
      return 'Confirmation email sent — check your inbox.'
  }
}

/**
 * `noticeMessage`'s companion: whether the message it returns reads as an
 * error or a success, so the page can style the two differently instead of
 * every notice defaulting to the same red banner regardless of what it's
 * actually saying.
 */
export function noticeKind(rawCode: string | string[] | undefined): 'error' | 'success' {
  const code = typeof rawCode === 'string' ? rawCode : undefined
  return code === 'email-confirmed' || code === 'confirmation-resent' ? 'success' : 'error'
}
