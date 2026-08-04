import { findByGithubId } from '@/lib/contributors'
import { getSession } from '@/lib/session'
import { noticeKind, noticeMessage, REAUTH_REQUIRED_MESSAGE, type Notice } from './auth/notice'
import { SignInPrompt } from './sign-in-prompt'

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

/**
 * Main — IDEA-001's static root page. Signed-out visitors (or a session
 * naming a github_id with no row — see README's "session outlives its row")
 * still get the same GitHub sign-in prompt this page always showed; the only
 * thing this idea changes here is that a *signed-in* contributor now sees
 * static placeholder content instead of the profile form, which has moved to
 * its own page (`/profile`). A one-shot notice can still land here — the
 * GitHub sign-in itself (`?notice=expired`/`link-failed` etc.) is the only
 * flow still routed at Main; every notice about linking a provider or
 * confirming an email now lands on `/profile`, since that's the only place
 * those actions can be started from.
 */
export default async function Page({ searchParams }: PageProps) {
  const session = await getSession()
  const params = await searchParams
  const message = noticeMessage(params.notice, params.provider)
  const notice: Notice | undefined = message ? { message, kind: noticeKind(params.notice) } : undefined

  if (!session.github) {
    return <SignInPrompt notice={notice} />
  }

  const existing = await findByGithubId(session.github.id)
  if (!existing) {
    return <SignInPrompt notice={{ message: REAUTH_REQUIRED_MESSAGE, kind: 'error' }} />
  }

  return (
    <>
      {notice ? <p className={notice.kind}>{notice.message}</p> : null}
      {/* Placeholder content only — deliberately not wired up to anything yet
          (see IDEA-001's "Main is a new static root page"). */}
      <h2>Main Form</h2>
    </>
  )
}
