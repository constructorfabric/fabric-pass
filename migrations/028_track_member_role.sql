-- IDEA-063. Every approved track_members row now has a role — 'contributor'
-- (the default; every existing approved row becomes one) or 'maintainer',
-- promoted/demoted by a Track Admin (lib/team-access.ts's
-- promoteToMaintainer/demoteToContributor). Only meaningful once
-- status = 'approved' — same "not enforced in SQL, guarded in application
-- code" reasoning as track_leaders' MAX_LEADERS_PER_ROLE cap.
ALTER TABLE track_members
  ADD COLUMN role text NOT NULL DEFAULT 'contributor' CHECK (role IN ('contributor', 'maintainer'));

-- The naming convention for a track's *maintainer* GitHub team (e.g.
-- "{track}-maintainers"), parallel to app_config.github_track_team_pattern
-- (IDEA-060, which names the *contributor* team). {track} is replaced with
-- a track's own slug at grant time, same mechanism, different team.
ALTER TABLE app_config
  ADD COLUMN github_track_maintainer_team_pattern text;
