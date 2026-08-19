'use server'

import { findByGithubId } from '@/lib/contributors'
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
