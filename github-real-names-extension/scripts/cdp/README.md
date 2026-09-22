# Inspecting the extension on real GitHub pages

Tests run against fixtures, and fixtures are snapshots. Several defects in this extension
were only visible on a live, logged-in page — GitHub serves different markup to a signed-in
user, and parts of it are filled in after the elements are already in the DOM. These three
scripts are how that was measured.

```bash
./scripts/cdp/launch.sh https://github.com/OWNER/REPO/commits/main   # once; sign in to GitHub in that window
npm run build
node scripts/cdp/load-extension.mjs                                  # after every rebuild
node scripts/cdp/cdp.mjs 'document.querySelectorAll("[data-ghname-for]").length' 'commits/main'
```

The browser profile lives in `.dev-profile/` (git-ignored), so the GitHub session survives
restarts.

## Things worth knowing before you debug

- A hidden tab reports `document.visibilityState === "hidden"` whenever its window is not
  frontmost, and `requestAnimationFrame` never fires there. Decoration no longer depends on
  it, but any measurement that waits on a frame will hang.
- Top-level navigation to `chrome-extension://…` pages is refused when it comes from the
  protocol, so the options page cannot be opened this way. Reach extension APIs through the
  service worker target instead.
- The service worker is not listed while it sleeps. `load-extension.mjs` wakes it.

## Reading extension state

```bash
node scripts/cdp/cdp.mjs '(async () => {
  const state = await chrome.storage.local.get(["idx", "settings", "sources"])
  return { entries: Object.keys(state.idx ?? {}).length, settings: state.settings }
})()' '<extension-id>'
```
