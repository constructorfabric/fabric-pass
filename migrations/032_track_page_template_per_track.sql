-- IDEA-117. Restructures track_page_template from a singleton row shared
-- across every track (migrations/014) to one row per track — each Track
-- Admin can now edit only their own track's page content
-- (pass/track-pages/<slug>.md, one file per track, replacing the single
-- shared pass/track-page.md this table used to back).
--
-- Built as a fresh table rather than an in-place ALTER: the old
-- `id boolean PRIMARY KEY DEFAULT true CHECK (id)` singleton trick's
-- implicit NOT NULL survives dropping the PK constraint, which would
-- otherwise block inserting the new per-track rows before `id` itself is
-- gone. Simpler and just as safe for a one-row table.
CREATE TABLE track_page_template_new (
  track_id   uuid PRIMARY KEY REFERENCES tracks (id) ON DELETE CASCADE,
  content    text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Carry today's one shared template forward as every current track's
-- starting content — a mechanical migration, not new authoring.
-- cf-internal's own pass/track-pages/<slug>.md files (the real source of
-- truth going forward) overwrite this backfill on the very next sync.
INSERT INTO track_page_template_new (track_id, content, updated_at)
SELECT t.id, s.content, s.updated_at FROM tracks t, track_page_template s WHERE s.id = true;

DROP TABLE track_page_template;
ALTER TABLE track_page_template_new RENAME TO track_page_template;
ALTER TABLE track_page_template RENAME CONSTRAINT track_page_template_new_pkey TO track_page_template_pkey;
ALTER TABLE track_page_template RENAME CONSTRAINT track_page_template_new_track_id_fkey TO track_page_template_track_id_fkey;
