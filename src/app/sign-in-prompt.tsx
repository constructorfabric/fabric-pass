import type { Notice } from './auth/notice'
import { GitHubMark } from './marks'

/**
 * The GitHub sign-in prompt: shown both when nobody is signed in yet, and
 * when the session cookie names a github_id no longer in the table (see
 * README's "session outlives its row") — the same action, signing in with
 * GitHub again, recovers from both, since it recreates the row. Shared
 * between Main (`/`) and Profile (`/profile`): either page can be reached
 * signed out (a bookmark, a stale session, an emailed confirmation link
 * opened in a different browser), and both fall back to the same prompt
 * rather than each rendering its own copy.
 */
export function SignInPrompt({ notice }: { notice?: Notice }) {
  return (
    <>
      <h2>Sign In</h2>
      <p className="subtitle">Sign in with GitHub to add or update your profile.</p>
      {notice ? <p className={notice.kind}>{notice.message}</p> : null}
      <a className="link-button brand github" href="/auth/github">
        <GitHubMark />
        Sign in with GitHub
      </a>
    </>
  )
}
