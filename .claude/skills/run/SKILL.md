---
name: run
description: Launch fabric-pass locally and drive it in a real browser — start the dev server, sign in without OAuth through /dev-login, click through a page over the Chrome DevTools Protocol, and capture screenshots. Use when asked to run, start, or screenshot the app, to see a change in the actual UI rather than only in the test suite, or to check that a page still renders correctly — «подними приложение», «посмотреть гуй», «скриншот», «проверь что не разъехалось».
---

# Running fabric-pass and looking at it

`pnpm test` proves the logic. It says nothing about whether the page still
renders. This skill covers the other half: getting the app up and then
actually driving it.

## Setup: follow the README, don't reinvent it

README's [Local setup](../../../README.md#local-setup) is the source of
truth — `.env.local`, the two databases, migrations, `pnpm dev`. Read it
rather than guessing. Three things are worth stating twice, because each
one costs a full cycle to rediscover:

- **`pnpm migrate` does not read `.env.local`.** `migrations/run.ts` reads
  `DATABASE_URL` from the shell environment, so it needs
  `set -a; source .env.local; set +a; pnpm migrate` (README step 4).
  `node --env-file=.env.local migrations/run.ts` works too.
- **Serve on the port `APP_URL` names** (`http://localhost:3000`).
  `/dev-login` redirects through `env.APP_URL` and refuses non-loopback
  hosts, and the OAuth callbacks are registered against that exact origin.
  A dev server on 3001 fails in ways that look like application bugs.
- **`pnpm dev` rewrites `tsconfig.json`** on first start — it reformats the
  file and adds `allowJs` and `.next/dev/types`. That is Next.js, not your
  change. `git checkout -- tsconfig.json` before committing.

## Signing in: `/dev-login`, never a hand-made cookie

Open `/dev-login` and pick a contributor; the session is written directly,
no provider round-trip. See README's
[Signing in locally without OAuth](../../../README.md#signing-in-locally-without-oauth)
for why the route cannot exist outside a development build.

Do **not** mint an `iron-session` cookie with `sealData` to get a session.
It works, and it is strictly more work than `/dev-login`, which already
exists for exactly this.

**The Admin pages need a contributor row, not just `ROOT_GITHUB_ID`.**
Every admin page calls `findByGithubId(session.github.id)` and renders "Not
authorized" when it comes back empty — `isAdmin` is never reached, so the
root-user escape hatch does not fire for an id with no row. On an empty or
unfamiliar database, seed one:

```js
// seed.mjs — run with: node --env-file=.env.local seed.mjs
import pg from 'pg'
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
await pool.query(
  `INSERT INTO contributors (github_id, github_login, name, email, status, is_admin)
   VALUES ('20254119', 'lobster40', 'Anatoly Bobrov', 'a@example.com', 'confirmed', true)
   ON CONFLICT (github_id) DO UPDATE SET is_admin = true, status = 'confirmed'`,
)
await pool.end()
```

Seed whatever the change needs to be visible, too — a contributor with a
deliberately messy name, a `draft` row, a revoke-pending one. A page with
nothing on it proves nothing.

## Driving it: Chrome over the DevTools Protocol

There is no Playwright in this repo and adding one is not worth it. Chrome
plus CDP over Node's built-in `WebSocket` is enough, and it needs no
dependency at all.

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --remote-debugging-port=9222 \
  --user-data-dir="$(mktemp -d)" --no-first-run --disable-gpu about:blank
```

Then drive it with [`cdp.mjs`](cdp.mjs) in this directory, which opens a
tab, exposes `evaluate()`/`shot()`/`go()`, and is meant to be copied into a
scratch file and edited per task:

```sh
node cdp.mjs http://localhost:3000/dev-login?as=lobster40 /tmp/shots
```

Four things that will otherwise waste a run:

- **Wait ~8s after the first `Page.navigate` to a route.** Turbopack
  compiles each route on first hit. A 3-second wait lands you on a
  half-rendered page, and the symptom is a screenshot of the wrong content
  with no error anywhere.
- **React-controlled inputs ignore `input.value = '…'`.** Go through the
  native setter, then dispatch the event React listens for:
  ```js
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  set.call(input, 'Anatoly Bobrov')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  ```
- **Pin the viewport** with `Emulation.setDeviceMetricsOverride`
  (`1440×1100`, `deviceScaleFactor: 2`) so screenshots are comparable
  between runs and legible when read back.
- **The ui-kit dialog is `[role="dialog"]`.** Scope queries to it —
  `[role="dialog"] input`, `[role="dialog"] button` — or you will find the
  page's own controls behind the overlay.

**Then look at the screenshot.** A blank frame, a page of unstyled text, or
the wrong route means the run failed, however clean the console was.

## Afterwards

- Kill the dev server and Chrome.
- `git checkout -- tsconfig.json`.
- Keep scratch scripts (`seed.mjs`, the edited `cdp.mjs`, screenshots) out
  of the repository — the working tree at the end of a run should contain
  only the change under review.
