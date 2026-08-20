-- IDEA-060. A single global naming convention for a track's GitHub team
-- (e.g. "{track}-contributors") replaces the per-track `github_team` column
-- — nothing in the real pass/tracks.yaml ever set it, and a global pattern
-- means every track's team follows the same convention without hand-typing
-- each one. The team slug is computed from this pattern plus a track's own
-- slug at grant time (lib/team-access.ts), not stored per track.
ALTER TABLE app_config
  ADD COLUMN github_track_team_pattern text;

ALTER TABLE tracks
  DROP COLUMN github_team;
