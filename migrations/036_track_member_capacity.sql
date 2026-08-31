-- IDEA-122. A Track Admin's per-member capacity ratio, per track — an
-- append-only history rather than a single mutable column, so a member's
-- capacity at any past point stays reconstructable, not just the current
-- value. "Current" is the row with no `effective_until` yet; a track
-- member with no row at all defaults to full capacity (1 = 100%), per the
-- idea's own "by default it should be 1" — no backfill needed for
-- existing members.
CREATE TABLE track_member_capacity (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id         uuid NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  github_id        bigint NOT NULL REFERENCES contributors (github_id),
  ratio            numeric(4, 3) NOT NULL CHECK (ratio >= 0 AND ratio <= 1),
  effective_from   timestamptz NOT NULL DEFAULT now(),
  effective_until  timestamptz
);

-- At most one *current* (effective_until IS NULL) row per (track, member) —
-- a partial unique index, not a plain one, since the history itself can
-- (and will) have many closed-out rows for the same pair.
CREATE UNIQUE INDEX track_member_capacity_current_idx
  ON track_member_capacity (track_id, github_id)
  WHERE effective_until IS NULL;

-- Reading "every current ratio for this track" (the member-list screen)
-- and "every current ratio for this contributor across tracks" (the
-- Fabric-wide sum) are the two access patterns this table exists for.
CREATE INDEX track_member_capacity_github_id_idx ON track_member_capacity (github_id) WHERE effective_until IS NULL;
