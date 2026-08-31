-- IDEA-119. One personal API key per contributor — `github_id` as the
-- primary key enforces "at most one" directly, rather than an app-level
-- check: generating/regenerating is an upsert against this same row, never
-- a second insert.
--
-- Only a fast SHA-256 hash of the full key is stored (`key_hash`) — a
-- high-entropy random token isn't guessable the way a human-chosen
-- password is, so a slow password KDF (bcrypt/argon2) buys nothing here
-- and would slow down every API request that presents a key. `key_prefix`/
-- `key_suffix` are plain text on purpose — they're exactly the few
-- characters this app itself always shows back to the owner for masked
-- display, not a secret.
CREATE TABLE contributor_api_keys (
  github_id  bigint PRIMARY KEY REFERENCES contributors (github_id) ON DELETE CASCADE,
  key_hash   text NOT NULL,
  key_prefix text NOT NULL,
  key_suffix text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- IDEA-120's auth check looks up a presented key by its hash on every API
-- request — needs to be fast and needs uniqueness (two contributors must
-- never collide on the same generated token).
CREATE UNIQUE INDEX contributor_api_keys_key_hash_idx ON contributor_api_keys (key_hash);
