import { inspect } from 'node:util'
import { NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { ContributorNotFoundError, ensureContributor, isProfileComplete, linkProvider } from '@/lib/contributors'
import { isProviderName, providers } from '@/lib/providers'
import { getSession } from '@/lib/session'
import { withNotice } from '@/app/auth/notice'
import { resolveTelegramOutcome } from './outcome'

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider: name } = await context.params
  if (!isProviderName(name)) return new NextResponse('Unknown provider', { status: 404 })

  const session = await getSession()
  const transaction = session.oauth?.[name]
  const home = new URL('/', env.APP_URL)
  const profile = new URL('/profile', env.APP_URL)
  // GitHub sign-in is only ever started from Main's SignInPrompt, so a github
  // notice with nobody signed in yet belongs there — but Discord/Telegram
  // linking, and every notice this route can raise about it, is only ever
  // started from Profile's edit mode (see form.tsx's ProviderField), now that
  // the form itself lives there (IDEA-001).
  const noticeTarget = name === 'github' ? home : profile

  // A callback with no matching transaction for *this* provider is a replay
  // or a stale tab. Providers are keyed independently, so a transaction
  // belonging to a different, still in-flight provider is simply absent here
  // — it is left alone, not cleared, since it may yet complete.
  if (!transaction) {
    return NextResponse.redirect(withNotice(noticeTarget, 'expired'))
  }

  // Discord and Telegram links are only reachable from the signed-in state,
  // and the transaction that started one records which GitHub identity was
  // signed in at that moment (see session.ts). If the session's identity is
  // no longer that one by the time this callback lands — e.g. someone signs
  // in as a different GitHub account in the same browser before finishing
  // this link — completing it would write the callback's identity into
  // whichever row happens to be signed in *now*, not the one that started
  // it. Refused before the token exchange even runs: a transaction that
  // fails this check has nothing legitimate to exchange a code for either.
  // A missing session.github is left to the existing check further down,
  // which refuses it as `expired` rather than `identity-changed` — there is
  // no "different identity" to name when there is no identity at all.
  if (name !== 'github' && session.github && session.github.id !== transaction.githubId) {
    console.warn(
      `${name} callback: session identity changed mid-flow (started as ${transaction.githubId}, now ${session.github.id})`,
    )
    session.oauth = { ...session.oauth, [name]: undefined }
    await session.save()
    return NextResponse.redirect(withNotice(noticeTarget, 'identity-changed', name))
  }

  const redirectUri = `${env.APP_URL}/auth/${name}/callback`
  // Consume only this provider's own transaction — a completed link for one
  // provider must not wipe another provider's still in-flight one.
  session.oauth = { ...session.oauth, [name]: undefined }

  let identity
  try {
    identity = await providers[name].callback(
      new URL(request.url),
      redirectUri,
      transaction.codeVerifier,
      transaction.state,
    )
  } catch (error) {
    // Covers a cancelled authorization, a state or PKCE mismatch, and a
    // provider error alike: the contributor gets one identical, generic
    // message either way, but the container's logs keep the real cause so a
    // genuine regression is distinguishable from someone clicking "cancel".
    //
    // Logged at full depth on purpose: when a provider rejects the exchange,
    // the reason is its own error body nested inside openid-client's cause
    // chain, and the default console depth prints it as `[Object]` — hiding
    // the one fact worth having.
    console.error(`auth callback error (${name}):`, inspect(error, { depth: null }))
    await session.save()
    return NextResponse.redirect(withNotice(noticeTarget, 'link-failed', name))
  }

  if (name === 'github') {
    // `username` is optional on Identity; it is populated here only because
    // github.ts's toIdentity currently guarantees it. That guarantee lives in
    // another module and isn't visible to the compiler here, so it is
    // re-checked at runtime rather than asserted — an absent username fails
    // the same way every other provider error already does, instead of
    // writing `login: undefined` into a session field typed `string`.
    if (!identity.username) {
      console.error(`github callback: identity had no username (providerId=${identity.providerId})`)
      await session.save()
      return NextResponse.redirect(withNotice(home, 'link-failed', name))
    }

    // Autosave starts here: the row exists from this moment, before the
    // contributor has typed or linked anything else.
    let contributor
    try {
      contributor = await ensureContributor(identity.providerId, identity.username, identity.name, identity.email)
    } catch (error) {
      console.error('github callback: failed to create/update the contributor row:', error)
      await session.save()
      return NextResponse.redirect(withNotice(home, 'link-failed', name))
    }

    session.github = { id: identity.providerId, login: identity.username }
    await session.save()
    // IDEA-001: Main if the profile is already complete, otherwise Profile
    // opens straight into edit mode — the same completeness check
    // profile/page.tsx applies on its own, so this only decides where
    // sign-in *lands*, not whether the page it lands on shows edit mode.
    return NextResponse.redirect(isProfileComplete(contributor) ? home : profile)
  }

  // Telegram and Discord can only be reached from the signed-in state — the
  // page offers their link buttons only once session.github is set — so the
  // row this writes to already exists. A missing session.github here means
  // the cookie was lost mid-flow, with nothing to link to; the identity-bound
  // transaction check above has already ruled out the case where one *is*
  // present but belongs to someone else.
  if (!session.github) {
    await session.save()
    return NextResponse.redirect(withNotice(profile, 'expired'))
  }
  const githubId = session.github.id

  if (name === 'discord') {
    try {
      await linkProvider(githubId, 'discord', identity)
    } catch (error) {
      await session.save()
      // The session cookie names a row that's gone — nothing about retrying
      // this same link can ever succeed, only signing in again can.
      if (error instanceof ContributorNotFoundError) return NextResponse.redirect(withNotice(profile, 'reauth-required'))
      console.error('discord callback: failed to save the link:', error)
      return NextResponse.redirect(withNotice(profile, 'link-failed', name))
    }
    await session.save()
    return NextResponse.redirect(profile)
  }

  const outcome = resolveTelegramOutcome(identity, transaction.variant)
  if (outcome.kind === 'retry-with-phone') {
    await session.save()
    return NextResponse.redirect(new URL('/auth/telegram?variant=phone', env.APP_URL))
  }
  if (outcome.kind === 'failed') {
    await session.save()
    return NextResponse.redirect(withNotice(profile, 'telegram-no-contact'))
  }

  try {
    await linkProvider(githubId, 'telegram', outcome.identity)
  } catch (error) {
    await session.save()
    if (error instanceof ContributorNotFoundError) return NextResponse.redirect(withNotice(profile, 'reauth-required'))
    console.error('telegram callback: failed to save the link:', error)
    return NextResponse.redirect(withNotice(profile, 'link-failed', name))
  }
  await session.save()
  return NextResponse.redirect(profile)
}
