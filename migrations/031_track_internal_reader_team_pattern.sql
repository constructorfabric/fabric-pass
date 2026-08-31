-- IDEA-115. The naming pattern for a track's *internal-readers* GitHub
-- team, e.g. "{track}-internal-readers" — parallel to
-- github_track_team_pattern / github_track_maintainer_team_pattern, same
-- {track} replacement (lib/team-access.ts's trackGithubTeamSlug). Unlike
-- those two, this team is never created by this app (lib/github-org.ts's
-- teamExists gates it) — it only grants membership to a team an org owner
-- already wired up with its own repo permissions on GitHub's side.
ALTER TABLE app_config
  ADD COLUMN github_track_internal_reader_team_pattern text;
