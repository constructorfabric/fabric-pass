'use server'

import { findByGithubId } from '@/lib/contributors'
import {
  CandidateNotMemberError,
  nominateTrackLeader,
  searchNominatableMembers,
  type NominatableMember,
} from '@/lib/leader-nominations'
import { isAdmin } from '@/lib/roles'
import { getSession } from '@/lib/session'
import { findTrackBySlug } from '@/lib/tracks'
import { requestToJoinTrack } from '@/lib/track-members'
import { REAUTH_REQUIRED_MESSAGE } from '@/app/auth/notice'

export interface RequestToJoinResult {
  ok: boolean
  message?: string
  /** IDEA-058 — set both when there's no session at all, and when the
   * session names a contributor row that's since been deleted — see
   * tracks/admin/actions.ts's DecideJoinRequestResult for the same
   * distinction. */
  reauthRequired?: boolean
}

/**
 * IDEA-013 — re-checks the caller is actually signed in and the slug still
 * names a real track server-side, the same defense-in-depth this app
 * already applies elsewhere (e.g. admin/actions.ts's setContributorStatusAction) —
 * a server action is reachable directly regardless of what the page itself
 * gates on.
 */
export async function requestToJoinTrackAction(trackSlug: string): Promise<RequestToJoinResult> {
  const session = await getSession()
  if (!session.github) return { ok: false, message: 'Please sign in with GitHub first.', reauthRequired: true }

  const contributor = await findByGithubId(session.github.id)
  if (!contributor) return { ok: false, message: REAUTH_REQUIRED_MESSAGE, reauthRequired: true }

  const track = await findTrackBySlug(trackSlug)
  if (!track) return { ok: false, message: 'This track no longer exists.' }

  try {
    await requestToJoinTrack(track.id, contributor.githubId)
    return { ok: true }
  } catch (error) {
    console.error(`requestToJoinTrackAction(${trackSlug}, ${contributor.githubId}) failed:`, error)
    return { ok: false, message: 'Could not submit your request right now. Please try again in a moment.' }
  }
}

/**
 * IDEA-018 — the nomination picker's search, reachable from both the track
 * page and the Track Leaders page's per-track "Nominate" (the same dialog
 * component drives both). Signed out gets an empty list, not an error — a
 * search box behind a sign-in gate has no business leaking anything either
 * way, same reasoning as searchContributorsAction (app/actions.ts).
 */
export async function searchTrackMembersAction(trackSlug: string, query: string): Promise<NominatableMember[]> {
  const session = await getSession()
  if (!session.github) return []

  const track = await findTrackBySlug(trackSlug)
  if (!track) return []

  // The caller's Admin role decides the Telegram/LinkedIn lock guard —
  // same caller/isAdmin pattern as searchContributorsAction.
  const caller = await findByGithubId(session.github.id)
  return searchNominatableMembers(track.id, query, { githubId: session.github.id, isAdmin: caller ? isAdmin(caller) : false })
}

export interface NominateLeaderResult {
  ok: boolean
  message?: string
  reauthRequired?: boolean
}

/**
 * IDEA-018 — records the signed-in contributor's nomination of
 * `candidateGithubId` for this track's leadership. Anyone signed in with a
 * contributor row may nominate (the leadership counterpart of
 * requestToJoinTrackAction's own gating); the candidate must be an
 * approved member of the track, which nominateTrackLeader itself
 * re-derives — this action, like every server action here, doesn't trust
 * what the client sent. Deciding nominations is not this idea: an Admin's
 * own nomination goes through the same review (IDEA-150).
 */
export async function nominateLeaderAction(trackSlug: string, candidateGithubId: string): Promise<NominateLeaderResult> {
  const session = await getSession()
  if (!session.github) return { ok: false, message: 'Please sign in with GitHub first.', reauthRequired: true }

  const contributor = await findByGithubId(session.github.id)
  if (!contributor) return { ok: false, message: REAUTH_REQUIRED_MESSAGE, reauthRequired: true }

  const track = await findTrackBySlug(trackSlug)
  if (!track) return { ok: false, message: 'This track no longer exists.' }

  try {
    const created = await nominateTrackLeader(track.id, candidateGithubId, contributor.githubId)
    return created
      ? { ok: true, message: `Nominated. An Admin will review the nomination before appointing a leader.` }
      : { ok: true, message: `You have already nominated this contributor — your nomination stands.` }
  } catch (error) {
    if (error instanceof CandidateNotMemberError) {
      return { ok: false, message: 'That contributor is not a member of this track, so they cannot be nominated for its leadership.' }
    }
    console.error(`nominateLeaderAction(${trackSlug}, ${candidateGithubId}) failed:`, error)
    return { ok: false, message: 'Could not submit the nomination right now. Please try again in a moment.' }
  }
}
