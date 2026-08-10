-- IDEA-047. Four nullable timestamps on contributors, matching this
-- codebase's established "did X happen, and when" convention (e.g.
-- email_confirmed_at, github_org_invited_at) rather than an explicit
-- todo/done/hidden enum column per item — "done" is derived at read time
-- from data that already exists (profile_completeness, track membership)
-- or from policy_link_clicked_at below; only "hidden" needs its own state,
-- since nothing else in the system would ever produce it.
--
-- Three checklist items today (IDEA-015: profile, policies, track) means
-- three *_hidden_at columns, one per item — a future fourth item needs a
-- fourth column. Simple for exactly three items; see IDEA-047's own Notes
-- in ideas.md for the tradeoff against a more general key-value model.
ALTER TABLE contributors
  ADD COLUMN policy_link_clicked_at         timestamptz,
  ADD COLUMN checklist_profile_hidden_at    timestamptz,
  ADD COLUMN checklist_policies_hidden_at   timestamptz,
  ADD COLUMN checklist_track_hidden_at      timestamptz;

-- Backfill: before this migration, a fully-complete profile made the
-- *entire* checklist disappear (IDEA-015's own profile_completeness gate) —
-- this migration replaces that with per-item hiding, which starts every row
-- unhidden. Without a backfill, every contributor who had already finished
-- and stopped seeing the checklist would see it reappear, fully done, the
-- moment this ships — including this app's own already-confirmed, already-
-- complete accounts in production. Only backfills what was already true
-- under the old system; nobody is marked as having read policies, since
-- that signal (policy_link_clicked_at) never existed before now and no
-- prior click was ever actually recorded.
UPDATE contributors SET checklist_profile_hidden_at = now()
  WHERE profile_completeness IN ('ready', 'complete');

UPDATE contributors SET checklist_track_hidden_at = now()
  WHERE github_id IN (SELECT github_id FROM track_members WHERE status = 'approved');
