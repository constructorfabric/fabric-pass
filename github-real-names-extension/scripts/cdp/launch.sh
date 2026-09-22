#!/usr/bin/env bash
# Launch Chrome against the dev profile with the DevTools protocol open, so the
# extension can be inspected on real GitHub pages.
#
# Why this exists: the only way to find out what GitHub's markup actually looks like
# for a logged-in user is to look at it. Fixtures are snapshots of a logged-out view
# and differ from what the extension really sees.
#
# Do NOT add --load-extension or --disable-extensions-except: the first is ignored by
# current Chrome, and the second then disables every extension in the profile,
# including one loaded by hand. Load the extension with `load-extension.mjs` instead.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROFILE="$ROOT/.dev-profile/chromium"
PORT="${CDP_PORT:-9222}"
URL="${1:-https://github.com}"

mkdir -p "$PROFILE"
exec "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE" \
  --no-first-run --no-default-browser-check \
  "$URL"
