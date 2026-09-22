-- IDEA-151 — a second, per-track Discord role: the moderating one, separate
-- from discord_role_id (IDEA-042), which holds the *membership* role every
-- approved member gets. The moderator role is granted on leader appointment
-- and revoked on demotion (lib/team-access.ts's grantLeaderAccess/
-- revokeLeaderAccess), mirroring how the membership role tracks join
-- approval. Nullable — a track whose pass/tracks.yaml row predates this
-- key, or deliberately has no moderators, simply never grants one.
ALTER TABLE tracks ADD COLUMN discord_moderator_role_id text;
