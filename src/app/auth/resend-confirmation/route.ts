import { NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { resendConfirmationEmail } from '@/lib/contributors'
import { getSession } from '@/lib/session'
import { withNotice } from '@/app/auth/notice'

/** Session-authenticated, unlike /confirm-email — this always resends *the
 * signed-in contributor's own* pending email, never one named by the
 * request, so there's no token or contributor id to trust from outside.
 * Lands on Profile (IDEA-001), same as /confirm-email: the button that
 * triggers this only appears there. */
export async function GET() {
  const session = await getSession()
  const profile = new URL('/profile', env.APP_URL)

  if (!session.github) return NextResponse.redirect(withNotice(profile, 'sign-in-required'))

  await resendConfirmationEmail(session.github.id)
  return NextResponse.redirect(withNotice(profile, 'confirmation-resent'))
}
