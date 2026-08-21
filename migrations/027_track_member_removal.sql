-- IDEA-062. A Track Admin can decide a pending request (IDEA-014) but
-- couldn't previously undo an approval — `removed` is a fourth status,
-- distinct from `rejected`: a removed member's row shows they *were*
-- approved and later removed, not that they were declined at the door.
-- Postgres names an inline CHECK on one column <table>_<column>_check by
-- default, which is what 015_track_members.sql's own CHECK got.
ALTER TABLE track_members
  DROP CONSTRAINT track_members_status_check,
  ADD CONSTRAINT track_members_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'removed'));
