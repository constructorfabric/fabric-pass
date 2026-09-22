-- IDEA-147. ensureTrackAdminsAreGovernanceContributors (IDEA-116,
-- lib/team-access.ts) approves a track admin into Governance on every
-- pass/tracks.yaml sync — a real, repeatable decision, but logAdminAction
-- was never called for it, so the audit log showed nothing at all rather
-- than a decision with no human actor. actor_github_id must become
-- nullable to log that honestly, instead of inventing an admin who never
-- clicked anything.
ALTER TABLE admin_actions
  ALTER COLUMN actor_github_id DROP NOT NULL;

-- Backfill: decided_by_github_id is NULL on an 'approved' track_members row
-- only when ensureTrackAdminsAreGovernanceContributors wrote it — every
-- other writer (decideJoinRequest, removeTrackMember) always takes a real
-- admin's github_id. Restores the audit trail for grants that already
-- happened silently, not just future ones. The decided_at IS NOT NULL
-- guard excludes a row that somehow violates that function's own "always
-- sets decided_at" invariant, since admin_actions.created_at is itself
-- NOT NULL with no sensible fallback value to backfill it with.
INSERT INTO admin_actions (actor_github_id, action, target_github_id, track_id, details, created_at)
SELECT NULL, 'governance_auto_approve', tm.github_id, tm.track_id,
       '{"reason": "track_admin"}'::jsonb, tm.decided_at
  FROM track_members tm
 WHERE tm.status = 'approved' AND tm.decided_by_github_id IS NULL AND tm.decided_at IS NOT NULL;
