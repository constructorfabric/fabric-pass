'use client'

/**
 * IDEA-058 — the `{message}` + optional "Sign in again" link shown after a
 * failed server action, shared by every admin/track panel that surfaces an
 * `{ ok: false, message, reauthRequired? }` result this way
 * (admin-contributor-table.tsx, track-membership-review.tsx,
 * join-track.tsx). Mirrors autosave-field.tsx's own AutosaveStatusLine —
 * same escape hatch (README's "session outlives its row", and a session
 * that's simply gone), offered wherever an action can fail because the
 * session is gone entirely, not just where that one field lives.
 */
export function ActionMessage({ message, reauthRequired }: { message?: string; reauthRequired?: boolean }) {
  if (!message) return null
  return (
    <p className="error" role="alert">
      {message}
      {reauthRequired ? (
        <>
          {' '}
          <a href="/auth/github">Sign in again</a>
        </>
      ) : null}
    </p>
  )
}
