# GitHub Real Names Extension

This directory is the browser extension half of Fabric Pass, living in the same repository as
the server it talks to. The names it shows come from pass itself, over `GET /api/names`
(`src/app/api/names/` in the repository root), authorized by the pass session cookie the
contributor already has — so an endpoint change and a change to its only consumer can land in
one pull request. Everything below concerns the extension; every command in this file is run
from this directory, not from the repository root.

The specification, the plan behind the pass integration and the handover notes are in
[`docs/`](docs/) — see [Documents](#documents) at the end.

## What it does

A browser extension that shows a person's real name next to their GitHub login on GitHub pages. The login itself isn't replaced — the name is appended next to it, e.g.: `anatolyb (Anatoly Bobrov)`. Two other display formats are available in the settings: square brackets (`anatolyb [Anatoly Bobrov]`) and reversed square brackets (`Anatoly Bobrov [anatolyb]`), the only one that does rewrite the login's own text, keeping it visible in the brackets. The other exception is the Assignees column in GitHub Projects table views: that cell has no room for a suffix, so the login is replaced by the name outright and moves into the tooltip (hover to see it).

Everything the extension stores lives locally in the browser, and it never uses the GitHub API. It does talk to one server: Fabric Pass, to look up names for the logins you view (see [Where the data comes from](#where-the-data-comes-from) for exactly what that sends and stores).

## Install (no build required)

Most people should start here — no Node.js or build tools required. Chrome and Edge both work;
nothing else is supported.

### 1. Download

**[→ Extension releases](https://github.com/constructorfabric/fabric-pass/releases?q=extension-v&expanded=true)**

That link lists only the extension's releases — they are tagged `extension-v0.3.0` and so on.
Releases in this repository whose tag has no `extension-` prefix belong to the Fabric Pass
server and are not what you want here.

Open the newest one and download the asset ending in `-chrome.zip` (for example
`gh-name-ext-0.3.0-chrome.zip`) — the same archive serves both Chrome and Edge.

### 2. Unpack

Unpack the archive into a folder you intend to **keep**. The browser loads the extension from
that folder every time it starts, so if you later move or delete it, the extension stops
working. Somewhere like `~/Applications/github-real-names/` is a better home than `~/Downloads`.

```bash
# macOS / Linux
mkdir -p ~/Applications/github-real-names
unzip -o ~/Downloads/gh-name-ext-*-chrome.zip -d ~/Applications/github-real-names
```

On Windows: right-click the archive → **Extract All…** → pick a folder you'll keep.

### 3. Load it into the browser

1. Open `chrome://extensions` (in Edge: `edge://extensions`).
2. Turn on **Developer mode** — top-right corner in Chrome, left-hand panel in Edge.
3. Click **Load unpacked** and select the folder you unpacked in step 2. Pick the folder that
   directly contains `manifest.json`; if unpacking produced a single folder inside your folder,
   select that inner one.
4. Optional but handy: pin the extension so its icon stays visible — the puzzle-piece button in
   the toolbar, then the pin next to **GitHub Real Names**.

### 4. First run

1. Sign in to [Fabric Pass](https://pass.cfabric.org) in the same browser profile. Names come
   from pass over your existing session cookie; without it the extension has nothing to show
   unless you add names by hand (see [Where the data comes from](#where-the-data-comes-from)).
2. Open any GitHub page with people on it — an issue list, a pull request, a commit list. Names
   appear next to the logins pass knows.
3. Click the extension's icon to see which logins the current page has and to type a name for
   one yourself; the **Open settings** button there leads to display format, sources and imports.

If nothing appears: the popup says whether you are signed in to pass, and the **Sources** tab in
the settings shows when pass last answered.

### Updating

An extension installed this way **doesn't update itself**. When a new release comes out,
download the new archive, unpack it over the same folder, and click **Reload** under the
extension on the `chrome://extensions` page.

## Build from source

If you cloned the repository instead of downloading a release archive:

```bash
cd github-real-names-extension
npm install
npm run build
```

The extension keeps its own `package.json`, lockfile and `node_modules`; it is not part of the
repository's pnpm workspace and the root `tsconfig.json` deliberately excludes it, so the two
halves are built and type-checked separately.

The `.output/` directory isn't part of the repository (it's listed in `.gitignore`) — it's created
by these build commands, so it won't exist until you run one of them.

## Development setup

### Dependencies

```bash
npm install
```

### Running in development mode

```bash
npm run dev
```

Dev mode watches the source files and reloads the extension itself, so this is the loop to
use when iterating. It launches a browser from a profile kept in `.dev-profile/`
(git-ignored) rather than a throwaway one, which matters because the Fabric Pass layer needs
your Fabric Pass session cookie: sign in once in that profile and the login survives
restarts. Delete the directory to start from a clean browser.

The launch settings live in `web-ext.config.ts` — the start URL, the profile paths, and
options such as `openDevtools`. Adjust them to whatever you are debugging.

### Reloading a manually installed build

If you loaded the extension by hand instead (see below), Chrome does **not** pick up a
rebuild on its own:

1. `npm run build`
2. Open `chrome://extensions` and click **Reload** on the extension card
3. Reload the GitHub tab — content scripts are injected on page load, so an already-open
   tab keeps running the previous code

Re-adding the extension through **Load unpacked** is not needed; the path is remembered.
Note that a build replaces the whole `.output/chrome-mv3` directory rather than writing
over it, so Chrome occasionally reports a missing manifest right after a rebuild — click
**Reload** and it recovers.

## Building

### Build an unpacked extension

```bash
npm run build
```

### Build a distributable zip archive

```bash
npm run zip
```

The archive is created in the `.output/` directory.

## Installing a build you made yourself

Same procedure as [Load it into the browser](#3-load-it-into-the-browser) above, except the
folder to select is the one `npm run build` produced.

### Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `.output/chrome-mv3` folder

### Edge

1. Open `edge://extensions`
2. Enable **Developer mode** (toggle in the left-hand panel)
3. Click **Load unpacked**
4. Select the `.output/chrome-mv3` folder (Edge uses the same build as Chrome)

## Where the data comes from

The extension supports three data sources for the GitHub login → real name mapping:

### 1. Fabric Pass (works out of the box, if you're signed in)

Names come from a deployed **Fabric Pass** instance. Authorization is your own Fabric Pass
session cookie in the same browser — the extension stores no token and asks for no key. If
you aren't signed in to Fabric Pass, no names arrive from this layer, and the UI says so plainly
rather than looking broken.

Lookup is **lazy**: the content script reports the logins the current page shows that aren't
already known, background asks Fabric Pass for them in batches, and the page redraws once the
answer lands. The whole directory is never downloaded — only the logins you actually look at
are ever asked about.

What's stored locally is deliberately minimal: **only pairs of GitHub login and display name**
— plus, for logins Fabric Pass doesn't know, a marker that it doesn't know them, so they aren't
re-asked every time. No email, no company, nothing else.

If more than **N days** (a build-time setting, `3` by default — see
[build-time configuration](#build-time-configuration)) pass without a successful, authorized
response from Fabric Pass, the whole Fabric Pass cache is wiped — checked hourly. Manual edits
and imported files are never touched by this; only the Fabric Pass layer is. A `401` (you're
signed out) or a network failure never wipes anything — only age does.

The honest trade-off, stated plainly: Fabric Pass sees the stream of logins you look at while
browsing GitHub.

The Fabric Pass layer has the lowest priority. It can be disabled, but not deleted, on the
**Sources** tab, which also shows how many names are currently cached, when Fabric Pass last
answered, and — when you aren't signed in — a **Open Fabric Pass** button to sign in. A
**Clear cache** button forgets everything cached; names refill lazily the next time you visit
GitHub.

### Build-time configuration

Four `WXT_*` variables, read once at build time (see `.env.example`) — changing one of these
requires a rebuild, not just a browser restart:

| Variable | Default | What it controls |
|---|---|---|
| `WXT_PASS_ORIGIN` | `https://pass.cfabric.org` | The Fabric Pass instance the extension talks to. Also determines the extension's single host permission (see [Permissions](#permissions)) — pointing this at a local Fabric Pass (`http://localhost:3000`) needs a rebuild for the manifest to pick up the new host. |
| `WXT_PASS_MAX_CACHE_AGE_DAYS` | `3` | How many days without a successful authorized response before the whole Fabric Pass cache is wiped. |
| `WXT_PASS_ENTRY_TTL_HOURS` | `24` | How long a known name stays fresh before it's asked about again. |
| `WXT_PASS_MISS_TTL_HOURS` | `24` | How long a login Fabric Pass doesn't know stays in the negative cache before it's asked about again. |

A build with no `.env` at all still works — every value falls back to its default.

### 2. Corporate registry, imported manually (contributors.yaml)

Imported on the **Sources** tab. The file must contain a list of contributors in YAML format with
`github_login` and `name` fields (or other compatible fields).

### 3. Local data

If there's no registry, or you need extra information, you can add data locally:

- **JSON:** a flat map `{"login": "Name"}`, an array of objects, or a `{"contributors": [...]}` wrapper
- **CSV:** a table with `github_login` (or `github`) and `name` (or `real_name`) columns
- **Manual entry:** a table on the **Records** tab for adding individual records

Fields are recognized automatically: `login`, `fullName`, `real_name`, `org`, `mail`, and other
synonyms are handled correctly.

### Source priority

Sources work as layers with priority. The layer positioned higher wins:

- **Manual edits** (the "Records" layer) are created on install, sit at the top, and can't be
  deleted. That's why re-importing the corporate registry never overwrites your manual work.
- **Imported files** are added to the end of the list, above Fabric Pass — a new import never
  silently overrides what's already configured. The order between them is set by import order.
- **Fabric Pass** sits at the very bottom, the lowest priority of all — see
  [Fabric Pass](#1-fabric-pass-works-out-of-the-box-if-youre-signed-in) above. Like the manual
  layer, it can be disabled but not deleted.

Layer order is changed with the ↑ / ↓ buttons on the **Sources** tab, where a layer can also be
temporarily disabled without deleting its data. If it's unclear why a particular name is showing
up for someone, the same tab has a login search that shows the winning layer and the values from
the losing layers.

## Interface language

The interface is translated into English and Russian. The language is taken from the browser's
settings, with English as the default. Text lives in `public/_locales/<language>/messages.json`;
to add a language, copy the directory and translate the values — a test checks that the set of
keys matches across languages, so a mismatch will break the build.

## Project structure

| Directory | Purpose |
|---|---|
| `src/core/` | Data parsers (YAML, JSON, CSV), name normalization, the layer system, storage |
| `src/entrypoints/content/` | Content script: finds GitHub logins on the page and inserts real names |
| `src/entrypoints/options/` | Settings page and source management |
| `src/entrypoints/popup/` | Extension popup window |
| `src/entrypoints/background/` | Service worker (background script) |
| `tests/` | Tests (Vitest) |
| `public/_locales/` | Interface translations (en, ru) |

## Permissions

The extension asks for `storage` (to keep the layers and the cache) and `alarms` (to run the
hourly Fabric Pass cache sweep), plus one host permission for the Fabric Pass origin
(`WXT_PASS_ORIGIN`, see [build-time configuration](#build-time-configuration)) — the content
script itself runs on `github.com` via its own `matches:` declaration, which needs no host
permission. Access to arbitrary addresses is optional and is requested at the moment you add a
source by URL yourself, and only for the domain you specified.

## Development

Before committing, be sure to run the checks:

```bash
npm run check
```

This command runs, in order:
- `npm run compile` — TypeScript type checking
- `npm run lint` — ESLint code style
- `npm test` — Vitest tests

## Release

Releasing the extension is one command, and it touches nothing outside this directory — the
Fabric Pass server in the repository root has its own, unrelated deployment:

```bash
npm run release patch        # 0.3.0 -> 0.3.1, or: minor | major | 1.2.3
```

The script (`scripts/release.sh`):
- refuses to run if anything in this directory is uncommitted — a release has to describe a
  commit;
- bumps `version` in this directory's `package.json` (omit the argument to release the version
  already there);
- runs `npm run check` and builds the zip archive, printing the artifacts and their sizes;
- commits the bump as `chore(extension): release extension-vX.Y.Z` and creates that tag;
- stops there and prints the two `git push` commands, so a tag can still be deleted
  (`git tag -d …`) if the artifacts look wrong. Add `--push` to have it push for you.

Pushing the tag is what publishes the release — see below.

### Publishing a release

Releases are built and published automatically by CI. To cut a new one:

1. Run `npm run release patch` (or `minor`/`major`/an exact version) — it bumps, checks,
   builds, commits and tags, as described above. The tag is `extension-vX.Y.Z`, and that prefix
   is what keeps extension releases apart from the pass server's own tags in the same
   repository.
2. Push the branch and then the tag, with the two commands the script printed:
   `git push origin <branch>` and `git push origin extension-vX.Y.Z`.

Doing it by hand instead of through the script works too — bump the version, commit, tag
`extension-vX.Y.Z`, push — the workflow only cares about the tag.

Pushing the tag triggers the `Release extension` workflow
(`.github/workflows/extension-release.yml` in the repository root — GitHub only runs workflows
from there, which is why this one does not live next to the extension it builds), which runs
`npm run check`, builds the zip archive, and publishes it to a GitHub Release named after the
tag. The workflow verifies that the tag matches the `version` in `package.json` and fails with a
clear error if they don't match, so a mismatched tag never produces a release.

## Documents

Written while the extension was being built, kept as-is when it moved into this repository:

| File | What it is |
| --- | --- |
| [`docs/HANDOVER.md`](docs/HANDOVER.md) | Handover notes: the state of the work, what is done, what is not, and where the traps are |
| [`docs/PLAN.md`](docs/PLAN.md) | The full specification and plan for the extension, with the reasoning behind each decision — the `PLAN.md §N` references in the source point here |
| [`docs/PLAN-PASS.md`](docs/PLAN-PASS.md) | The plan for the Fabric Pass integration, the consumer side of IDEA-145 |
| [`docs/GHnameExt.md`](docs/GHnameExt.md) | The original idea the extension started from |
