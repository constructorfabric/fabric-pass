import { NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { confirmEmail } from '@/lib/contributors'
import { withNotice } from '@/app/auth/notice'

/** The link sent by lib/email.ts's sendConfirmationEmail. No session or
 * sign-in is required to reach this — the token itself is the credential,
 * exactly as it needs to be for a link clicked from an email client. Lands
 * on Profile (IDEA-001): the Confirm/Re-confirm button and its pending-status
 * text only ever appear there now, so that's where this notice belongs. */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token')
  const profile = new URL('/profile', env.APP_URL)

  if (!token) return NextResponse.redirect(withNotice(profile, 'invalid-confirmation-link'))

  const result = await confirmEmail(token)
  if (result === 'confirmed') return NextResponse.redirect(withNotice(profile, 'email-confirmed'))
  if (result === 'expired') return NextResponse.redirect(withNotice(profile, 'confirmation-expired'))
  return NextResponse.redirect(withNotice(profile, 'invalid-confirmation-link'))
}
