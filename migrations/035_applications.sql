-- IDEA-121. A Fabric-Admin-only registry of external applications, each
-- with its own API key — same generate/mask/regenerate mechanic as
-- IDEA-119's personal keys (migrations/034_contributor_api_keys.sql), just
-- keyed on an application instead of a contributor. `contact_name`/
-- `contact_email` are plain free text, not linked to any contributor row
-- — an application's admin contact isn't necessarily a fabric-pass user.
CREATE TABLE applications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  contact_name  text NOT NULL,
  contact_email text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- One key per application, same "at most one, PK enforces it" shape as
-- contributor_api_keys.
CREATE TABLE application_api_keys (
  application_id uuid PRIMARY KEY REFERENCES applications (id) ON DELETE CASCADE,
  key_hash       text NOT NULL,
  key_prefix     text NOT NULL,
  key_suffix     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX application_api_keys_key_hash_idx ON application_api_keys (key_hash);
