-- IDEA-071. Revoking a confirmed contributor's access is destructive enough
-- (removes them from the default GitHub team and from the GitHub org
-- entirely) to require a second Admin's sign-off before it actually
-- happens — the first Admin's click only *requests* it. 'revoke_pending'
-- is that in-between state; 'revoked' is the terminal one once a second
-- Admin approves, kept distinct from 'blocked' ("Ignored") — a former
-- contributor's history should read differently from a stranger who was
-- never confirmed at all.
--
-- The three revoke columns are transient while `revoke_pending` (who
-- requested it, why, when — enough for a second Admin to decide without
-- digging through the audit log) and are then kept, not cleared, once
-- `revoked` — a visible "who/why" record directly on the row. `blocked`'s
-- DB value itself is untouched by this migration; only its display label
-- becomes "Ignored" (see contributor-status-labels.ts).
ALTER TABLE contributors
  DROP CONSTRAINT contributors_status_check,
  ADD CONSTRAINT contributors_status_check
    CHECK (status IN ('draft', 'confirmed', 'blocked', 'revoke_pending', 'revoked')),
  ADD COLUMN revoke_requested_by_github_id bigint REFERENCES contributors (github_id),
  ADD COLUMN revoke_reason text,
  ADD COLUMN revoke_requested_at timestamptz;
