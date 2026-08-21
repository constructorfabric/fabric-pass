import { findByGithubId, resolveProviderLabels } from '@/lib/contributors'
import { isProfileComplete } from '@/lib/profile-completeness'
import { isProviderConfigured } from '@/lib/providers'
import { getSession } from '@/lib/session'
import { listTrackParticipation } from '@/lib/track-members'
import { noticeKind, noticeMessage, REAUTH_REQUIRED_MESSAGE, type Notice } from '@/app/auth/notice'
import { ContributorForm } from '@/app/form'
import { SignInPrompt } from '@/app/sign-in-prompt'

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

/**
 * Profile — IDEA-001's dedicated page for the view/edit form that used to
 * live at `/`. Every notice about linking a provider or confirming an email
 * lands here now (see auth/[provider]/callback/route.ts and
 * confirm-email/route.ts), since Link/Re-link and the confirmation button
 * only ever appear in this page's edit mode.
 */
export default async function ProfilePage({ searchParams }: PageProps) {
  const session = await getSession()
  const params = await searchParams
  const message = noticeMessage(params.notice, params.provider)
  const notice: Notice | undefined = message ? { message, kind: noticeKind(params.notice) } : undefined

  if (!session.github) {
    return <SignInPrompt notice={notice} />
  }

  const existing = await findByGithubId(session.github.id)
  if (!existing) {
    // The cookie outlived its row (see README's "session outlives its row")
    // — same fallback as Main, since there is nothing here to bind a form to.
    return <SignInPrompt notice={{ message: REAUTH_REQUIRED_MESSAGE, kind: 'error' }} />
  }

  const { telegramLabel, discordLabel, linkedinLabel } = await resolveProviderLabels(existing)

  const tracks = await listTrackParticipation(existing.githubId)

  return (
    <ContributorForm
      telegramLabel={telegramLabel}
      discordLabel={discordLabel}
      linkedinLabel={linkedinLabel}
      linkedinEnabled={isProviderConfigured('linkedin')}
      confirmed={existing.status === 'confirmed'}
      tracks={tracks}
      defaults={{
        name: existing.name ?? '',
        email: existing.email ?? '',
        company: existing.company ?? '',
      }}
      emailConfirmedAt={existing.emailConfirmedAt ?? null}
      emailConfirmationSentAt={existing.emailConfirmationSentAt ?? null}
      notice={notice}
      // A profile that isn't complete yet has nothing meaningful to show in
      // view mode — and IDEA-001 opens Profile straight into edit mode for
      // exactly this contributor, right after sign-in. Keying this off the
      // completeness check itself (rather than a one-shot redirect flag)
      // means it holds however Profile is reached — the sign-in redirect,
      // the user menu, a bookmark — not only the instant after signing in.
      initialEditing={!isProfileComplete(existing)}
    />
  )
}
