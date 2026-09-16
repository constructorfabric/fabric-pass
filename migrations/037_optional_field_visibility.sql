-- IDEA-110. One boolean per lockable optional field, the same tradeoff
-- 022_checklist_states.sql already documents for its own per-item
-- *_hidden_at columns: a JSON blob or a generic key-value table would scale
-- to an open-ended set of fields, but the optional-field set here is small
-- and closed (Telegram and LinkedIn today; the four mandatory fields — Full
-- Name, Email, Company, Discord — are out of scope by design and get no
-- column at all, since a contributor can't hide the very things this app
-- requires everyone else to be able to reach them by).
--
-- `NOT NULL DEFAULT false` means "visible to all contributors" — today's
-- behavior, unchanged — so no backfill is needed: every existing row keeps
-- exactly the visibility it already has the instant this migration lands.
ALTER TABLE contributors
  ADD COLUMN telegram_admins_only boolean NOT NULL DEFAULT false,
  ADD COLUMN linkedin_admins_only boolean NOT NULL DEFAULT false;
