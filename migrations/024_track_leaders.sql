-- IDEA-055. A track's five named leader roles (Product Manager, Architect,
-- Developer, Quality, Researcher — IDEA-010) each held exactly one person,
-- as one `*_github_id` column per role. A role can genuinely have more than
-- one person (most visibly once Gears/Gears BSS/Gears OSS merge into one
-- track, IDEA-056), so leaders move to a junction table — the same
-- many-to-many shape track_admins already uses (migrations/010_tracks.sql)
-- — rather than adding more nullable per-role columns. "Up to 3" is an
-- app-level cap enforced at sync time (tracks.ts's syncTracks), not a
-- database constraint, so it can change without another migration.
CREATE TABLE track_leaders (
  track_id  uuid   NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  role      text   NOT NULL CHECK (role IN ('product_manager', 'architect', 'developer', 'quality', 'researcher')),
  github_id bigint NOT NULL REFERENCES contributors (github_id),
  PRIMARY KEY (track_id, role, github_id)
);

-- Backfill every existing single-value leader before dropping the columns
-- that held them.
INSERT INTO track_leaders (track_id, role, github_id)
SELECT id, 'product_manager', product_manager_github_id FROM tracks WHERE product_manager_github_id IS NOT NULL
UNION ALL
SELECT id, 'architect', architect_github_id FROM tracks WHERE architect_github_id IS NOT NULL
UNION ALL
SELECT id, 'developer', developer_github_id FROM tracks WHERE developer_github_id IS NOT NULL
UNION ALL
SELECT id, 'quality', quality_github_id FROM tracks WHERE quality_github_id IS NOT NULL
UNION ALL
SELECT id, 'researcher', researcher_github_id FROM tracks WHERE researcher_github_id IS NOT NULL;

ALTER TABLE tracks
  DROP COLUMN product_manager_github_id,
  DROP COLUMN architect_github_id,
  DROP COLUMN developer_github_id,
  DROP COLUMN quality_github_id,
  DROP COLUMN researcher_github_id;
