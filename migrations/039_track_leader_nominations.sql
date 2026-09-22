-- IDEA-018 — leadership nominations, the counterpart to IDEA-013's join
-- requests: contributor-initiated (nominate), admin-decided (IDEA-150),
-- entirely in-app, the same category of app-owned state track_members
-- already is — nothing here belongs in pass/tracks.yaml. No sync route.
--
-- One row per (track, candidate, nominator), by construction: several
-- people can nominate the same candidate and those nominations accumulate
-- rather than overwrite each other — that count is exactly what IDEA-150's
-- vote label reads. A nominator repeating their own nomination is the same
-- row (ON CONFLICT DO NOTHING in leader-nominations.ts), not a second one.
CREATE TABLE track_leader_nominations (
  track_id            uuid   NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  candidate_github_id bigint NOT NULL REFERENCES contributors (github_id),
  nominator_github_id bigint NOT NULL REFERENCES contributors (github_id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (track_id, candidate_github_id, nominator_github_id)
);

-- The Track Leaders page lists candidates per track with their vote counts
-- (IDEA-150); the nomination picker itself always knows the caller's own
-- nominations by the primary key.
CREATE INDEX track_leader_nominations_track_idx ON track_leader_nominations (track_id, candidate_github_id);
