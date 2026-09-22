'use server'

import { logAdminAction } from '@/lib/audit-log'
import { findByGithubId } from '@/lib/contributors'
import { clearNominations } from '@/lib/leader-nominations'
import { isAdmin, isTrackAdmin } from '@/lib/roles'
import { getSession } from '@/lib/session'
import { appointTrackLeader, demoteTrackLeader, RoleFullError, setTrackLeaderRole } from '@/lib/track-leaders'
import { TRACK_LEADER_ROLES, type TrackLeaderRole } from '@/lib/track-leader-roles'
import { ensureTrackAdminsAreGovernanceContributors } from '@/lib/team-access'
import { findTrackBySlug } from '@/lib/tracks'
import { REAUTH_REQUIRED_MESSAGE } from '@/app/auth/notice'

export interface DecideNominationResult {
  ok: boolean
  message?: string
  reauthRequired?: boolean
}

/** A server action is an HTTP endpoint: the profile strings below arrive as
 * arbitrary values no matter what the client's build-time types say, so
 * they're checked against the closed six-role set here, not trusted. */
function isTrackLeaderRole(value: string): value is TrackLeaderRole {
  return (TRACK_LEADER_ROLES as readonly string[]).includes(value)
}

/** Session + row + track + Admin-or-Track-Admin gate shared by all three
 * actions — the same defense-in-depth decideJoinRequestAction applies; the
 * page's own gate keeps an unauthorized contributor from ever seeing the
 * buttons, but the action doesn't trust that. Returns either the caller and
 * track, or the result to return verbatim. */
async function authorize(
  trackSlug: string,
): Promise<{ caller: { githubId: string }; track: { id: string; slug: string } } | { failure: DecideNominationResult }> {
  const session = await getSession()
  if (!session.github) {
    return { failure: { ok: false, message: 'Please sign in with GitHub first.', reauthRequired: true } }
  }

  const caller = await findByGithubId(session.github.id)
  if (!caller) return { failure: { ok: false, message: REAUTH_REQUIRED_MESSAGE, reauthRequired: true } }

  const track = await findTrackBySlug(trackSlug)
  if (!track) return { failure: { ok: false, message: 'This track no longer exists.' } }

  if (!isAdmin(caller) && !(await isTrackAdmin(caller.githubId, track.id))) {
    return { failure: { ok: false, message: 'Not authorized.' } }
  }

  return { caller, track }
}

/**
 * IDEA-150's Make Decision — Approve (with the profile the candidate will
 * lead as; the form makes choosing one a precondition, and this action
 * re-checks it rather than trusting the form) or Decline (off the list).
 * Both halves settle the candidacy: clearNominations runs on approve too,
 * not just decline — an appointed leader's nominations aren't carried over.
 *
 * After an approval the new leader is also a track admin (IDEA-118's
 * derivation, maintained by appointTrackLeader in the same write), so
 * ensureTrackAdminsAreGovernanceContributors runs right after — a fresh
 * track admin is owed the Governance seat IDEA-116 auto-grants, and the
 * function is a no-op when nothing changed. Best-effort and logged inside
 * itself, same as the tracks sync route's own call.
 */
export async function decideNominationAction(
  trackSlug: string,
  candidateGithubId: string,
  decision: 'approve' | 'decline',
  profile?: string,
): Promise<DecideNominationResult> {
  const gate = await authorize(trackSlug)
  if ('failure' in gate) return gate.failure
  const { caller, track } = gate

  if (decision === 'approve') {
    if (!profile || !isTrackLeaderRole(profile)) {
      return { ok: false, message: 'Choose the profile this leader will lead as before approving.' }
    }

    try {
      await appointTrackLeader(track.id, candidateGithubId, profile)
    } catch (error) {
      if (error instanceof RoleFullError) {
        return { ok: false, message: 'That profile already has its maximum of 3 leaders on this track.' }
      }
      console.error(`decideNominationAction(${trackSlug}, ${candidateGithubId}, approve, ${profile}) failed:`, error)
      return { ok: false, message: 'Could not record this decision right now. Please try again in a moment.' }
    }

    await clearNominations(track.id, candidateGithubId)

    await logAdminAction({
      actorGithubId: caller.githubId,
      action: 'appoint_leader',
      targetGithubId: candidateGithubId,
      trackId: track.id,
      details: { profile },
    })

    await ensureTrackAdminsAreGovernanceContributors()

    return { ok: true }
  }

  await clearNominations(track.id, candidateGithubId)

  await logAdminAction({
    actorGithubId: caller.githubId,
    action: 'decline_nomination',
    targetGithubId: candidateGithubId,
    trackId: track.id,
  })

  return { ok: true }
}

/**
 * IDEA-150 — changes a sitting leader's profile (one tile's role becomes
 * another). track_admins is untouched: they lead either way. No nomination
 * is involved, so nothing to clear.
 */
export async function changeLeaderProfileAction(
  trackSlug: string,
  githubId: string,
  currentRole: string,
  newRole: string,
): Promise<DecideNominationResult> {
  const gate = await authorize(trackSlug)
  if ('failure' in gate) return gate.failure
  const { caller, track } = gate

  if (!isTrackLeaderRole(currentRole) || !isTrackLeaderRole(newRole)) {
    return { ok: false, message: 'Unknown leader profile.' }
  }

  try {
    await setTrackLeaderRole(track.id, githubId, currentRole, newRole)
  } catch (error) {
    if (error instanceof RoleFullError) {
      return { ok: false, message: 'That profile already has its maximum of 3 leaders on this track.' }
    }
    console.error(`changeLeaderProfileAction(${trackSlug}, ${githubId}, ${currentRole}, ${newRole}) failed:`, error)
    return { ok: false, message: 'Could not change the profile right now. Please try again in a moment.' }
  }

  await logAdminAction({
    actorGithubId: caller.githubId,
    action: 'change_leader_profile',
    targetGithubId: githubId,
    trackId: track.id,
    details: { from: currentRole, to: newRole },
  })

  return { ok: true }
}

/**
 * IDEA-150's "Demote to Maintainer" — every leadership profile the person
 * holds on this track goes at once (demoteTrackLeader also lands them on a
 * Maintainer membership and drops the admin row unless they still lead
 * something here). The ex-admin's Governance seat is IDEA-148's mirror
 * running right after: a system-granted seat is revoked exactly when its
 * holder no longer admins any track, and re-running the function for
 * everyone else is a no-op.
 */
export async function demoteLeaderAction(trackSlug: string, githubId: string): Promise<DecideNominationResult> {
  const gate = await authorize(trackSlug)
  if ('failure' in gate) return gate.failure
  const { caller, track } = gate

  try {
    await demoteTrackLeader(track.id, githubId, caller.githubId)
  } catch (error) {
    console.error(`demoteLeaderAction(${trackSlug}, ${githubId}) failed:`, error)
    return { ok: false, message: 'Could not demote this leader right now. Please try again in a moment.' }
  }

  await logAdminAction({
    actorGithubId: caller.githubId,
    action: 'demote_leader',
    targetGithubId: githubId,
    trackId: track.id,
  })

  await ensureTrackAdminsAreGovernanceContributors()

  return { ok: true }
}
