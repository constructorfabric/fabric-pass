import { Card, CardHeader, CardTitle } from '@gears-frontx/ui-kit'
import { listAdminActions, type AdminActionType } from '@/lib/audit-log'
import { findByGithubId } from '@/lib/contributors'
import { isAdmin } from '@/lib/roles'
import { getSession } from '@/lib/session'
import { Breadcrumb, HOME_BREADCRUMB } from '@/app/breadcrumb'
import { SignInPrompt } from '@/app/sign-in-prompt'

const ACTION_LABELS: Record<AdminActionType, string> = {
  confirm: 'Confirmed',
  // IDEA-071 — 'block' is historical only (no code path writes it any
  // more; see audit-log.ts's own doc comment) but stays labelled so an
  // old entry doesn't show up blank.
  block: 'Blocked',
  ignore: 'Ignored',
  accept: 'Accepted join request',
  reject: 'Rejected join request',
  remove_from_track: 'Removed from track',
  promote_to_maintainer: 'Promoted to Maintainer',
  demote_to_contributor: 'Demoted to Contributor',
  revoke_requested: 'Requested Revoke',
  revoke_approved: 'Approved Revoking',
  revoke_cancelled: 'Cancelled Revoke',
  governance_auto_approve: 'Auto-approved for Governance (track leader)',
  governance_auto_revoke: 'Auto-revoked from Governance (no longer a track leader)',
  edit_profile_field: 'Edited profile field',
}

/** IDEA-146 — `details.field` is 'name' today, the only admin-editable
 * profile field; matches ACTION_LABELS in shape (a closed set of labels,
 * one per possible value) but scoped to `edit_profile_field`'s own
 * `details` rather than a generic renderer. */
const PROFILE_FIELD_LABELS: Record<string, string> = {
  name: 'Full Name',
}

/** IDEA-146 — `entry.details` comes straight from the database as
 * `Record<string, unknown>`, so this narrows rather than trusts it: `field`
 * falls back to itself (an unrecognized value still shows as something),
 * `to` falls back to `—` the same as `from` does, even though the action
 * never logs one without the other today — a later idea's field could. */
function formatProfileFieldChange(details: Record<string, unknown>): string {
  const field = typeof details.field === 'string' ? PROFILE_FIELD_LABELS[details.field] ?? details.field : 'Field'
  const from = typeof details.from === 'string' && details.from ? details.from : '—'
  const to = typeof details.to === 'string' && details.to ? details.to : '—'
  return `${field}: "${from}" → "${to}"`
}

/**
 * IDEA-022 — Admin-only, no Track Admin view at all (decided this session;
 * the idea's own notes left the scope undecided). Logged entries come from
 * admin/actions.ts's Confirm/Block (IDEA-012) and tracks/admin/actions.ts's
 * Accept/Reject (IDEA-014), Remove (IDEA-062), and Promote/Demote
 * (IDEA-063) — see audit-log.ts's logAdminAction, called from each right
 * after its underlying write succeeds. IDEA-147/148 — also
 * team-access.ts's ensureTrackAdminsAreGovernanceContributors granting and
 * revoking Governance membership, the entries with no admin behind them at
 * all; "By System" is what an absent actorGithubLogin renders as below.
 * IDEA-146 — also admin/actions.ts's setContributorNameAction, correcting a
 * contributor's Full Name; the only entry with its own `details` rendered
 * below, via PROFILE_FIELD_LABELS.
 */
export default async function AuditLogPage() {
  const session = await getSession()
  if (!session.github) return <SignInPrompt />

  const contributor = await findByGithubId(session.github.id)
  if (!contributor || !isAdmin(contributor)) {
    return (
      <>
        <h2>Not authorized</h2>
        <p className="subtitle">This page is only available to Admins.</p>
      </>
    )
  }

  const actions = await listAdminActions()

  return (
    <>
      <Breadcrumb path={[HOME_BREADCRUMB, { label: 'Members', href: '/admin' }]} />
      <h2>Audit log</h2>
      <p className="subtitle">
        Every Confirm/Ignore, Accept/Reject, Remove, Promote/Demote, and Revoke decision made through this app, plus
        Full Name corrections and the automatic Governance approvals and revocations the app makes on its own.
      </p>
      {actions.length === 0 ? (
        <p className="search-empty">No actions recorded yet.</p>
      ) : (
        <div className="admin-tiles">
          {actions.map((entry) => (
            <Card size="sm" key={entry.id}>
              <CardHeader>
                <CardTitle>
                  <h3 className="card-heading">{ACTION_LABELS[entry.action]}</h3>
                </CardTitle>
                <div className="admin-tile-properties">
                  <span className="admin-tile-property">By {entry.actorGithubLogin ? `@${entry.actorGithubLogin}` : 'System'}</span>
                  {entry.targetGithubLogin ? <span className="admin-tile-property">To @{entry.targetGithubLogin}</span> : null}
                  {entry.trackName ? <span className="admin-tile-property">Track: {entry.trackName}</span> : null}
                  {entry.action === 'edit_profile_field' ? (
                    <span className="admin-tile-property">{formatProfileFieldChange(entry.details)}</span>
                  ) : null}
                  <span className="admin-tile-property">{entry.createdAt.toLocaleString()}</span>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
