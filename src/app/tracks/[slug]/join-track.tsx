'use client'

import { Badge, Button } from '@gears-frontx/ui-kit'
import { useState } from 'react'
import { ActionMessage } from '@/app/action-message'
import { StatusMark } from '@/app/marks'
import { requestToJoinTrackAction } from './actions'

type MembershipStatus = 'pending' | 'approved' | 'rejected' | 'removed' | null

const STATUS_LABELS: Record<Exclude<MembershipStatus, null>, string> = {
  pending: 'Pending review',
  approved: 'Member',
  rejected: 'Declined',
  // IDEA-062 — distinct from 'Declined': this member *was* approved and was
  // later removed by a Track Admin, not turned down at the door.
  removed: 'Removed',
}

/** Semantic intents, not colors — the kit Badge's whole vocabulary. */
const STATUS_VARIANTS: Record<Exclude<MembershipStatus, null>, 'warning' | 'success' | 'danger'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  removed: 'danger',
}

/**
 * IDEA-013's "Request to join" action, plus IDEA-019's in-app half of
 * telling the requester where their request stands — the email half is
 * sent when a Track Admin decides (see tracks/admin/actions.ts), this is
 * just what the requester sees on their own next visit to the page.
 */
export function JoinTrack({ trackSlug, initialStatus }: { trackSlug: string; initialStatus: MembershipStatus }) {
  const [status, setStatus] = useState(initialStatus)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string>()
  const [reauthRequired, setReauthRequired] = useState(false)

  async function request() {
    setPending(true)
    setMessage(undefined)
    setReauthRequired(false)
    const result = await requestToJoinTrackAction(trackSlug)
    setPending(false)
    if (!result.ok) {
      setMessage(result.message)
      setReauthRequired(Boolean(result.reauthRequired))
      return
    }
    setStatus('pending')
  }

  return (
    <div className="track-membership">
      {status ? (
        <Badge variant={STATUS_VARIANTS[status]} icon={<StatusMark />}>
          {STATUS_LABELS[status]}
        </Badge>
      ) : null}
      <ActionMessage message={message} reauthRequired={reauthRequired} />
      {status === null || status === 'rejected' || status === 'removed' ? (
        <Button loading={pending} onClick={request}>
          {status === null ? 'Request to join' : 'Request again'}
        </Button>
      ) : null}
    </div>
  )
}
