import { Badge } from '@gears-frontx/ui-kit'

/**
 * IDEA-067 — the simplified, cross-page reading of "has an Admin confirmed
 * this person": Stranger (not yet, or no longer) vs. Contributor. Distinct
 * from the Admin table's own finer-grained status badge (Draft/Confirmed/
 * Ignored/Pending Revoke/Revoked, IDEA-071) — that one exists for an Admin
 * deciding which action to take; this one is the same plain label everyone
 * else sees. `variant="muted"` for Contributor is a deliberate match to the
 * Track Admin list's existing Contributor-role badge — the same word, same
 * look, wherever either appears.
 */
export function IdentityBadge({ confirmed }: { confirmed: boolean }) {
  return (
    <Badge
      variant={confirmed ? 'muted' : 'warning'}
      title={confirmed ? 'Confirmed by an Admin' : 'Not yet confirmed by an Admin'}
    >
      {confirmed ? 'Contributor' : 'Stranger'}
    </Badge>
  )
}
