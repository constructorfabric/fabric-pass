# PRD: GitHub Real Names Browser Extension

## Goal

Create a browser extension that shows a person's real name next to their GitHub username on GitHub pages.

The extension works on a locally loaded mapping. The primary data source is the Constructor Fabric
contributor registry `cf-internal/pass/contributors.yaml`; simplified JSON and CSV are also supported.

Minimal logical mapping:

```json
{
  "anatolyb": "Anatoly Bobrov",
  "jdoe123": "John Doe"
}
```

## Supported Browsers

* Chrome
* Firefox
* Edge
* other Chromium-based browsers

A single shared WebExtension codebase is preferred.

## Core Use Cases

If a GitHub username is present in the local mapping, the real name should be shown next to it.

Example:

```text
anatolyb · Anatoly Bobrov
```

Support display in:

* issue / PR comments
* issue / PR author
* assignees
* reviewers
* mentions
* issue / PR lists
* commit authors

The GitHub username must not be replaced — only augmented with the real name.

## Data Model

Internal model for a single record (superset of all supported import formats):

| Field | Type | Purpose |
| --- | --- | --- |
| `github_login` | string | key for matching against the DOM (case-insensitive) |
| `github_id` | string | stable identifier, key for aliases |
| `display_name` | string | computed real name to display |
| `company` | string \| null | for tooltip / future display modes |
| `email` | string \| null | for tooltip |
| `discord_username`, `telegram_username` | string \| null | for tooltip |
| `is_agent`, `is_admin` | boolean | bot / admin flags, for badges |
| `alias_of_github_id` | string \| null | reference to the canonical record of the person |
| `status` | `confirmed` \| `draft` | record quality |

All fields except `github_login` and `display_name` are optional — the simplified JSON/CSV import
only fills these two.

## Mapping Import

The extension must allow importing the mapping from:

* **YAML in `contributors.yaml` format** (primary format)
* JSON
* CSV

After import, the data is saved to browser local storage.

No data must be sent to an external server.

### `contributors.yaml` format

The file contains a single top-level key `contributors` with a list of records. A real example
of a record:

```yaml
contributors:
  - id: 174cca72-36f7-44d1-9a1c-ad84f7816710
    github_id: "301748190"
    github_login: AndrejK666
    github_name: ANDREI KUCHMA
    github_email: null
    telegram_id: null
    telegram_username: null
    telegram_phone: null
    telegram_name: null
    discord_id: "1523978701161627769"
    discord_username: andrejkuchma_56660
    discord_name: Andrej Kuchma
    linkedin_id: null
    linkedin_name: null
    name: Andrej
    email: Andrej.Kuchma@constructor.tech
    email_confirmed_at: 2026-08-03T09:34:40.656Z
    company: Constructor tech
    status: confirmed
    alias_of_github_id: null
    is_agent: false
    is_admin: false
    profile_completeness: ready
    created_at: 2026-08-03T09:33:22.475Z
    updated_at: 2026-09-06T22:43:08.838Z
```

Notable properties of the format that the parser must account for:

* The key for matching against the GitHub UI is `github_login`; it is always populated.
* `github_name` is **not** a reliable source of the real name: in the current registry of 74
  records it is `null` in 34 cases, and in roughly another third of cases it contains a nickname
  (`Artifizer`, `Bit Flip`, `Entropy Shift`, `MikeY`). The canonical human name lives in the `name`
  field.
* Empty values arrive as YAML `null`, not as a missing key or an empty string.
* `github_id` is a quoted string, not a number; do not cast it to a number (there is no need to
  worry about losing leading zeros or precision, but comparisons must be string-based).
* Dates are ISO 8601 UTC; the extension does not interpret them, other than showing the "registry
  export date" if it is available.
* `alias_of_github_id` is a secondary account of the same person; the current registry has one
  such record.
* The fields `id`, `email_confirmed_at`, `created_at`, `updated_at`, `profile_completeness`,
  `linkedin_*`, `telegram_phone` are not used by the extension, but the parser must silently
  ignore them rather than fail.
* The registry may contain records with `status: draft` — these should not be shown by default.

### Rules for computing `display_name`

Priority order of name sources:

1. `name`
2. `github_name`
3. `discord_name`
4. `telegram_name`
5. `linkedin_name`

Additional rules:

* If none of the fields is populated, the record is skipped.
* If the computed name, after normalization (lowercase, removing spaces, `.`, `_`, `-`), matches
  `github_login`, the name is not shown: it carries no information (e.g. `ktursunov` →
  `KTursunov`, `Artifizer` → `Artifizer` when `name` is absent).
* Names in all caps (`ANDREI ILIUSHIN`, `OLEKSII SHPONARSKYI`) are converted to Title Case for
  display; the original value is preserved.
* If `alias_of_github_id` is populated and points to an existing record, show the name of the
  canonical record. If the target record does not exist, use the alias's own name.
* Records with `status: draft` are not shown by default (toggle in Settings).
* Records with `is_agent: true` are marked as bot/agent and do not get a real name by default.

### Simplified formats

JSON — a flat `login → name` object, or an array of objects with fields from the Data Model:

```json
{
  "anatolyb": "Anatoly Bobrov",
  "jdoe123": "John Doe"
}
```

CSV — required columns `github` (or `github_login`) and `real_name` (or `name`); other columns
that match Data Model fields are picked up:

```csv
github,real_name
anatolyb,Anatoly Bobrov
jdoe123,John Doe
```

## UI

Minimal Settings page:

* Import YAML / JSON / CSV (format is determined by extension and content)
* number of loaded mappings
* number of skipped records with reasons (no name, name matches login, `draft`, `is_agent`)
* date of the last import
* clear mapping

Optional:

* choose the display format:

  * `username · Real Name`
  * `Real Name [username]`
  * `username (Real Name)`
* show/hide records with `status: draft`
* show a badge for `is_admin` / `is_agent`

## GitHub Integration

The extension must work via a content script on:

```text
https://github.com/*
```

Requirements:

* find GitHub usernames in the DOM
* match them against `github_login` case-insensitively
* add the real name next to them
* avoid adding the name more than once
* support dynamically loaded GitHub UI via `MutationObserver`
* do not use the GitHub API

## Non-Functional Requirements

* TypeScript
* WXT/WebExtensions preferred
* no backend
* no GitHub token
* minimal browser permissions
* mapping is stored locally only
* YAML parsing is done locally, with a built-in library; the current registry is 74 records /
  ~1850 lines, parsing must not block the UI
* works correctly with a mapping of at least 10,000 users
* importing a file with unknown or extra fields must not cause an error

## Future Scope

Not part of the MVP, but the architecture must allow adding:

* GitLab
* Bitbucket
* automatic synchronization of `contributors.yaml` with a local/internal HTTP endpoint or a git
  repository
* additional fields: team, department, role
* hover tooltip with extended information — company, email, Discord, Telegram
