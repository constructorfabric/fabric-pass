# Fabric Pass

Part of [Constructor Fabric](https://constructorfabric.org). Fabric Pass is a directory of an open-source project's contributors, collected through a single link. A contributor signs in with GitHub, which creates their one row immediately, keyed by GitHub account; from there, filling in a short profile and linking Telegram, Discord, and/or LinkedIn each autosave as they happen, with no separate save step for any one field. A returning contributor whose profile is complete lands on Main, which shows a search box for finding other `confirmed` contributors (see [Finding other contributors](#finding-other-contributors)); one still missing Name or Email lands on Profile in edit mode instead — Main redirects there until it is. Opening Profile from the top-right user menu instead shows the existing row read-only until Edit is clicked.

The registry stores each linked provider's numeric ID (which never changes), its current username, and — already part of each provider's public profile, at no extra OAuth scope — its current name; or, for a Telegram account with no username, a phone number given with consent. LinkedIn is the exception to "current username": its OpenID Connect profile carries no username or vanity-URL claim at all, so only its ID and name are stored. GitHub's public email is stored the same way, when the account has one set, and is confirmed immediately since GitHub already verified it; an email the contributor types themselves goes through [its own confirmation flow](#email-confirmation) instead, since nothing vouches for that one. It stores no avatars and no access or refresh tokens. The data is read directly from Postgres (see [Reading the data](#reading-the-data)), via the [Admin page](#roles--admin) for a signed-in Admin, or via [the cf-internal registry sync](#contributors-registry-sync) for the fields it owns.

## Data collected

The `contributors` table (`migrations/001_contributors.sql`, reshaped by `migrations/002_contributor_name_and_nullable_fields.sql`, `migrations/003_telegram_id_as_text.sql`, `migrations/004_provider_profile_fields.sql`, `migrations/005_contributor_status.sql`, `migrations/006_alias_and_agent_fields.sql`, `migrations/007_email_confirmation.sql`, `migrations/008_linkedin_fields.sql`, `migrations/009_admin_role.sql`, `migrations/011_blocked_status.sql`, and `migrations/012_profile_completeness.sql`):

| Column(s) | Notes |
|---|---|
| `id` | Internal primary key (UUID) — not used as a join key anywhere; `github_id` is |
| `github_id`, `github_login` | GitHub's numeric user ID (the record key, unique) and current login |
| `github_name`, `github_email` | From GitHub's own public profile, refreshed on every sign-in — not what's typed into the form below. `github_email` is specifically whichever address (if any) the account holder has chosen to make public; GitHub exposes nothing more without asking for an additional scope, so this is often null |
| `telegram_id`, `telegram_username`, `telegram_phone`, `telegram_name` | Telegram's ID (unique) — stored as text, since it isn't bounded to 64 bits the way a `bigint` is (`discord_id` below was already text for the same reason); current `@username`, or a phone number when the account has none; `telegram_name` from the account's own profile |
| `discord_id`, `discord_username`, `discord_name` | Discord's snowflake ID (unique), current username, and current display name (`global_name`) |
| `linkedin_id`, `linkedin_name` | LinkedIn's ID (unique, stored as text — same reasoning as `telegram_id`) and current display name. No `linkedin_username`: LinkedIn's OIDC profile has no username or vanity-URL claim, so `linkedin_name` is the only label there is. This app's only *optional* provider — see [Environment variables](#environment-variables) |
| `name`, `company` | Entered directly in the form, one field at a time as it autosaves; both optional — a blank value clears the column |
| `email` | Entered directly in the form, same as `name`/`company` — but see [Email confirmation](#email-confirmation): saving a new value here has side effects beyond this one column |
| `email_confirmed_at` | Set the moment `email` is confirmed; `null` until then. Owned by this app, not the registry sync — exported for visibility, never imported back (see [Email confirmation](#email-confirmation)) |
| `email_confirmation_token`, `email_confirmation_sent_at` | The pending confirmation's bearer token and when it was sent, used to serve `/confirm-email` and compute the 24-hour expiry. **`email_confirmation_token` is never exported anywhere** — see [Email confirmation](#email-confirmation) |
| `status` | `'draft'`, `'confirmed'`, or `'blocked'` — every contributor starts as `'draft'`. `draft`/`confirmed` transitions are owned by [the cf-internal registry sync](#contributors-registry-sync); `blocked` is the one value this app itself writes, from the [Admin page](#roles--admin)'s Confirm/Block — see that section for how the two writers coexist |
| `alias_of_github_id` | Another contributor's `github_id` — set when this row is a second registration by the same real person. `null` means this is a primary contributor, not an alias of anyone. Usually set by an admin via the registry sync, same as `status` — but also set automatically; see [Linking a Telegram/Discord/LinkedIn account already linked elsewhere](#linking-a-telegramdiscordlinkedin-account-already-linked-elsewhere) below. Either way it flows back out to the registry file on the next export. A foreign key into this same table, and constrained to never reference itself |
| `is_agent` | `true` for a bot/agent account rather than a human. Owned by the registry sync, same as `status`; defaults to `false` |
| `is_admin` | Grants the global Admin role — see [Roles & Admin](#roles--admin). Owned by the registry sync, same as `status`/`is_agent`; defaults to `false` |
| `profile_completeness` | `'incomplete'` (default), `'ready'`, or `'complete'` — derived from the columns above, recomputed by this app after every write that could change it (`src/lib/contributors.ts`'s `refreshProfileCompleteness`), never self-reported. Owned by this app, not the registry sync — exported for visibility, never imported back, same as `email_confirmed_at`. Shown on the signed-in contributor's own Profile page and as a column/filter on the [Admin page](#roles--admin) |
| `created_at`, `updated_at` | Set automatically |

None of `github_name`/`github_email`/`discord_name`/`telegram_name`/`linkedin_name` need any OAuth scope beyond what's already requested (see [Registering the OAuth applications](#registering-the-oauth-applications)) — they're already part of each provider's public-profile response. No provider here exposes a phone number outside Telegram's existing no-username path, and Discord/Telegram have no email in their public profile at all — LinkedIn's OIDC profile does carry one (its `email` scope is already requested, alongside `openid profile`), but this app deliberately never reads or stores it.

### Linking a Telegram/Discord/LinkedIn account already linked elsewhere

`telegram_id`/`discord_id`/`linkedin_id` are unique — one provider account can be the direct link for only one contributor row — but a real person can end up with more than one row (a personal GitHub account and a work one, say). Attempting to link a Telegram/Discord/LinkedIn account already linked to a *different* row is not refused: successfully completing that OAuth flow is treated as proof the two rows are the same person, and the row attempting the link is recorded as an alias of whichever one already holds the identity (`alias_of_github_id`, above) rather than erroring. The identity itself is never duplicated in storage — only the alias row's *display* inherits it (`resolveProviderLabels` in `src/lib/contributors.ts`), so the contributor sees their Telegram/Discord/LinkedIn as linked on either row despite it living in only one place in the database. An alias already pointed at someone else (set by an admin, or by an earlier shared-identity proof) is left alone rather than silently overwritten by a conflicting new claim.

## Session outlives its row

A signed-in session's cookie can name a `github_id` no longer in the table, if the row is gone by the time a page load or an autosave reaches it. Signing in with GitHub again is always the fix, since that recreates the row. Two places surface this:

- Loading the page in that state shows the same signed-out view as someone who's never signed in, rather than a form with nothing behind it.
- The row disappearing while the form is already open surfaces on the next autosave: the field shows a "Sign in again" link alongside the save's error, since retrying the same save can never succeed once the row is gone.

Both read the same message, `REAUTH_REQUIRED_MESSAGE` in `src/app/auth/notice.ts`.

## Finding other contributors

Main's search box (`src/app/contributor-search.tsx`, `searchContributors` in `src/lib/contributors.ts`) matches name, email, GitHub username/email, Discord username, Telegram username, and LinkedIn name — case-insensitively, against `confirmed` contributors only, once 3 or more characters are typed. Up to 5 results, a match at the start of a field ranked above one only containing the query somewhere inside it.

Selecting a result opens `/contributors/[hash]` (`src/app/contributors/[hash]/page.tsx`), a read-only public profile — signed-in contributors only, same as the rest of the app. `hash` is `md5(id)`, computed at query time rather than stored: short and stable, with no migration or backfill needed. A hash that doesn't resolve to a `confirmed` contributor reads as "not found," whether that's because it's malformed, points at a `draft` signup, or never existed at all; opening your own profile link redirects to the editable `/profile` instead of showing the same page read-only a second time.

The profile merges in everything recorded across the contributor's whole alias cluster (`resolveProfileCluster`), not just the specific row the link points at — opening an alias's page shows the primary's Discord, and opening the primary's page shows an alias's Telegram, wherever each was actually linked. Email only appears when the contributing row's address is confirmed; LinkedIn never gets a clickable link at all, since its OIDC profile carries no username or vanity-URL claim to build one from — see [Data collected](#data-collected).

## Local setup

Prerequisites: a running PostgreSQL 18 server, [pnpm](https://pnpm.io), and Node.js (this repo is developed against Node 24; `migrations/run.ts` runs as plain TypeScript via Node's built-in type stripping, so an older Node may not run it).

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Create the two databases the app uses — one for the app, one for the test suite:

   ```bash
   createdb contributor_registry
   createdb contributor_registry_test
   ```

3. Copy the environment template and fill it in:

   ```bash
   cp .env.example .env.local
   ```

   `.env.local` is gitignored. See [Environment variables](#environment-variables) for what each entry needs; the OAuth credentials come from [Registering the OAuth applications](#registering-the-oauth-applications).

4. Apply the schema to both databases. `migrations/run.ts` reads `DATABASE_URL` from the shell environment rather than from an env file, so export each file's variables first:

   ```bash
   set -a; source .env.local; set +a; pnpm migrate
   set -a; source .env.test; set +a; pnpm migrate
   ```

   (`pnpm dev` and `pnpm test` don't need this step done for them separately — Next.js loads `.env.local` itself, and `tests/setup.ts` loads `.env.test` itself. Only the schema has to be applied to each database up front.)

5. Start the dev server:

   ```bash
   pnpm dev
   ```

   The app is at [http://localhost:3000](http://localhost:3000).

### Signing in locally without OAuth

Registering the OAuth applications below is only necessary when working on the sign-in flows themselves — the environment variables they fill still have to exist (see [Environment variables](#environment-variables)), but placeholder values are enough for everything else. A development server serves **`/dev-login`** instead: it lists the contributors already in the local database and signs the browser in as the one picked, no provider round-trip involved. The picker only offers what the `contributors` table holds, so on an empty database seed a row first — a plain `INSERT` with `github_id` and `github_login` is enough.

The route exists only in development, twice over. Its file is `route.dev.ts`, and `.dev.ts` is a page extension only in development builds (see `next.config.ts`) — a production build has no `/dev-login` route at all, not even a stub. Inside the file, a second, independent guard refuses any request that isn't served by a development build on a loopback host — the Host check is what keeps `pnpm dev --hostname 0.0.0.0` from offering sign-in-as-anyone to the whole LAN.

### Testing

```bash
pnpm test        # Vitest suite
pnpm typecheck   # tsc --noEmit
```

The test suite runs against `contributor_registry_test`, using the credentials already committed in `.env.test`, and expects the schema already applied by step 4 above.

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `SESSION_PASSWORD` | Encrypts the `iron-session` cookie; at least 32 characters (`openssl rand -base64 32`) |
| `APP_URL` | This environment's own origin — must match what's registered with each OAuth provider below |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | From the GitHub OAuth App |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | From the Discord application |
| `TELEGRAM_CLIENT_ID`, `TELEGRAM_CLIENT_SECRET` | From the Telegram bot |
| `CONTRIBUTORS_EXPORT_SECRET`, `CONTRIBUTORS_SYNC_SECRET` | Shared secrets guarding the two `/internal/contributors/*` routes used by the cf-internal registry sync (see below); at least 32 characters each (`openssl rand -hex 32`) |
| `TRACKS_SYNC_SECRET` | Shared secret guarding `/internal/tracks/sync` (see [Tracks](#tracks)) — its own secret, not a reuse of `CONTRIBUTORS_SYNC_SECRET`, so either can be rotated or revoked independently even though both originate from cf-internal |
| `ARTIFACT_LINKS_SYNC_SECRET` | Shared secret guarding `/internal/artifact-links/sync` (see [Artifact links](#artifact-links)) |
| `TRACK_PAGE_TEMPLATE_SYNC_SECRET` | Shared secret guarding `/internal/track-page-template/sync/<slug>` (see [Track pages](#track-pages)) |
| `CONFIG_SYNC_SECRET` | Shared secret guarding `/internal/config/sync` (see [App config](#app-config)) |
| `RESEND_API_KEY`, `RESEND_FROM_ADDRESS` | **Optional** — see [Email confirmation](#email-confirmation). With `RESEND_API_KEY` unset, a confirmation email is logged instead of sent, so the app still boots and runs with neither of these set |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | **Optional** — from the LinkedIn application, see [LinkedIn](#linkedin) below. This app's only optional *provider*: with both unset, the app still boots and runs, the LinkedIn row is left off the profile form, and `/auth/linkedin` (and its callback) respond 404 — setting just one of the two fails env validation at boot |
| `ROOT_GITHUB_ID` | **Optional** — the numeric GitHub id of this app's single root user; unset means no root user at all. Always an Admin, on top of whatever `is_admin` says — see [Roles & Admin](#roles--admin) |
| `DO_API_TOKEN`, `DO_DROPLET_ID` | **Optional** — a read-only DigitalOcean API token and the production droplet's numeric id, see [Droplet status](#droplet-status). With both unset, the Admin-only footer status section doesn't render at all — setting just one of the two fails env validation at boot |
| `GITHUB_ORG_TOKEN` | **Optional**, independent of `DISCORD_BOT_TOKEN` below — an `admin:org`-scoped GitHub token, see [Auto-invite and track access](#auto-invite-and-track-access). With it unset, GitHub org invites and team adds silently no-op and log why |
| `DISCORD_BOT_TOKEN` | **Optional**, independent of `GITHUB_ORG_TOKEN` above — a Discord bot token with `Manage Roles` in the target guild, see [Auto-invite and track access](#auto-invite-and-track-access). With it unset, Discord role grants silently no-op and log why |

The fourteen above `RESEND_*` are required, not just for running the app: `src/lib/env.ts` validates the whole environment at import, and `next build` imports every route module while collecting page data, so `pnpm build` fails before it reaches any provider if even one variable is unset. Placeholder values satisfy this — the build never contacts a provider. `RESEND_*`, `LINKEDIN_CLIENT_ID`/`LINKEDIN_CLIENT_SECRET`, `ROOT_GITHUB_ID`, `DO_API_TOKEN`/`DO_DROPLET_ID`, and `GITHUB_ORG_TOKEN`/`DISCORD_BOT_TOKEN` are the exceptions, deliberately: this app needs to keep booting in an environment where email, LinkedIn, a root user, droplet monitoring, or the auto-invite feature hasn't been configured yet.

## Registering the OAuth applications

Each redirect URI must match the app's `APP_URL` exactly, so **every environment (local, staging, production) needs its own registration at all three required providers** — a local run and a deployed one cannot share credentials. LinkedIn is optional (see [LinkedIn](#linkedin) below) — an environment can skip registering it entirely.

### GitHub

At [github.com/settings/developers](https://github.com/settings/developers) → New OAuth App:

- Homepage URL: this environment's `APP_URL`
- Authorization callback URL: `{APP_URL}/auth/github/callback`

Put the generated client ID and secret into `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.

[GitHub's documentation](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app) states that "OAuth apps cannot have multiple callback URLs, unlike GitHub Apps" — one more reason local and production need separate apps.

### Discord

At [discord.com/developers/applications](https://discord.com/developers/applications) → New Application → OAuth2 → add redirect `{APP_URL}/auth/discord/callback`.

Put the client ID and secret into `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`.

### Telegram

Via [@BotFather](https://t.me/botfather): `/newbot` in its regular chat to create the bot, then open BotFather's Mini App (not the chat commands) for Bot Settings → Web Login → add `{APP_URL}/auth/telegram/callback` as an allowed URL.

Put the bot's client ID and secret into `TELEGRAM_CLIENT_ID` / `TELEGRAM_CLIENT_SECRET`.

### LinkedIn

**Optional** — the only provider here an environment can skip entirely; see [Environment variables](#environment-variables) above for what happens with it unset.

At [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps) → Create app (requires an existing LinkedIn Company Page to attach it to) → Products tab → request "Sign In with LinkedIn using OpenID Connect" → Auth tab → Authorized redirect URLs → add `{APP_URL}/auth/linkedin/callback`.

Put the client ID and secret into `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET`.

## Reading the data

There is no admin UI. Query Postgres directly:

```bash
psql "$DATABASE_URL" \
  -c "SELECT github_login, name, telegram_username, telegram_phone, discord_username, email, company FROM contributors"
```

A row exists from the moment someone signs in with GitHub, before they've typed anything, so `name` and `email` being null doesn't mean the row is broken — it means that contributor hasn't filled the form in yet, or signed in once and never came back. There's no column to tell those two cases apart directly; the reading convention is that **an entry counts as filled in when `name IS NOT NULL`**.

## Contributors registry sync

Four columns — `status`, `alias_of_github_id`, `is_agent`, `is_admin` — are mirrored to and from a YAML file — `pass/contributors.yaml` in the private [constructorfabric/cf-internal](https://github.com/constructorfabric/cf-internal) repo — which is the source of truth for `alias_of_github_id`/`is_agent`/`is_admin`, and one of two writers for `status` (see [Roles & Admin](#roles--admin)). Every other column in the table flows one way only, DB → file; these four flow file → DB, and `status` also flows DB → file same as everything else, so an in-app Confirm/Block shows up in the file on the next export. Every column is present in the file either way. (`alias_of_github_id` alone can also be set by the app itself, outside this sync entirely — see [Linking a Telegram/Discord/LinkedIn account already linked elsewhere](#linking-a-telegramdiscordlinkedin-account-already-linked-elsewhere) — but whichever way it was set, it's still exported here the same as if an admin had typed it.)

- **Export** (DB → file, hourly): `.github/workflows/export-contributors.yml` in *this* repo calls `GET /internal/contributors/export` (bearer-protected by `CONTRIBUTORS_EXPORT_SECRET`), which renders every column of every contributor — including their current `status`/`alias_of_github_id`/`is_agent`/`is_admin` — as YAML, and commits the result into cf-internal if it changed. Uses a fine-grained PAT (`CF_INTERNAL_PAT`, scoped to just that repo, `Contents: Read and write`) stored as a secret on *this* repo — the droplet itself never holds a GitHub write credential.
- **Import** (file → DB, on push): a small shim workflow living in cf-internal (`on: push: paths: ['pass/contributors.yaml']`) posts the file's content to `POST /internal/contributors/sync` (bearer-protected by `CONTRIBUTORS_SYNC_SECRET`), which updates `status`, `alias_of_github_id`, `is_agent`, and `is_admin` for each `github_id` it finds a matching row for — nothing else in the payload is read. This is how an admin's manual edit in GitHub reaches the app — and also fires harmlessly after the export's own commit, since re-applying already-current values is a no-op. A row whose `alias_of_github_id` fails the database's own FK or not-self CHECK constraint (an unknown `github_id`, or a self-reference) is skipped and logged rather than aborting the rest of the batch.

An admin acts by editing one of the four owned fields in `pass/contributors.yaml` directly — e.g. `status: draft` → `confirmed` to promote a contributor, `alias_of_github_id: "<their github_id>"` to mark a duplicate registration as the same person, `is_agent: true` for a bot account, or `is_admin: true` to grant the Admin role — and merging that change. No other field in the file should be hand-edited, since the next hourly export overwrites everything except those four from the database.

## Roles & Admin

Three levels: **Contributor** (default, everyone), **Track Admin** (per-track — scoped to one or more specific tracks; see [Tracks](#tracks) — granted via `track_admins`, groundwork for a future track-membership review page, nothing gates on it yet), and **Admin** (global — `src/lib/roles.ts`'s `isAdmin`). Admin has two independent sources, either sufficient: the env-configured `ROOT_GITHUB_ID` (`src/lib/root-user.ts`'s `isRootUser` — a bootstrap admin so granting the very first `is_admin` never needs an existing admin to do it) and the `is_admin` column itself (registry-file-owned, above).

An Admin gets an **Admin** entry in the top-right menu, linking to `/admin` (`src/app/admin/`) — every other visitor gets a plain "not authorized" message there, not a redirect. It lists every contributor regardless of status, with **Confirm**/**Block** per row:

- **Confirm** sets `status` to `'confirmed'`; **Block** sets it to `'blocked'` — both write directly (`src/lib/contributors.ts`'s `setContributorStatus`), the one place in this app that writes `status` outside the registry sync above. The write folds back through the registry file on the next scheduled export, same as any other DB-owned column — the narrow risk is a registry-file edit landing in the gap between an Admin's click and that next export, which would overwrite the in-app change back on the import that follows. Each button disables itself once the row is already in that state — pressing Confirm on an already-`confirmed` row (or Block on an already-`blocked` one) would change nothing.
- **Blocked reads exactly like `draft`** everywhere `status` already gates something — hidden from search and from having a public profile (both already require `confirmed`) — not an additional restriction on signing in or editing their own profile. A blocked contributor can still use the app as themselves; they just aren't found or shown to anyone else.
- The page's own "same search as [Finding other contributors](#finding-other-contributors)" is a client-side filter over the already-loaded full list, not a reuse of that search's server action — that one is deliberately `confirmed`-only, which would hide the exact `draft`/`blocked` rows an Admin needs to find here. Two dropdowns filter the same list further, by `status` and by `profile_completeness`. Rows render as tiles that wrap to the page's normal width, rather than a table needing horizontal scroll to see every column at once.

## Tracks

The `tracks` table (`migrations/010_tracks.sql`) and its `track_admins` join table are entirely owned by `pass/tracks.yaml` in cf-internal, synced one-way (file → DB only, `POST /internal/tracks/sync`, bearer-protected by `TRACKS_SYNC_SECRET`) — unlike contributors, nothing about a track is self-reported by any one person, so there's nothing here for this app to export back. Each track has a `slug` (its stable key), `name`, `description`, a `repositories` list (URL, description, issue-tracker link — stored as `jsonb`, always read/written as one small unit), and up to five named leader slots (Product Manager, Architect, Developer, Quality, Researcher — for display, distinct from Track Admin above, which is a permission grant the two will often but don't always share). Leaders and admins are written in the file as GitHub *logins* (`src/lib/tracks-registry.ts`), not the numeric `github_id`s the rest of this app keys on — a login is what a human hand-editing the file actually knows and can eyeball-verify. `src/lib/tracks.ts`'s `syncTracks` resolves each login to its contributor's `github_id` at sync time; the database itself still stores the id, the stable key, since a login can be renamed. A sync upserts by `slug` and fully replaces that track's `track_admins` to match the file exactly, the same "file is the whole set" reasoning the contributors sync uses for its own owned fields. A row whose leader or admin login doesn't resolve to a real contributor is skipped and logged — for a leader, that skips the *entire* track (repositories and every other leader/admin included), not just that one slot, so a typo'd or not-yet-registered login is worth checking for in the sync logs.

`src/lib/tracks.ts`'s `listTracks`/`findTrackBySlug` back the track directory and track pages below.

## Artifact links

The `artifact_links` table (`migrations/013_artifact_links.sql`) is entirely owned by `pass/artifact-links.yaml` in cf-internal, synced one-way the same way `tracks` is (`POST /internal/artifact-links/sync`, bearer-protected by `ARTIFACT_LINKS_SYNC_SECRET`). It's a catalog, not the content: each row is a `label` and a `url` pointing at wherever the real artifact actually lives — the governance repository for a community policy, any repository under the `constructorfabric` org for a track's vision or roadmap, an external calendar for a meeting schedule — never the artifact itself.

Each row has a `scope` (either `"community"`, or a track's `slug`) and a `category` (`policy` | `vision` | `roadmap` | `schedule` | `discord` | `guide` | `other`, CHECK-constrained). `scope` isn't a foreign key — `"community"` doesn't name a row in `tracks` — so it's validated in application code at sync time instead (`src/lib/artifact-links.ts`'s `syncArtifactLinks`, against whatever tracks currently exist): a row whose `scope` names neither `"community"` nor a real track is skipped and logged, same treatment `syncTracks` gives an unresolved leader/admin login. Every sync fully replaces the table (delete all, insert the file's whole set) rather than upserting by key — there's no natural unique key across scope/category/label worth building matching logic around for something this small.

`src/lib/artifact-links.ts`'s `listArtifactLinks(scope)` reads one scope's links at a time — the `/policies` page (see [Track pages](#track-pages) below) filters `"community"` links to `category: policy`; a track page reads its own slug's links across every category.

## Track pages

Each track gets a dedicated page at `/tracks/[slug]`, rendered from **that track's own markdown template** — `pass/track-pages/<slug>.md` in cf-internal, one file per track (IDEA-117; previously a single shared `pass/track-page.md`), synced one-way into the `track_page_template` table (one row per track, keyed on `track_id`; `migrations/032_track_page_template_per_track.sql`) via `POST /internal/track-page-template/sync/<slug>`, bearer-protected by `TRACK_PAGE_TEMPLATE_SYNC_SECRET`. A Track Admin only ever needs to edit their own track's file — a track's own data fills in a handful of named placeholders (`src/lib/track-page-template.ts`'s `renderTrackPage`):

- `{{name}}`, `{{description}}` — substituted as plain text.
- `{{leaders}}`, `{{repositories}}`, `{{artifact_links}}` — each pre-rendered server-side as a markdown bullet list (or a plain "none yet" line, if empty) *before* substitution — deliberately no loop or conditional syntax in the template itself, so editing a track's own `pass/track-pages/<slug>.md` only ever requires knowing these five placeholder names, not a templating language.

Governance's own page (`pass/track-pages/governance.md`) additionally opens with a short section explaining to Track Admins how to manage their track — linking to Track Members (`/tracks/admin`) and naming the file to edit for their own track's content.

The substituted markdown is rendered to HTML with [markdown-it](https://github.com/markdown-it/markdown-it) (`html: false` — the template is trusted, hand-edited content the same way `pass/tracks.yaml` already is, but there's no reason to let raw HTML through a *markdown* template) and rendered directly into the page.

`/tracks` (IDEA-007) is the directory linking to every track's page — always read live from `listTracks()`, never a hardcoded list, so a track added, renamed, or removed in `pass/tracks.yaml` shows up with no code change. `/policies` (IDEA-006) lists `"community"`-scope, `category: policy` artifact links. Both are linked from Main rather than embedded inline, reachable once the signed-in contributor's own profile is complete (same gate as search).

## Droplet status

An Admin-only footer section (`src/app/droplet-status.tsx`) showing the production droplet's CPU, RAM, disk usage, and disk I/O as four independently color-coded boxes (green/yellow/red), each with the exact figure in a hover/tap title. Entirely optional — with `DO_API_TOKEN`/`DO_DROPLET_ID` unset, `src/lib/droplet-metrics.ts`'s `getDropletMetrics` returns `null` and the section doesn't render at all, the same "app still boots and runs" posture `RESEND_API_KEY` and `LINKEDIN_CLIENT_ID` already have.

Sourced from [DigitalOcean's Droplet Monitoring API](https://docs.digitalocean.com/reference/api/api-reference/#tag/Monitoring), not read from inside the app container (`/proc`, `/sys`, Docker stats) — that would need mounting host paths or the Docker socket into the app, the same host-root-equivalent risk already flagged for the webhook container, and the app is the public-facing, larger-attack-surface service. `DO_API_TOKEN` should be a **read-only** token, generated in DigitalOcean's own dashboard — this app or an agent can't provision one on its own.

The `droplet_metrics` table (`migrations/017_droplet_metrics.sql`) is a singleton row (the same `id boolean PRIMARY KEY DEFAULT true CHECK (id)` trick `app_config` also uses) caching the last successful fetch, refreshed on read rather than on a schedule: `getDropletMetrics` re-fetches from DigitalOcean only once the cached row is more than 5 minutes old, so the footer never calls out live on every page load. A failed refresh (DO API down, token revoked) leaves the previous snapshot in place and logs the error — it never surfaces as a broken-looking footer.

Disk usage is a current snapshot, not averaged — it moves slowly and steadily, so an hourly average would blur exactly the moment a threshold is crossed. CPU, RAM, and disk I/O are averaged (CPU/disk-I/O: the rate of change across the window's first and last sample, since both are cumulative counters, not instantaneous readings; RAM: the arithmetic mean of the window's samples, since it's a point-in-time gauge). Disk I/O has no natural 0–100% denominator the way the other three do, so its color thresholds are combined read+write MB/s cutoffs, not a percentage — a rougher approximation than the other three, worth tuning once real traffic is visible.

## App config

A small `app_config` table (`migrations/018_app_config.sql`, singleton row) entirely owned by `pass/config.yaml` in cf-internal, synced one-way (`POST /internal/config/sync`, bearer-protected by `CONFIG_SYNC_SECRET`) the same way `tracks`/`artifact_links`/`track_page_template` already are. Holds the small set of deploy-wide values IDEA-041/042 need — `github_organization`, `discord_guild_id`, `discord_invite_url` — as a singleton row rather than env vars, so they can be rotated with a commit instead of a droplet SSH session and redeploy. Unlike every other cf-internal sync in this app, a parse failure here reports a plain 400 rather than skipping bad rows and reporting a count — one flat object has nothing partial to salvage the way a list of rows does.

## Auto-invite and track access

Confirming a contributor (the Admin table's Confirm button) automatically invites them to the GitHub org and emails them the community Discord invite link; a Track Admin accepting a join request automatically adds the contributor to that track's GitHub team and grants its Discord role. Both are best-effort — `src/lib/invites.ts`'s `inviteConfirmedContributor` and `src/lib/team-access.ts`'s `grantTrackAccess` never throw, since the Confirm/Accept action they're triggered from has already succeeded by the time they run.

Each half is independently gated on its own `pass/config.yaml` value being present, and further gated on a real credential:

- **GitHub** (`src/lib/github-org.ts`) needs `GITHUB_ORG_TOKEN`, an `admin:org`-scoped token — materially higher privilege than `CF_INTERNAL_PAT`'s repo-content-only scope, and something only an org owner can mint (DigitalOcean's dashboard-generated tokens are the same story as `DO_API_TOKEN` above — this app or an agent can't provision one on its own).
- **Discord** (`src/lib/discord-role.ts`) needs `DISCORD_BOT_TOKEN`, a bot invited into the guild with `Manage Roles`, its own role positioned above every role it's asked to grant. Discord has no API that silently drops someone into a server without their own action, so the org-level "invite" (IDEA-041) is a real, working invite link sent by email — one click to accept, not zero — while the bot token is only needed for the per-track role grant (IDEA-042), which requires the contributor to already be a guild member.

`contributors.github_org_invited_at`/`discord_invited_at` (`migrations/019_invite_tracking.sql`) and `track_members.github_team_added_at`/`discord_role_added_at` (`migrations/020_track_team_role.sql`) are stamped on attempt, not just success, backing a 15-minute Re-invite/Re-add cooldown on the Admin table and the track membership review page respectively — clicking again before the cooldown elapses is disabled client-side, though the underlying server action doesn't re-enforce it (re-running it early is harmless, just a duplicate send).

A track's `github_team` (a slug) and `discord_role_id` (Discord's numeric snowflake) are both optional fields on `pass/tracks.yaml` — a track with neither configured never triggers a grant at all, and the review page shows a plain member list instead of the Re-add-capable tile layout.

## Email confirmation

A contributor can type any email address at all into the form — unlike GitHub's own public email (`github_email`), nothing vouches for it — so a typed `email` isn't trusted until its owner proves they can read mail sent there.

- **Saving a new, different `email`** (`src/lib/contributors.ts`'s `saveEmail`, reached through the same `saveField` every typed field autosaves through) clears any previous `email_confirmed_at`/token/`email_confirmation_sent_at` — but does *not* send anything itself. Saving the *same* address again (e.g. re-focusing and blurring the field without changing it) is a deliberate no-op — it doesn't reset an already-earned confirmation. An invalid address is rejected by `src/app/form-schema.ts`'s `validateField` before it ever reaches this function, so it never touches the database or the confirmation status at all.
- **Sending is a deliberate click, not automatic.** The profile page shows a "Send confirmation email" / "Resend confirmation email" button next to the Email field whenever it holds an address that isn't confirmed yet — hidden once confirmed. Clicking it hits `GET /auth/resend-confirmation` (session-authenticated), which generates a token, records `email_confirmation_sent_at`, and sends a link to `{APP_URL}/confirm-email?token=…`. A no-op if the email is already confirmed, or if there's no email on file at all.
- **`GET /confirm-email?token=…`** (`src/app/confirm-email/route.ts`) is the link itself — no sign-in required, since the token is the credential. A match clears the token immediately, whether or not it turned out to be expired, so the same link can never be replayed. Expired is 24 hours after `email_confirmation_sent_at` (`EMAIL_CONFIRMATION_TTL_MS` in `src/lib/email.ts`).
- The signed-in profile page shows the live status next to the Email field: "✓ Confirmed", or the Send/Resend button alongside "not sent yet", a prompt to check the inbox, or "expired".
- **The confirmation token is never exported** to the registry file, or anywhere else outside Postgres — it's a bearer credential, and the file is neither private nor access-controlled the way the database is. Only `email_confirmed_at` is exported, for visibility; it's never read back in (see [Contributors registry sync](#contributors-registry-sync) — this app is `email_confirmed_at`'s sole writer, the same as `email` itself).

### Sending email

Sending goes through [Resend](https://resend.com)'s HTTPS API (`src/lib/email.ts`), not SMTP — DigitalOcean blocks all outbound SMTP-family ports (25, 465, 587, and even the commonly-unblocked 2525) on this droplet, confirmed by direct connectivity testing, while HTTPS is unrestricted. Set `RESEND_API_KEY` and optionally `RESEND_FROM_ADDRESS` (see [Environment variables](#environment-variables)); with `RESEND_API_KEY` unset, a confirmation email is logged instead of sent, so the app still runs with no Resend key configured at all — this matters because these two are among the handful of *optional* variables in the whole app (see [Environment variables](#environment-variables) for the full list; everything else fails the build if unset).

Sending `from: no-reply@cfabric.org` — the root domain, not a subdomain — since that's the domain actually verified in Resend's dashboard. A dedicated sending subdomain (`send.cfabric.org`) was tried first, but Resend rejects a send from any domain it hasn't verified, and only `cfabric.org` itself is currently set up there.

## Deployment

The application is a Next.js server backed by Postgres — portable to any host that provides both. A container image and a chosen hosting target are not set up yet. Whatever runs it will need its own OAuth registrations for its domain, following [Registering the OAuth applications](#registering-the-oauth-applications) above.
