-- IDEA-165 — community events shown on Home to confirmed contributors only.
-- Entirely owned by the `events:` list in cf-internal's
-- pass/artifact-links.yaml, synced one-way by the same
-- /internal/artifact-links/sync call as artifact_links
-- (migrations/013_artifact_links.sql) and with the same full-replace on every
-- sync. The data lives in cf-internal rather than in this repository because
-- recording links carry meeting passcodes and fabric-pass is public.
--
-- `recordings` is a jsonb array of {label, url} objects in the file's own
-- order: they're only ever read together with their event, never queried on
-- their own, so a child table would add a join and nothing else.
CREATE TABLE events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text NOT NULL,
  starts_on  date NOT NULL,
  ends_on    date NOT NULL CHECK (ends_on >= starts_on),
  place      text,
  agenda_url text,
  recordings jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
