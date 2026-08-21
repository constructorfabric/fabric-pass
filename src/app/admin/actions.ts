'use server'

import { getAppConfig } from '@/lib/app-config'
import { logAdminAction } from '@/lib/audit-log'
import {
  approveRevoke,
  cancelRevoke,
  findByGithubId,
  NotConfirmedError,
  NotRevokePendingError,
  requestRevoke,
  setContributorStatus,
  type ContributorStatus,
} from '@/lib/contributors'
import { removeFromGitHubOrg, removeFromGitHubTeam } from '@/lib/github-org'
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

/** IDEA-071 — which starting status each target status is reachable from,
 * matching the Admin table's own button visibility exactly: Confirm shows
 * for a Stranger (`draft`) or an already-Ignored (`blocked`) contributor;
 * Ignore shows only for a Stranger — a `confirmed` contributor has no
 * Ignore button at all any more (Revoke replaced it below). Checked
 * server-side since a server action is reachable directly and must not
 * trust the client's own button-hiding alone. */
const ALLOWED_STATUS_TRANSITION_FROM: Record<'confirmed' | 'blocked', ContributorStatus[]> = {
  confirmed: ['draft', 'blocked'],
  blocked: ['draft'],
}

/**
 * IDEA-012's Confirm/Ignore. Re-checks the caller is actually an Admin
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

  const target = await findByGithubId(githubId)
  if (!target) return { ok: false, message: 'This contributor no longer exists.' }
  if (!ALLOWED_STATUS_TRANSITION_FROM[status].includes(target.status)) {
    return { ok: false, message: 'This contributor is not in a state that allows that action.' }
  }

  try {
    await setContributorStatus(githubId, status)
  } catch (error) {
    console.error(`setContributorStatusAction(${githubId}, ${status}) failed:`, error)
    return { ok: false, message: 'Could not update this contributor right now. Please try again in a moment.' }
  }

  // IDEA-022 — logged after the write succeeds, never before: a logging
  // failure must not read as if the Confirm/Ignore itself failed.
  await logAdminAction({
    actorGithubId: caller.githubId,
    action: status === 'confirmed' ? 'confirm' : 'ignore',
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
 * IDEA-071's Revoke — only *requests* a revoke (`status = 'revoke_pending'`);
 * no GitHub calls happen here at all. Requires a non-empty reason,
 * validated server-side, not just via the dialog's own required field.
 */
export async function requestRevokeAction(githubId: string, reason: string): Promise<SetStatusResult> {
  const session = await getSession()
  if (!session.github) return { ok: false, message: 'Please sign in with GitHub first.', reauthRequired: true }

  const caller = await findByGithubId(session.github.id)
  if (!caller || !isAdmin(caller)) return { ok: false, message: 'Not authorized.' }

  const trimmedReason = reason.trim()
  if (!trimmedReason) return { ok: false, message: 'Please explain why this contributor is being revoked.' }

  try {
    await requestRevoke(githubId, caller.githubId, trimmedReason)
  } catch (error) {
    if (error instanceof NotConfirmedError) {
      return { ok: false, message: 'This contributor is not currently confirmed.' }
    }
    console.error(`requestRevokeAction(${githubId}) failed:`, error)
    return { ok: false, message: 'Could not request this revoke right now. Please try again in a moment.' }
  }

  await logAdminAction({
    actorGithubId: caller.githubId,
    action: 'revoke_requested',
    targetGithubId: githubId,
    details: { reason: trimmedReason },
  })

  return { ok: true }
}

/**
 * IDEA-071's Approve Revoking — must be a *different* Admin than whoever
 * requested it, the entire point of the two-person gate. Persists the
 * decision (and logs it) before the best-effort GitHub removal — same
 * "never undo what already succeeded, never read a failed side effect as a
 * failed decision" ordering every other admin action in this app follows.
 */
export async function approveRevokeAction(githubId: string): Promise<SetStatusResult> {
  const session = await getSession()
  if (!session.github) return { ok: false, message: 'Please sign in with GitHub first.', reauthRequired: true }

  const caller = await findByGithubId(session.github.id)
  if (!caller || !isAdmin(caller)) return { ok: false, message: 'Not authorized.' }

  const target = await findByGithubId(githubId)
  if (!target) return { ok: false, message: 'This contributor no longer exists.' }
  if (target.revokeRequestedByGithubId === caller.githubId) {
    return { ok: false, message: 'Only another Admin can approve this revoke — not the Admin who requested it.' }
  }

  try {
    await approveRevoke(githubId, caller.githubId)
  } catch (error) {
    if (error instanceof NotRevokePendingError) {
      return { ok: false, message: 'This revoke is no longer pending.' }
    }
    console.error(`approveRevokeAction(${githubId}) failed:`, error)
    return { ok: false, message: 'Could not approve this revoke right now. Please try again in a moment.' }
  }

  // IDEA-071 — best-effort, after the decision persists but before it's
  // logged: the audit entry records whether GitHub access actually came off,
  // not just that the decision was made.
  const config = await getAppConfig()
  let githubAccessRemoved: boolean | undefined
  if (config?.githubOrganization) {
    if (config.githubContributorsTeam) {
      await removeFromGitHubTeam(target.githubLogin, config.githubOrganization, config.githubContributorsTeam)
    }
    githubAccessRemoved = await removeFromGitHubOrg(target.githubLogin, config.githubOrganization)
  }

  await logAdminAction({
    actorGithubId: caller.githubId,
    action: 'revoke_approved',
    targetGithubId: githubId,
    details: { reason: target.revokeReason, requestedBy: target.revokeRequestedByGithubId, githubAccessRemoved },
  })

  return githubAccessRemoved === false
    ? { ok: true, message: 'Revoked, but GitHub access could not be removed automatically — remove it manually.' }
    : { ok: true }
}

/**
 * IDEA-071's Cancel — any Admin, including the one who requested the
 * revoke, can back it out. Reverts to `confirmed` with no GitHub side
 * effects (approveRevokeAction never ran, so there's nothing to undo there).
 */
export async function cancelRevokeAction(githubId: string): Promise<SetStatusResult> {
  const session = await getSession()
  if (!session.github) return { ok: false, message: 'Please sign in with GitHub first.', reauthRequired: true }

  const caller = await findByGithubId(session.github.id)
  if (!caller || !isAdmin(caller)) return { ok: false, message: 'Not authorized.' }

  try {
    await cancelRevoke(githubId)
  } catch (error) {
    if (error instanceof NotRevokePendingError) {
      return { ok: false, message: 'This revoke is no longer pending.' }
    }
    console.error(`cancelRevokeAction(${githubId}) failed:`, error)
    return { ok: false, message: 'Could not cancel this revoke right now. Please try again in a moment.' }
  }

  await logAdminAction({
    actorGithubId: caller.githubId,
    action: 'revoke_cancelled',
    targetGithubId: githubId,
  })

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
