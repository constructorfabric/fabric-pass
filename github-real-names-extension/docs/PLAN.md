# Implementation Plan: GitHub Real Names Browser Extension

Working plan for implementing `GHnameExt.md` with the help of several agents.
Each task below is self-contained: files, input, what to do, acceptance criteria, what NOT to do.

---

## 1. Stack and key decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Framework | WXT + TypeScript | one codebase → MV3 Chrome/Edge + Firefox, built-in dev mode and packaging |
| UI (options, popup) | React (WXT preset) | there are many forms: sources table, editor, record CRUD |
| UI (content script) | vanilla DOM | React in a content script — an extra ~40KB on every GitHub page and a risk of style conflicts |
| YAML | `yaml` (eemeli) | safe `parse`, proper errors with position; ~40KB, loaded only in options |
| CSV | our own parser (~60 lines) | we only need a split with quote support; pulling in papaparse for that isn't worth it |
| Validation | by hand, no zod | the schema is single and stable; zod would add +12KB and simplify nothing |
| Tests | vitest + happy-dom | parsers/normalize are pure functions; content script — on saved HTML fixtures |
| Package manager | npm | pnpm isn't installed on the system, npm 11 is — no need for an extra environment dependency |

Permissions in the MVP: `storage` + host `https://github.com/*`. Nothing else.
`optional_host_permissions` for the URL source is requested at runtime (task T9).
We do NOT request `unlimitedStorage` — 10k records is ~2MB, which fits within the default 10MB.

Repository: `gh_name_ext/` currently contains only the PRD and is not a git repo.
Code goes into `gh_name_ext/extension/`; `git init` happens in T1.

---

## 2. Module tree

```text
gh_name_ext/extension/
  src/
    core/
      types.ts            # contracts (T0)
      field-aliases.ts    # field synonym table (T0)
      parsers/
        yaml.ts           # (T2)
        json.ts           # (T2)
        csv.ts            # (T2)
        index.ts          # detectFormat + dispatch (T2)
      resolve.ts          # display_name, aliases, skip-reasons (T3)
      sources.ts          # layers, priority, merge → index (T4)
      store.ts            # storage.local, schema version, migration (T4)
      format.ts           # username · Real Name etc. (T5)
    entrypoints/
      content/
        index.ts          # bootstrap, observer, turbo (T5)
        detect.ts         # DOM → login (T5)
        decorate.ts       # span insertion, idempotency (T5)
        style.css         # (T5)
      options/
        App.tsx           # tab routing (T6)
        SourcesTab.tsx    # list of layers, file import (T6)
        EditorTab.tsx     # JSON editor + records table (T7)
        SettingsTab.tsx   # display format, flags (T6)
        Onboarding.tsx    # first run, three doors (T7)
      popup/
        App.tsx           # uncovered logins on the current page (T8)
      background/
        index.ts          # URL source only, and its permission (T9)
  tests/
    fixtures/
      contributors.subset.yaml
      hand.valid.json / hand.broken.json / hand.foreign-fields.json
      github/*.html
```

---

## 3. Contracts (artifact of task T0 — blocks everything else)

```ts
// core/types.ts

export type SourceKind = 'yaml' | 'json' | 'csv' | 'url' | 'manual'

/** A data layer. Order in the array = priority, [0] is highest. */
export interface Source {
  id: string                 // uuid; 'manual' is reserved
  kind: SourceKind
  label: string              // file name or user-defined label
  enabled: boolean
  importedAt: string         // ISO
  /** Raw text — stored ONLY for editable sources (manual, json-inline).
   *  Needed so the editor can show exactly what the user saved. */
  rawText?: string
  url?: string               // for kind==='url'
  stats: ImportStats
}

export interface Contributor {
  github_login: string       // as in the file, for display
  login_key: string          // github_login.toLowerCase(), index key
  github_id?: string         // a string, not a number
  display_name: string       // already computed and converted to Title Case
  raw_name?: string          // original value before Title Case
  company?: string
  email?: string
  discord_username?: string
  telegram_username?: string
  is_agent?: boolean
  is_admin?: boolean
  status?: 'confirmed' | 'draft'
}

export type SkipReason =
  | 'no_name'          // none of the name fields is filled in
  | 'name_equals_login'// name after normalization == login
  | 'no_login'         // no github_login
  | 'draft'            // status: draft while draft display is disabled
  | 'agent'            // is_agent: true
  | 'invalid_record'   // structurally broken record
  | 'duplicate_login'  // duplicate within a single source

export interface SkippedRecord {
  index: number              // position in the source file
  login?: string
  reason: SkipReason
  detail?: string
}

export interface ImportStats {
  total: number
  imported: number
  skipped: SkippedRecord[]
}

export interface ParseResult {
  records: RawRecord[]       // NOT yet normalized
  errors: ParseError[]       // structural parsing errors
}

export interface ParseError {
  line?: number
  column?: number
  message: string
}

/** Everything extracted from the file before normalization. All fields are optional. */
export type RawRecord = Partial<Record<
  | 'github_login' | 'github_id' | 'github_name'
  | 'name' | 'discord_name' | 'telegram_name' | 'linkedin_name'
  | 'discord_username' | 'telegram_username'
  | 'company' | 'email' | 'status' | 'alias_of_github_id'
, string | null>> & { is_agent?: boolean; is_admin?: boolean; _index: number }

export type DisplayFormat = 'dot' | 'brackets' | 'parens'
// dot:      anatolyb · Anatoly Bobrov
// brackets: Anatoly Bobrov [anatolyb]
// parens:   anatolyb (Anatoly Bobrov)

export interface Settings {
  displayFormat: DisplayFormat
  showDraft: boolean
  showAgentBadge: boolean
  showAdminBadge: boolean
  enabled: boolean
}
```

### Storage shape

```ts
// storage.local
{
  schemaVersion: 1,
  settings: Settings,
  sources: Source[],                        // metadata + rawText of editable ones
  records: { [sourceId: string]: Contributor[] },
  idx: { [login_key: string]: [name: string, sourceId: string] },  // flat merged index
}
```

`idx` is the only key the content script reads. One `storage.local.get('idx')`
per page, cached in module scope, invalidated via `storage.onChanged`.
The content script does NOT talk to the background — the service worker can be
asleep, and an extra round-trip on every page isn't needed.

### Field synonym table (`core/field-aliases.ts`)

Shared between JSON and CSV, so someone else's file imports without manual edits:

```ts
login:  github_login | github | login | username | user | handle
name:   name | real_name | realName | full_name | fullName | display_name | displayName
email:  email | mail | email_address
company: company | org | organization | team
```

Keys starting with `_` are silently ignored (this lets people write `"_note"` in a
hand-written JSON instead of comments, which JSON doesn't have).

---

## 4. Layered source model — the core of the design

The problem it solves: a user may have `contributors.yaml`, their own hand-written
JSON, and targeted edits — and re-importing yaml must not overwrite their work.

Rules:

1. The `manual` layer is created empty at install time and **always has the highest
   priority** by default (it can be reordered, but not deleted).
2. Importing a file creates/replaces a layer wholesale by its `id`. Re-importing the same
   file (matched by `label` + `kind`) offers to "update the existing layer" rather than
   spawning duplicates.
3. Merge: walk `sources` from lowest to highest priority, writing into `idx`; the last
   writer wins. We store the winning `sourceId` in `idx` — needed for the UI conflict
   inspector ("why is this the name shown here").
4. `enabled: false` — the layer doesn't take part in the merge, but its data isn't lost.
5. `idx` is rebuilt on any change to sources or to `settings.showDraft`.

---

## 5. KEY CASE: no `contributors.yaml`

This is the main scenario for anyone without access to `cf-internal`. It must not be a
"degraded version" — the mechanism is the same (layers), only the way it's populated differs.

### 5.1 States

| State | Condition | Behavior |
| --- | --- | --- |
| `EMPTY` | `idx` is empty | the content script is **fully inert**: doesn't set up an observer, doesn't touch the DOM, exits after reading `idx`. Extension icon is gray, popup leads to onboarding |
| `MANUAL_ONLY` | only the `manual` layer is populated | normal operation |
| `FILE` | ≥1 imported file | normal operation |
| `MIXED` | file + manual | merge is in effect, options shows which layer won |

### 5.2 Onboarding (first launch of the options page)

Three doors, none of them a dead end:

1. **"I have contributors.yaml"** → file picker `.yaml,.yml`.
2. **"I have my own list"** → file picker `.json,.csv` **or** paste text directly into the editor.
3. **"I'll start from scratch"** → a records table with one empty row.

The "insert example" button fills the editor with a skeleton of two records in
expanded form (with all optional fields and the `_note` field), so the person can see
what can be specified at all.

### 5.3 Accepting hand-written JSON

**Auto-detect the shape, no format selector.** We accept three:

```jsonc
// A. flat map
{ "anatolyb": "Anatoly Bobrov", "jdoe123": "John Doe" }

// B. array of objects
[ { "github_login": "anatolyb", "name": "Anatoly Bobrov", "company": "Acronis" } ]

// C. wrapper — the same shape as contributors.yaml, but in JSON
{ "contributors": [ { "github_login": "anatolyb", "name": "Anatoly Bobrov" } ] }
```

Form C matters: a JSON export of `contributors.yaml` must import without conversion.
If the structure matches none of them — an error listing exactly these three forms, not
an abstract "invalid format".

**Parsing someone else's field names** — via the synonym table (§3). `{"login":"x","fullName":"Y"}`
must import silently.

### 5.4 Validation and error reporting

The rule that matters more than the others: **import is never all-or-nothing**. A
hand-written file of 300 lines almost always contains a couple of malformed records;
rejecting the whole file is the main way to make the extension useless.

* JSON syntax error → show line and column. V8's `JSON.parse` gives `position N` in the
  error text — we map the offset to line/col ourselves (the `offsetToLineCol` utility).
* Semantic errors → valid records get imported, invalid ones go into `stats.skipped`
  with their own `_index` and reason, and are shown as a "3 records skipped" list
  that can be expanded.
* A "download skipped" button → JSON with the rejected records and reasons, so the
  person can fix them and re-import.
* Live validation in the editor (400ms debounce): a status line `42 records · 3 errors`.

### 5.5 Editor

Two interchangeable projections of the same layer:

* **JSON view** — a monospace `<textarea>`, no syntax highlighting (not worth pulling in
  tree-sitter in the extension). Buttons: "Validate", "Save", "Format" (`JSON.stringify(_, null, 2)`).
* **Table view** — columns login / real name / company / email, adding a row, inline
  editing, deletion, search. For people who won't hand-write JSON.

Switching JSON → Table requires valid JSON (otherwise the button is disabled with an
explanation). Table → JSON is always available and regenerates the text in form B.

We store **both `rawText` and the parsed records**. Without `rawText`, the next time the
editor is opened the person would see regenerated JSON instead of their own — with a
different key order and lost `_note`s.

A guard against unsaved changes when leaving the tab.

### 5.6 Export

"Download mapping as JSON" → form B, all fields. Closes the scenario for a team without
`contributors.yaml`: one person assembles the list, exports it, everyone else imports it.
Export supports both the whole merged set and a single layer.

### 5.7 Conflict inspector

In SourcesTab — a login search that shows which name won, from which layer, and what
values were present in the losing layers. Without this, "why is the old name showing"
can't be debugged.

---

## 6. Content script — the risky part

**Login detection.** The order was verified against real HTML from four GitHub pages
(fixtures in `tests/fixtures/github/`), not against assumptions:

1. `data-hovercard-url="/users/<login>/hovercard"` — the **primary and only reliable
   source**. Present on 100% of user links across all checked pages (42 of 42). The
   login is taken from here.
2. `href` — only as a fallback, and only if the path consists of ONE segment
   (`/sandy081`) AND the element's text matches that segment.

**Why `href` can't be the first source** (I originally planned exactly that, and it was
a mistake): on issue and PR list pages, a user link's `href` doesn't lead to the profile
but to a search query —
`/microsoft/vscode/issues?q=is%3Aissue+author%3Ajohnpapa`. The first segment of such a
path is `microsoft`, meaning a naive `href` parse would give an organization name instead
of a person.

No regex over the whole page text. No links with `class="user-mention"` were found in
the current markup — don't rely on that selector, work from `data-hovercard-url`.

**What NOT to decorate.** The same person appears 4 times on a PR page via the same
link: avatar in the header, author name as text, avatar in the commits stack, an inline
link. All four carry the same hovercard attributes. Only elements that have their own
visible text should be decorated; skip wrapper links around an `<img>` with no text —
otherwise the name would hang four times next to pictures.

**Insertion.** `<span class="ghname-real" data-ghname-for="<login_key>">` as a sibling
node. Idempotency: before inserting, check `element.dataset.ghnameDone`; when the mapping
changes, find all `[data-ghname-for]` and redraw them rather than reloading the page.

**Dynamics is the primary path, not an addition.** The commits list page
(`/commits/main`) is served by the server WITHOUT a single user link: authors sit inside
JSON in `react-app.embeddedData` and appear in the DOM only after React hydration. So the
initial pass over the ready-made HTML finds nothing on such pages, and the whole result
comes from `MutationObserver`. We will NOT parse GitHub's own JSON payload — it's
internal and changes without notice; we work only with the resulting DOM.

`MutationObserver(document.body, {childList:true, subtree:true})`, mutations accumulate
in a queue and are processed in one pass per `requestAnimationFrame`. Plus `turbo:load`
and `turbo:render` — GitHub navigates via Turbo, there's no full page reload.

**Shadow DOM.** GitHub renders user links into regular light DOM, but part of the
scaffolding is web components. Requirement: when traversing and when attaching the
observer, descend into open shadow roots (`el.shadowRoot` != null → process it
recursively and subscribe to it with a separate `MutationObserver`, since mutations
inside a shadow root don't bubble up to an observer on `body`). Closed shadow roots are
inaccessible to the extension by definition — no workarounds for that.

**Performance budget** (checked in a test): a full pass over the `pr-conversation.html`
fixture — < 16ms; an incremental pass over one added node — < 2ms.

## 7. Fixtures and tests

Fixtures are made by T0, so the agents in T2/T3 don't invent their own:

* `contributors.subset.yaml` — 12 records from the real file covering all branches:
  `github_name: null` + a meaningful `name` (`lobster40`), a nickname in `github_name`
  (`Artifizer`), ALL-CAPS (`Andrei-Iliushin-Constructor`), `name` == login (`ktursunov`),
  an alias record (`claudedigon` → `192490142`), `status: draft`, a record without
  Discord, a mismatch between `name`/`github_name`/`discord_name` (`Corw1n-of-Amber`).
* `hand.valid.json` — all three forms A/B/C.
* `hand.broken.json` — trailing comma, duplicate login, a record with no name, a record
  with no login.
* `hand.foreign-fields.json` — `login`/`fullName`/`_note`.
* `github/*.html` — saved real microsoft/vscode pages:
  `pr-conversation.html` (10 user links, 1 unique login `sandy081`),
  `issues-list.html` (12), `pulls-list.html` (20) — and `commits-list.html` as a
  **negative fixture**: 0 user links in the server-rendered HTML, the page is rendered
  client-side. It checks that the detector doesn't crash and honestly finds zero, not
  that it finds something.

Minimum thresholds: `core/**` — branch coverage ≥ 90% (pure functions, cheap to achieve).
Content script — tests on fixtures, we don't run coverage on it.

---

## 8. Task breakdown

Dependencies: T0 → (T1,T2,T3,T4) → (T5,T6,T7) → (T8,T9,T10) → T11.
Tasks within a wave are independent and are launched in parallel in one message.

### Wave 0

**T0 · contracts and fixtures · me (Opus)**
I write `core/types.ts`, `core/field-aliases.ts`, the storage schema, and all files from §7.
This is a blocking artifact: without it, the four wave-1 agents would invent incompatible types.

### Wave 1 — parallel, 4 agents

**T1 · scaffold · `mechanical`**
Input: §1, §2. Do: `wxt init` in `gh_name_ext/extension/`, TS strict, vitest +
happy-dom, eslint, a `manifest` with `storage` + `https://github.com/*`, scripts
`dev|build|build:firefox|zip|test`, `git init` + `.gitignore`.
Acceptance: `npm run build`, `npm run build:firefox`, `npm test` (one empty test) — all
green; the directory structure from §2 is created with empty files.
Do NOT do: any logic, any UI.

**T2 · parsers · `coder`**
Input: `types.ts`, `field-aliases.ts`, fixtures, §5.3, §5.4.
Do: `parsers/{yaml,json,csv,index}.ts`. Each: `string → ParseResult`.
`detectFormat(text, filename)` distinguishes yaml/json/csv. JSON understands forms A/B/C.
`offsetToLineCol` for `JSON.parse` errors. CSV — our own splitter with quote support and `\r\n`.
Acceptance: tests on all fixtures from §7; broken JSON gives correct line/col;
`hand.broken.json` imports the valid records and returns 4 errors with the correct `_index`.
Do NOT do: name normalization, storage.

**T3 · normalization · `coder`**
Input: `types.ts`, `contributors.subset.yaml`, PRD §"display_name computation rules".
Do: `resolve.ts` — `RawRecord[] → { records: Contributor[], stats: ImportStats }`.
Name priority `name > github_name > discord_name > telegram_name > linkedin_name`;
normalization for comparing against the login (lowercase, strip whitespace, `.` `_` `-`);
Title Case only for strings that are entirely uppercase (don't touch `MikeY`, `bit4flip`);
resolving `alias_of_github_id` (two-pass: first build an index by `github_id`); filtering
out `draft`/`is_agent` based on flags; tracking `login_key` duplicates within a source.
Acceptance: a unit test for each of the 7 situations from the §7 fixture; `ktursunov` is
skipped with `name_equals_login`; `ANDREI ILIUSHIN` → `Andrei Iliushin`, `raw_name` is
preserved; `claudedigon` gets the name of the canonical record; when the alias target is
missing — its own name. Do NOT do: parsing, UI.

**Clarification on `duplicate_login` (found out while implementing T3).** A login is only
claimed by the record that ACTUALLY made it into the index. A record skipped for any
other reason does not make the next one a duplicate: otherwise a pair `{alice, name:
null}` followed by `{alice, name: "Alice Smith"}` would silently swallow a valid name,
and in a hand-written file such a pair is common.

**T4 · layers and storage · `coder`**
Input: `types.ts`, §3 (storage shape), §4.
Do: `sources.ts` (layer CRUD, priority, `manual` is non-deletable and first by default,
merge → `idx` recording the winning `sourceId`, conflict inspector `explain(login)`),
`store.ts` (wrapper over `browser.storage.local`, `schemaVersion`, migration scaffold,
subscription to `storage.onChanged`).
Acceptance: tests — re-importing a layer replaces it rather than duplicating it; edits in
`manual` survive a yaml re-import; `enabled:false` removes the layer from `idx` but not
from `records`; `explain()` returns the winner and the losers; a synthetic test with
10,000 records — rebuilding `idx` < 300ms.
Do NOT do: UI, parsers.

### Wave 2 — parallel, 3 agents

**T5 · content script · `coder`**
Input: `types.ts`, §6, `github/*.html` fixtures, `store.ts` (reading `idx` only).
Do: `detect.ts`, `decorate.ts`, `index.ts`, `style.css`, `core/format.ts`.
Early exit on empty `idx`. Mutation batching via rAF. `turbo:load`/`turbo:render`.
Redraw on `storage.onChanged`. Styles — with a `ghname-` prefix, a muted color, correct
in GitHub's light/dark theme.
Acceptance: on every HTML fixture the expected logins are found (numbers are fixed in
the test, for `commits-list.html` the expected number is zero); re-running the pass
doesn't create duplicates; the budgets from §6 are met; with an empty `idx` no observer
is created (checked via a spy); a node inserted into an open shadow root gets decorated.
Do NOT do: options/popup, don't write anything to storage.

**T6 · options: sources and settings · `coder`**
Input: `types.ts`, `sources.ts`, `store.ts`, §4, §5.7.
Do: `App.tsx` (Sources / Editor / Settings tabs), `SourcesTab.tsx` (list of layers with
kind, label, count, date; drag-reorder or ↑↓ buttons; enable/disable/delete; file import
via picker and drag-drop; expandable "N records skipped" block with reasons and a
"download skipped" button; conflict inspector by login), `SettingsTab.tsx` (display
format with preview, `showDraft`, badges, global toggle).
Leave a slot in `App.tsx` for the Editor tab — T7 handles it.
Acceptance: importing `contributors.subset.yaml` through the UI gives 12 records and a
correct skipped list; disabling a layer instantly changes `idx`; changing the display
format is visible in the preview.
Do NOT do: JSON editor and records table (T7), URL source (T9).

**T7 · options: hand-written mapping · `coder`** ← the key task
Input: `types.ts`, parsers from T2, `sources.ts`, **all of §5**.
Do: `Onboarding.tsx` (three doors §5.2, shown when `EMPTY`), `EditorTab.tsx` (JSON view +
Table view over the `manual` layer or a chosen editable layer; live validation with
debounce; status line; "Validate" / "Save" / "Format"; "insert example"; guard against
unsaved changes; export of the layer and of the merged set into form B).
Store `rawText` alongside the records (§5.5) — this is a requirement, not a detail.
Acceptance: pasting each of forms A/B/C is saved and gives the same result for the same
data; `hand.foreign-fields.json` imports without edits; broken JSON shows line/column
and does NOT overwrite the already-saved layer; after saving and reopening the tab, the
text in the editor is byte-for-byte the same; a Table→JSON→Table round trip loses no
fields; export → import gives an identical `idx`.
Do NOT do: file sources (T6), URL (T9).

### Wave 2.5 — moving preference filters into merge

**T12 · de-filtering resolve · `coder`** (after T5 and T7, before wave 3)

A problem found while implementing T6. Currently `resolveRecords` filters out records by
`status: draft` and `is_agent` at import time, and only the already-filtered
`Contributor[]` end up in storage. That means the "show drafts" toggle physically cannot
affect layers already imported — there's no data left to recompute from. T6 honestly put
up a warning instead of faking a recompute, but that treats the symptom.

The cause is an incorrect split of responsibilities that I set up in §3. The correct
split is:

* `resolve` filters out only the IRREPARABLE — no login, no name, name equal to the
  login, a broken record, a duplicate. These decisions don't depend on settings and
  never change.
* PREFERENCE filters (`draft`, `agent`) are applied in `mergeIntoIndex`, which is
  already rebuilt on any settings change. The `status` and `is_agent` fields already
  exist on `Contributor` — there's no need to store raw records, it costs no extra
  memory.

Changes:

1. `resolveRecords(raw)` — remove the `ResolveOptions`/`showDraft` parameter; stop
   producing the `draft` and `agent` reasons; such records go into the result on equal
   footing with the rest.
2. `SKIP_REASON_PRECEDENCE` — remove `agent` and `draft` from it. Keep the values
   themselves in the `SkipReason` type: merge now uses them.
3. `mergeIntoIndex(sources, records, settings)` — a new third parameter; skip records
   with `is_agent === true` and with `status === 'draft'` when `showDraft === false`.
   `rebuildIndex()` reads the settings itself.
4. UI (`SourcesTab`) — split into two counters: "skipped on import" (from
   `stats.skipped`, unchanging) and "hidden by settings" (computed from the current
   index). Remove the warning banner for `showDraft` in `SettingsTab` — it's no longer
   needed, the toggle now works.
5. `SettingsTab` calls `rebuildIndex()` when `showDraft` changes.

Acceptance: a test where a layer is imported with `showDraft: false`, then the flag is
turned on — and the draft appears in `idx` WITHOUT re-importing. Turned off again — it
disappears. All previous tests stay green (their signatures will need adjusting — that's
expected).

**Plus two defects found during wave 2 acceptance:**

6. **Field loss in the Table → JSON round trip.** `EditorRow` only carries 4 columns, and
   `rowsToJsonText` assembles the object from only those. So `JSON → Table → JSON`
   silently drops `discord_username`, `telegram_username`, `status`, `is_admin`,
   `github_id`, and `_note` annotations. The loss scenario is real: someone writes JSON
   with annotations, peeks at the table view, goes back, saves — the annotations are
   gone. This is exactly what storing `rawText` was meant to prevent.
   Fix: add `EditorRow.extra: Record<string, unknown>` holding everything that didn't
   land in a column; `jsonTextToRows` fills it, `rowsToJsonText` merges it back in, with
   columns taking priority over same-named keys from `extra`. Test: JSON with a full set
   of fields and `_note` → table → JSON gives an equivalent set of keys.

7. **The "I have my own list" door doesn't lead to the editor.** T7 couldn't wire the
   onboarding up to the tabs because `App.tsx` belonged to T6 at the time. Both files are
   ready now: thread an `onGoToEditor?: () => void` prop from `App.tsx` into `Onboarding`
   and switch the active tab. Remove the inline mini-editor in onboarding in the
   process — it duplicates the full-fledged one.

### Wave 3 — parallel, 3 agents

**T8 · popup · `coder-light`**
Input: `detect.ts` from T5, `sources.ts`.
Do: a popup with the list of logins on the current tab that have no name, and a
quick-add field (login pre-filled, entering a name → writes to the `manual` layer). Plus
a "N of M names shown" counter and a link to options.
Acceptance: an added name appears on the page without a reload.

**T9 · URL source · `coder`**
Input: `sources.ts`, §1 (permissions).
Do: a `kind:'url'` layer; `permissions.request({origins:[…]})` at the moment of adding,
not at install time; a manual "refresh" button; background — only for this. Network
errors are shown on the layer, old data isn't lost.
Acceptance: the source cannot be added without the granted permission and this is
clearly stated; revoking the permission doesn't break already-imported data.

**T10 · build and packaging · `mechanical`**
Do: `npm run zip` for Chrome/Edge and Firefox, a README with local install instructions
for the three browsers, a script that runs all tests and lint with one command.
Acceptance: three artifacts get built; the extension installs manually in Chrome and
Firefox.

### Wave 4

**T11 · wrap-up · me + `git-ops`**
`/code-review` over the whole diff, an integration run against live GitHub, fixing
findings, commits via `git-ops`.

---

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| GitHub changes its markup → detection breaks | selectors live in one file, `detect.ts`, tests on HTML fixtures, fixtures are easy to re-capture |
| Nodes inside shadow roots aren't reached by traversal | T5 recursively traverses open shadow roots and attaches its own observer to each; closed roots are inaccessible to anyone — not our problem |
| Type mismatch between wave-1 agents | T0 is blocking, all four get the same `types.ts` |
| People's hand-written JSON will be malformed | non-all-or-nothing import, line/col, "download skipped" (§5.4) |
| Loss of manual edits on yaml re-import | layered model, `manual` on top and non-deletable (§4) |
| Performance on long PRs | budget fixed by a test (§6), batching via rAF |

---

## Queue: markup of dropdown filters (Author / Assignee / Reviewer)

Requested by Anatoly. The markup was captured from a live logged-in page at
`constructorfabric/gears-rust/pulls`; no need to re-investigate.

### Row structure

```html
<li role="option" data-component="ActionList.Item" data-id="U_kgDOEfxP3g">
  <span class="prc-ActionList-ItemLabel-81ohH" id="_r_1g_--label">AndrejK666</span>
  <span class="prc-ActionList-Description-Z-EZJ" id="_r_1g_--inline-description">ANDREI KUCHMA</span>
</li>
```

Facts:

* there are **zero** hovercard attributes inside the popover — the existing detection
  rules won't fire;
* the login sits in a span whose `id` ends in `--label`; the row's `aria-labelledby`
  points at this same id. This is a Primer ActionList convention and an acceptable hook;
* hashed classes (`prc-ActionList-ItemLabel-81ohH`) can't be used — they change with
  each deploy;
* the second span, whose `id` ends in `--inline-description`, is NOT always present:
  it's the GitHub profile name, the very `github_name` that's often empty in the
  registry;
* `data-id` is a GraphQL node identifier, and its format is inconsistent: for some rows
  it's the old base64 (`MDQ6VXNlcjg2MjYxOTU4` → `04:User86261958`, where the number
  matches `github_id` in the registry), for others it's the new packed form
  (`U_kgDOEfxP3g`), which is undocumented. **Matching on `data-id` is not viable**,
  tempting as it is: half the rows wouldn't be resolvable.
* the popover appears on click and lives in a portal — a `MutationObserver` on `body`
  will see it.

### Solution (approved by Anatoly)

**The registry takes priority.** If a record exists in the registry, its name is shown
and the GitHub profile name in that row is hidden. If there's no record, we do
nothing — the GitHub profile name stays as-is.

| login | GitHub shows | in the registry | what the person sees |
| --- | --- | --- | --- |
| `AdrienLaaboudi` | nothing | no record | nothing |
| `Andrei-Iliushin-Constructor` | nothing | ANDREI ILIUSHIN | Andrei Iliushin |
| `Artifizer` | `Artifizer` | Alexander Andreev | Alexander Andreev |
| `AndrejK666` | `ANDREI KUCHMA` | `Andrej` | Andrej |

The last row is a deliberate price for the rule: in the registry this person's name is
shorter than their GitHub profile name. This is fixed not by code but by a registry
entry.

Hiding the profile name must be **reversible**: `removeAllDecorations` returns the row
to its original state, because this same function is called on format change and when
the extension is disabled.

## Queue: Assignees column in GitHub Projects (table view)

Requested by Anatoly. The markup was captured from a live logged-in page at
`https://github.com/orgs/constructorfabric/projects/48/views/1` via the DevTools
protocol; no need to re-investigate — the snapshot lives at
`tests/fixtures/github/projects-assignees.html`.

### Cell structure

One assignee:

```html
<div>
  <img src="https://avatars.githubusercontent.com/u/244471386?s=40&v=4" …>
  <span data-component="Text">ainetx</span>
</div>
```

Several assignees:

```html
<span data-component="AvatarStack" data-avatar-count="2">
  <div data-component="AvatarStack.Body"> <img …><img …></div>
</span>
<span data-component="Text">ainetx and Artifizer</span>
```

Facts:

* across the whole grid there are **zero** `data-hovercard-url` elements and no user
  links at all — none of the existing detection rules (`detect.ts`) will fire here;
* the login is plain text in `span[data-component="Text"]`, placed right after the
  avatar: either an `<img>` with `avatars.githubusercontent.com` in `src`, or
  `AvatarStack` wrappers around several such `<img>`s;
* hashed classes (`user-group-module__TextCell__meoOH` and the like) can't be used —
  they change with every GitHub deploy, the same reason already described in
  `detect.ts`;
* the structural rule "span right after the avatar" was checked on the live page: 16 of
  16 assignee cells found, 0 false positives out of the other 160
  `span[data-component="Text"]` elements on the page (14 cells with one assignee, 2
  with two);
* the cell's inner container is `overflow-x: hidden`, 116px within the cell itself,
  which is 157px wide. A trial span added the usual way (`append`/`after`) gets
  clipped: measuring the live page gave a right edge of 746px for the trial span
  against a cell boundary of 719px. A suffix physically doesn't fit here — the only
  option is to replace the text entirely rather than append to it.

### Solution (approved by Anatoly)

1. the login is replaced with the real name from the registry;
2. the original GitHub text (login or list of logins) goes into `title` — hovering
   shows who this really is;
3. with several assignees, names are joined with `", "` rather than a localized
   "and" — an "and" can't be reproduced in any GitHub interface language, whereas a
   comma always works.

`Settings.displayFormat` (dot/brackets/parens) has no effect here: all three formats
describe a suffix appended AFTER the login, which remains on the page, and in this
cell there's simply no room for a suffix.

### Rule about "and" before the last element

The list of logins is obtained by splitting the original text into tokens that match
`LOGIN_RE`. If there is exactly one more token than there are avatars (and there are at
least two avatars — otherwise there's nothing to join), the extra token is the
conjunction that GitHub's list formatting inserts before the last element ("a and b",
"a, b, and c"). It's discarded **by position** (the second-to-last token), not by a
list of known conjunction words: a word is localized interface text and will differ for
a user with a different interface language, whereas the position of the conjunction
before the last element is something list formatting does the same way in every locale.
For locales like Russian, where the equivalent conjunction is a single Cyrillic
character, this is even simpler: that character is not a Latin letter or digit, so the
tokenizing regex discards it as a separator on its own, and no extra token ever
appears.

### What's left

* **Board view** (cards, not a table) renders assignees as avatars only — there's no
  login in the DOM anywhere at all. The only hook is the numeric id in the avatar URL
  (`/u/244471386`), which matches `github_id` in the registry, but matching by id would
  need an id→name index, which storage doesn't have right now. Not done.
* **Assignee picker popover** (the one opened by clicking the cell itself) hasn't been
  investigated: clicking the cell on a real project risks actually changing the task's
  assignee set, and there's no test project for safe experiments.
