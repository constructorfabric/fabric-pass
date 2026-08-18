-- IDEA-053. A default, org-wide GitHub team every confirmed contributor
-- gets added to on invite — configured once via pass/config.yaml, same
-- one-way sync as app_config's other fields (migrations/018), rather than
-- hardcoded or requiring an SSH session + redeploy to change.
ALTER TABLE app_config
  ADD COLUMN github_contributors_team text;

-- Mirrors contributors' existing github_org_invited_at/discord_invited_at
-- (migrations/019) — stamped on attempt, not just success, backing the
-- same Re-invite affordance those two already have.
ALTER TABLE contributors
  ADD COLUMN github_contributors_team_added_at timestamptz;
