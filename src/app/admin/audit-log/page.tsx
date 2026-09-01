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
}

/**
 * IDEA-022 — Admin-only, no Track Admin view at all (decided this session;
 * the idea's own notes left the scope undecided). Logged entries come from
 * admin/actions.ts's Confirm/Block (IDEA-012) and tracks/admin/actions.ts's
 * Accept/Reject (IDEA-014), Remove (IDEA-062), and Promote/Demote
 * (IDEA-063) — see audit-log.ts's logAdminAction, called from each right
 * after its underlying write succeeds.
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
        Every Confirm/Ignore, Accept/Reject, Remove, Promote/Demote, and Revoke decision made through this app.
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
                  <span className="admin-tile-property">By @{entry.actorGithubLogin}</span>
                  {entry.targetGithubLogin ? <span className="admin-tile-property">To @{entry.targetGithubLogin}</span> : null}
                  {entry.trackName ? <span className="admin-tile-property">Track: {entry.trackName}</span> : null}
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
