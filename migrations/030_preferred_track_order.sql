-- IDEA-074. A single global display-order preference for tracks, driving
-- both the Tracks directory (tracks.ts's listTracks) and per-contributor
-- track-participation labels (track-members.ts's listTrackParticipation) —
-- see both functions' own ORDER BY for how array_position resolves this
-- against a track's name. A native array (not jsonb, unlike every other
-- list-shaped app_config/tracks column, e.g. tracks.repositories)
-- specifically because array_position() only operates on a real Postgres
-- array. A track name with no match in this list, or this column left NULL
-- (unset, or before the first config sync), falls back to plain
-- alphabetical order — see the COALESCE in both ORDER BY clauses. A name
-- listed here with no matching track (e.g. a track not yet created) is
-- silently inert, not an error.
ALTER TABLE app_config
  ADD COLUMN preferred_track_order text[];
