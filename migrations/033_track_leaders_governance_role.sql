-- IDEA-118. Adds `governance` as a sixth valid track_leaders role — a
-- non-technical, administrative role any track can use (not just
-- Governance's own), alongside the original five technical disciplines
-- (migrations/024_track_leaders.sql).
ALTER TABLE track_leaders DROP CONSTRAINT track_leaders_role_check;
ALTER TABLE track_leaders
  ADD CONSTRAINT track_leaders_role_check
  CHECK (role IN ('product_manager', 'architect', 'developer', 'quality', 'researcher', 'governance'));
