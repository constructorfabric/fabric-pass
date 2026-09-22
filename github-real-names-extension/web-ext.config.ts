import { resolve } from 'node:path'
import { defineWebExtConfig } from 'wxt'

/**
 * How `npm run dev` launches the browser.
 *
 * The point of the persistent profile: the extension's built-in source reads a file from
 * a private GitHub repository using your browser session, so anything involving it can
 * only be tested while logged in. web-ext creates a throwaway profile by default, which
 * would log you out on every restart — `keepProfileChanges` keeps the profile on disk so
 * you sign in to GitHub once.
 *
 * The profile directory is git-ignored. Delete it to start from a clean browser.
 */
export default defineWebExtConfig({
  chromiumProfile: resolve('.dev-profile/chromium'),
  keepProfileChanges: true,

  // Opens straight at a pull request list — the view where name decoration is still
  // being worked on. Change or drop this if you are debugging something else.
  startUrls: ['https://github.com/constructorfabric/gears-rust/pulls'],
})
