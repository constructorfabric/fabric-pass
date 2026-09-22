# Handover: the GitHub Real Names extension

For a new session. This covers only what is **not in the code** and what was expensive to
figure out again. You will still need to read the code itself — it is self-contained, with
tests and comments that explain the reasons behind decisions. There is no need to recap the
course of work here.

## Where things live

| | |
| --- | --- |
| `GHnameExt.md` | PRD, updated for the `contributors.yaml` format |
| `PLAN.md` | implementation plan; also records the decisions and their reasons |
| `extension/` | code, 333 tests, git repository |
| `extension/README.md` | installation, build, where the data comes from |
| `extension/scripts/cdp/README.md` | how to inspect the extension on live GitHub pages |

Repository: `https://github.com/lobster40/cf-user-extension-internal`, private, `main` branch.
It lives in a personal account because the `constructorfabric` organization's policy does not
let a member-role user create repositories. It can be transferred to the organization later
without losing history via Settings → Transfer ownership; GitHub will leave a redirect.

Pre-commit check — `npm run check` (types, lint, tests).

## Rules that must not be broken

**There must be no Russian text anywhere in the repository** — not in comments, not in
JSDoc, not in test names, not in the README. The only exception is
`public/_locales/ru/messages.json`, where Russian is the actual content. Check across all
files (`git ls-files`), not a single directory: last time, checking only `src/` missed the
tests and the README.

**Do not publish artifacts and reports without being asked.** Result files go in their usual
location inside the project, not in the session scratchpad.

## Facts about GitHub's markup

Everything here was measured on live, logged-in pages of `constructorfabric/gears-rust`,
not derived from documentation. GitHub serves **different markup to a logged-in user versus
an anonymous one**, so the fixtures in `tests/fixtures/github/` (captured via curl, i.e.
anonymously) do not match what the extension sees in reality. This is the project's main
trap.

* **Links to people appear WITHOUT hovercard attributes; the attribute is added later.**
  In one load of a commit list: 12 links arrived with `data-hovercard-url` right away,
  47 arrived without it, and **70** got it via a separate mutation (`oldValue: null`). So
  the observer must watch attribute mutations too, not just node additions.
* **At the moment the content script starts, the number of user links on the page can be
  zero** (`readyState === "interactive"`). On such pages the first synchronous pass finds
  nothing, and the observer produces the entire result.
* **The `href` of a user link is not the login.** On issue and PR lists it points to a
  search query like `/OWNER/REPO/issues?q=…author%3Ajohnpapa`. Naively parsing the first
  path segment yields the organization name.
* **On the PR list there are no hovercard attributes at all.** The login sits in `href` as
  `author:<login>` and is duplicated in the link's text; there is a
  `data-testid="author-filter-link"`.
* **Primer classes contain a build hash** (`PullsListItem-module__filterLink__a5ZnW`,
  `prc-ActionList-ItemLabel-81ohH`) — they change on every deploy, cannot be relied on.
* **`aria-label` is localized** (`Filter by author …`) — cannot be relied on.
* **In dropdown filters, `data-id` comes in two incompatible formats**: some rows have the
  old base64 form (`MDQ6VXNlcjg2MjYxOTU4` → `04:User86261958`, the number matches the
  `github_id` in the registry), others have the new packed form (`U_kgDOEfxP3g`),
  undocumented. Matching on it is not viable — half the rows would fail to parse. If
  matching by identifier is ever needed, take it from the avatar URL instead:
  `avatars.githubusercontent.com/u/20254119`.
* **Person rows in dropdowns have a GitHub avatar**; label and milestone rows do not. The
  ActionList component is shared, so without an avatar check a login like `docs` would
  mark up a label row.
* **A single person appears in the PR page via several links** with matching attributes
  (avatar, name as text, avatar in the commit stack). Only the ones that have their own
  visible text should be decorated.
* **App accounts are displayed as `github-actions[bot]`**, while `href` holds
  `github-actions`. Matching the text against the login filters these out, and that is
  intentional: there is no name to show for a bot.

## Verified dead ends — don't waste time re-checking these

* **`--load-extension` does not work in Chrome 153.** The extension silently fails to load.
  Load it via the protocol instead: `node scripts/cdp/load-extension.mjs`.
* **`--disable-extensions-except` disables everything**, including extensions loaded by
  hand. Do not pass it. On one occasion this looked like a full regression of the
  extension.
* **`requestAnimationFrame` is not invoked in a hidden tab**, and a tab counts as hidden
  whenever the window is not focused at the OS level. `Page.bringToFront` and
  `Emulation.setFocusEmulationEnabled` do not change this: focus appears, visibility does
  not. Right now the markup does not depend on a frame, but any measurement that waits for
  a frame will hang in a hidden tab.
* **Navigating to `chrome-extension://…/options.html` via the protocol is blocked** — a
  placeholder page is returned instead. Reach the extension's API through its service
  worker.
* **The service worker is not visible in the target list while it is asleep.** It wakes up
  when the extension is reloaded.
* **React does not erase anything.** The hypothesis that it discards our insertions was
  checked and is false: the `data-ghname-done` flag would remain on the elements, and it
  does not.

## Open questions

**No release has been published yet.** The version in `package.json` is `0.1.0`. To
release: bump the version, create the `vX.Y.Z` tag, push the tag — CI will build both
archives and publish them. The workflow checks that the tag matches the version.

**The extension has never been installed in Anatoly's main browser.** Everything has been
verified in a debug profile. The built-in source works there: status `ok`, 64 records from
the private `cf-internal`, using the browser session.

**Firefox: a permanent install requires signing in AMO.** `Load Temporary Add-on` lasts
only until the browser restarts. Signing is free, but it is a separate step, and it has not
been done.

**Safari is not supported.** The `wxt build -b safari` build succeeds, but Safari requires
wrapping it into a native app via `xcrun safari-web-extension-converter`, which needs full
Xcode (this machine only has the Command Line Tools). Also, `permissions.request` behaves
differently in Safari — the URL-based source will most likely need to be reworked there.

**Repository name.** Anatoly asked for `cf-userExtention-internal`; I went with
`cf-user-extension-internal` — without the typo in the word "Extension" and in the style of
`cf-internal`.

## Product decisions made

**The registry takes priority over GitHub's profile name.** In dropdown filters, GitHub
already shows its own name in some places. If a record exists in the registry, the
registry's name is shown and the profile name is hidden; if there is no record, the row is
left untouched. The cost of this rule shows up on `AndrejK666`: the registry has `Andrej`
for him, while GitHub shows `ANDREI KUCHMA`, which is more informative. This is fixed by
editing the registry, not the code.

**Hiding the profile name must be reversible.** The same unmarking function runs when the
display format changes and when the extension is disabled. A test compares the row's
markup byte-for-byte before and after.

**All display formats are "login, separator, name"**, differing only in the separator
(`·`, `( )`, `[ ]`). The PRD originally had a `Name [login]` format, but it is unachievable:
the login sits inside GitHub's own link, and insertion is only possible after the element.
The preview in settings is now built by calling the same function that produces the text on
the page, so the two cannot diverge.

**A failed load of the built-in source never wipes out records.** A 404, a network drop,
corrupt data, an empty response — only the status is updated. An empty result is
deliberately treated as a failure: the corporate registry is never empty, but GitHub can
return an empty result on failure, and that would erase names for everyone.

**Only a login that actually made it into the index counts as a duplicate.** A record
skipped for another reason does not block the next valid record with the same login;
otherwise a pair like `{alice, name: null}` followed by `{alice, name: "Alice Smith"}`
would silently swallow the name.

## How work with agents was organized

The implementation went through subagents in waves, with specs in `PLAN.md`. What is worth
repeating:

* **contracts first.** Types and fixtures are written before parallel agents start work,
  otherwise they will invent incompatible interfaces;
* **split tasks by file, not by topic.** Two agents in the same file produce a collision —
  this happened once, on `src/core/messages.ts`;
* **forbid relying on unreliable signals directly in the spec.** An agent will use hashed
  classes and localizable labels if not explicitly forbidden: they look convenient;
* **demand verification, not reasoning.** The phrasing "check it against the actual facts
  and show the output" caught real discrepancies; several agents honestly reported that
  the spec did not match reality, and they were right.
