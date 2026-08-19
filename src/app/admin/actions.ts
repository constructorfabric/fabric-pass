'use server'

import { logAdminAction } from '@/lib/audit-log'
import { findByGithubId, setContributorStatus } from '@/lib/contributors'
import { inviteConfirmedContributor } from '@/lib/invites'
import { isAdmin } from '@/lib/roles'
import { getSession } from '@/lib/session'

export interface SetStatusResult {
  ok: boolean
  message?: string
  /** IDEA-058 — set only when there's no session at all (see actions.ts's
   * saveField for the same flag on the same condition). Not set for "not an
   * Admin"/"session outlived its row", both folded into "Not authorized." —
   * those aren't fixed by signing in again the way a missing session is. */
  reauthRequired?: boolean
}

/**
 * IDEA-012's Confirm/Block. Re-checks the caller is actually an Admin
 * server-side, the same defense-in-depth this app already applies
 * elsewhere (e.g. actions.ts's searchContributorsAction re-checking
 * session.github even though the UI never calls it signed out) — the
 * page's own gate keeps a non-admin from ever seeing this button, but a
 * server action is reachable directly, and must not trust that alone.
 */
export async function setContributorStatusAction(githubId: string, status: 'confirmed' | 'blocked'): Promise<SetStatusResult> {
  const session = await getSession()
  if (!session.github) return { ok: false, message: 'Please sign in with GitHub first.', reauthRequired: true }

  const caller = await findByGithubId(session.github.id)
  if (!caller || !isAdmin(caller)) return { ok: false, message: 'Not authorized.' }

  try {
    await setContributorStatus(githubId, status)
  } catch (error) {
    console.error(`setContributorStatusAction(${githubId}, ${status}) failed:`, error)
    return { ok: false, message: 'Could not update this contributor right now. Please try again in a moment.' }
  }

  // IDEA-022 — logged after the write succeeds, never before: a logging
  // failure must not read as if the Confirm/Block itself failed.
  await logAdminAction({
    actorGithubId: caller.githubId,
    action: status === 'confirmed' ? 'confirm' : 'block',
    targetGithubId: githubId,
  })

  // IDEA-041 — best-effort, after the status write and audit log, same
  // "never undo what already succeeded" discipline.
  if (status === 'confirmed') {
    const confirmed = await findByGithubId(githubId)
    if (confirmed) await inviteConfirmedContributor(confirmed)
  }

  return { ok: true }
}

/**
 * IDEA-041's Re-invite button — same authorization and best-effort
 * discipline as setContributorStatusAction, but doesn't touch `status`
 * itself (the contributor is already confirmed by the time this is ever
 * shown). The Admin table's own 15-minute cooldown decides when to render
 * the button at all; this action doesn't re-check the cooldown server-side
 * — re-running it a little early just re-sends the same invite, which is
 * harmless, not a security boundary worth enforcing twice.
 */
export async function reinviteContributorAction(githubId: string): Promise<SetStatusResult> {
  const session = await getSession()
  if (!session.github) return { ok: false, message: 'Please sign in with GitHub first.', reauthRequired: true }

  const caller = await findByGithubId(session.github.id)
  if (!caller || !isAdmin(caller)) return { ok: false, message: 'Not authorized.' }

  const contributor = await findByGithubId(githubId)
  if (!contributor) return { ok: false, message: 'This contributor no longer exists.' }

  await inviteConfirmedContributor(contributor)
  return { ok: true }
}
