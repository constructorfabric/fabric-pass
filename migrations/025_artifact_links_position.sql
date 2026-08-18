-- IDEA-057. artifact_links previously had no explicit order — listArtifactLinks
-- sorted by category then label (alphabetical), so an admin's chosen order in
-- pass/artifact-links.yaml was silently discarded. `position` preserves the
-- file's own order: syncArtifactLinks stamps it as each link's index in the
-- file (0-based, within its full-replace transaction), and listArtifactLinks
-- reads back ordered by it instead.
ALTER TABLE artifact_links ADD COLUMN position integer NOT NULL DEFAULT 0;
