import { Card, CardHeader, CardTitle } from '@gears-frontx/ui-kit'
import { listAdminActions, type AdminActionType } from '@/lib/audit-log'
import { findByGithubId } from '@/lib/contributors'
import { isAdmin } from '@/lib/roles'
import { getSession } from '@/lib/session'
import { SignInPrompt } from '@/app/sign-in-prompt'

const ACTION_LABELS: Record<AdminActionType, string> = {
  confirm: 'Confirmed',
  block: 'Blocked',
  accept: 'Accepted join request',
  reject: 'Rejected join request',
}

/**
 * IDEA-022 — Admin-only, no Track Admin view at all (decided this session;
 * the idea's own notes left the scope undecided). Logged entries come from
 * admin/actions.ts's Confirm/Block (IDEA-012) and tracks/admin/actions.ts's
 * Accept/Reject (IDEA-014) — see audit-log.ts's logAdminAction, called from
 * both right after their underlying write succeeds.
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
      <h2>Audit log</h2>
      <p className="subtitle">Every Confirm/Block and Accept/Reject decision made through this app.</p>
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
