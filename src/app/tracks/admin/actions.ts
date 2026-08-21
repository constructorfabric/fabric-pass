'use server'

import { logAdminAction } from '@/lib/audit-log'
import { findByGithubId } from '@/lib/contributors'
import { sendTrackDecisionEmail } from '@/lib/email'
import { isAdmin, isTrackAdmin } from '@/lib/roles'
import { getSession } from '@/lib/session'
import { grantTrackAccess, revokeTrackAccess } from '@/lib/team-access'
import { decideJoinRequest, NotApprovedError, NotPendingError, removeTrackMember } from '@/lib/track-members'
import { findTrackBySlug } from '@/lib/tracks'
import { REAUTH_REQUIRED_MESSAGE } from '@/app/auth/notice'

export interface DecideJoinRequestResult {
  ok: boolean
  message?: string
  /** IDEA-058 — set both when there's no session at all, and when the
   * session names a contributor row that's since been deleted (README's
   * "session outlives its row") — both are unfixable by retrying, only by
   * signing in again, same as actions.ts's saveField already distinguishes
   * for its own ContributorNotFoundError case. */
  reauthRequired?: boolean
}

/**
 * IDEA-014's Accept/Reject. Re-checks authorization server-side — a global
 * Admin can decide on any track, a Track Admin only on a track they
 * actually administer (isTrackAdmin, IDEA-011) — the same defense-in-depth
 * as admin/actions.ts's setContributorStatusAction; the page's own gate
 * keeps an unauthorized contributor from ever seeing these buttons, but a
 * server action is reachable directly.
 *
 * Sends IDEA-019's decision email best-effort, after the decision is
 * already persisted — never lets an email failure surface as if the
 * decision itself failed.
 */
export async function decideJoinRequestAction(
  trackSlug: string,
  requesterGithubId: string,
  decision: 'approved' | 'rejected',
): Promise<DecideJoinRequestResult> {
  const session = await getSession()
  if (!session.github) return { ok: false, message: 'Please sign in with GitHub first.', reauthRequired: true }

  const caller = await findByGithubId(session.github.id)
  if (!caller) return { ok: false, message: REAUTH_REQUIRED_MESSAGE, reauthRequired: true }

  const track = await findTrackBySlug(trackSlug)
  if (!track) return { ok: false, message: 'This track no longer exists.' }

  if (!isAdmin(caller) && !(await isTrackAdmin(caller.githubId, track.id))) {
    return { ok: false, message: 'Not authorized.' }
  }

  try {
    await decideJoinRequest(track.id, requesterGithubId, decision, caller.githubId)
  } catch (error) {
    if (error instanceof NotPendingError) {
      return { ok: false, message: 'This request was already decided.' }
    }
    console.error(`decideJoinRequestAction(${trackSlug}, ${requesterGithubId}, ${decision}) failed:`, error)
    return { ok: false, message: 'Could not record this decision right now. Please try again in a moment.' }
  }

  // IDEA-022 — logged after the write succeeds, same discipline as
  // admin/actions.ts's Confirm/Block.
  await logAdminAction({
    actorGithubId: caller.githubId,
    action: decision === 'approved' ? 'accept' : 'reject',
    targetGithubId: requesterGithubId,
    trackId: track.id,
  })

  const requester = await findByGithubId(requesterGithubId)
  if (requester?.email) await sendTrackDecisionEmail(requester.email, track.name, decision)

  // IDEA-042 — best-effort, after everything above, same discipline as
  // admin/actions.ts's inviteConfirmedContributor call on Confirm.
  if (decision === 'approved' && requester) await grantTrackAccess(requester, track)

  return { ok: true }
}

/**
 * IDEA-042's Re-add button — mirrors admin/actions.ts's
 * reinviteContributorAction: same authorization, doesn't re-check the
 * member is still 'approved' (the member list's own cooldown decides when
 * to render the button), and re-running it early is harmless — it just
 * retries the same grant.
 */
export async function readdTrackAccessAction(trackSlug: string, memberGithubId: string): Promise<DecideJoinRequestResult> {
  const session = await getSession()
  if (!session.github) return { ok: false, message: 'Please sign in with GitHub first.', reauthRequired: true }

  const caller = await findByGithubId(session.github.id)
  if (!caller) return { ok: false, message: REAUTH_REQUIRED_MESSAGE, reauthRequired: true }

  const track = await findTrackBySlug(trackSlug)
  if (!track) return { ok: false, message: 'This track no longer exists.' }

  if (!isAdmin(caller) && !(await isTrackAdmin(caller.githubId, track.id))) {
    return { ok: false, message: 'Not authorized.' }
  }

  const member = await findByGithubId(memberGithubId)
  if (!member) return { ok: false, message: 'This contributor no longer exists.' }

  await grantTrackAccess(member, track)
  return { ok: true }
}

/**
 * IDEA-062's Remove — undoes an Accept: a Track Admin (or Admin) can revoke
 * an already-approved member's standing, not just decide a still-pending
 * request. Same authorization and defense-in-depth re-check as
 * decideJoinRequestAction; same "persist the decision first, side effects
 * after" ordering, so a failed GitHub/Discord revoke can never read as if
 * the removal itself didn't happen.
 */
export async function removeFromTrackAction(trackSlug: string, memberGithubId: string): Promise<DecideJoinRequestResult> {
  const session = await getSession()
  if (!session.github) return { ok: false, message: 'Please sign in with GitHub first.', reauthRequired: true }

  const caller = await findByGithubId(session.github.id)
  if (!caller) return { ok: false, message: REAUTH_REQUIRED_MESSAGE, reauthRequired: true }

  const track = await findTrackBySlug(trackSlug)
  if (!track) return { ok: false, message: 'This track no longer exists.' }

  if (!isAdmin(caller) && !(await isTrackAdmin(caller.githubId, track.id))) {
    return { ok: false, message: 'Not authorized.' }
  }

  try {
    await removeTrackMember(track.id, memberGithubId, caller.githubId)
  } catch (error) {
    if (error instanceof NotApprovedError) {
      return { ok: false, message: 'This contributor is not currently an approved member.' }
    }
    console.error(`removeFromTrackAction(${trackSlug}, ${memberGithubId}) failed:`, error)
    return { ok: false, message: 'Could not remove this member right now. Please try again in a moment.' }
  }

  // IDEA-022 — logged after the write succeeds, same discipline as every
  // other admin action in this file.
  await logAdminAction({
    actorGithubId: caller.githubId,
    action: 'remove_from_track',
    targetGithubId: memberGithubId,
    trackId: track.id,
  })

  // IDEA-062 — best-effort, after the decision is persisted and logged,
  // same discipline as grantTrackAccess's own call site above.
  const member = await findByGithubId(memberGithubId)
  if (member) await revokeTrackAccess(member, track)

  return { ok: true }
}
