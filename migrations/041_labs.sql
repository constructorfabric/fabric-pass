-- IDEA-156. A Lab is a standalone research or prototyping effort — one or
-- more repositories that belong to no track — with its own Leaders and
-- Maintainers. Unlike tracks (migrations/010_tracks.sql, owned by
-- cf-internal's pass/tracks.yaml and synced *into* this app), Labs are
-- created and edited by a Fabric Admin in this app and exported *out* to
-- pass/labs.yaml, the same direction track_members takes (IDEA-123).
--
-- The slug is the stable key and never changes after creation: IDEA-157
-- names a Lab's GitHub teams after it (`{slug}-leaders`,
-- `{slug}-maintainers`), the same convention tracks use, so it also must
-- not collide with a track's slug — checked in labs.ts's createLab, since
-- the two live in different tables. Its shape is a GitHub team slug's own:
-- lowercase words joined by single hyphens.
--
-- repositories is jsonb for the same reason it is on tracks: always read
-- and written as one small, admin-curated list.
CREATE TABLE labs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name         text NOT NULL,
  description  text,
  repositories jsonb NOT NULL DEFAULT '[]',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One row per person per Lab, so a person holds exactly one role on a given
-- Lab: switching Maintainer -> Leader is an UPDATE, never a second row.
-- No cap on how many people hold a role — unlike track leaders'
-- MAX_LEADERS_PER_ROLE, nothing here has asked for one.
CREATE TABLE lab_people (
  lab_id             uuid        NOT NULL REFERENCES labs (id) ON DELETE CASCADE,
  github_id          bigint      NOT NULL REFERENCES contributors (github_id),
  role               text        NOT NULL CHECK (role IN ('leader', 'maintainer')),
  added_at           timestamptz NOT NULL DEFAULT now(),
  added_by_github_id bigint      REFERENCES contributors (github_id),
  PRIMARY KEY (lab_id, github_id)
);

CREATE INDEX lab_people_github_id_idx ON lab_people (github_id);
