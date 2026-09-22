// Drives a running dev server through the Chrome DevTools Protocol.
//
// Chrome first:
//   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//     --headless=new --remote-debugging-port=9222 \
//     --user-data-dir="$(mktemp -d)" --no-first-run --disable-gpu about:blank
//
// Then:
//   node cdp.mjs <url> [out-dir]
//
// This is a starting point, not a library: copy it to a scratch file
// outside the repository and add the clicks the change needs. `go()`
// waits long enough for Turbopack to compile a route on first hit — see
// SKILL.md for why a shorter wait silently screenshots the wrong page.

import { writeFileSync } from 'node:fs'

const START_URL = process.argv[2] ?? 'http://localhost:3000/dev-login'
const OUT = process.argv[3] ?? '/tmp'
const DEBUG_PORT = process.env.CDP_PORT ?? '9222'

const target = await (
  await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?url=about:blank`, { method: 'PUT' })
).json()

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve) => (ws.onopen = resolve))

let nextId = 0
const pending = new Map()
ws.onmessage = (message) => {
  const msg = JSON.parse(message.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result ?? msg.error)
    pending.delete(msg.id)
  }
}

/** One CDP command. */
export const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++nextId
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Runs an expression in the page and returns its value (or the thrown text). */
export async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result?.exceptionDetails) return `EXCEPTION: ${result.exceptionDetails.text}`
  return result?.result?.value
}

/** Navigates and waits out Turbopack's first-hit compile of the route. */
export async function go(url, settleMs = 8000) {
  await send('Page.navigate', { url })
  await sleep(settleMs)
  return evaluate('location.href')
}

/** Writes <out>/<name>.png and says so. */
export async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'))
  console.log(`saved ${name}.png`)
}

/** Sets a React-controlled input's value the way React will notice. */
export const typeInto = (selector, value) =>
  evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)})
    if (!input) return 'no element for ${selector}'
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return 'typed'
  })()`)

/** Clicks the first button whose text contains `text`, optionally within `scope`. */
export const clickButton = (text, scope = 'document') =>
  evaluate(`(() => {
    const root = ${scope === 'document' ? 'document' : `document.querySelector(${JSON.stringify(scope)})`}
    if (!root) return 'no scope ${scope}'
    const button = [...root.querySelectorAll('button')].find((b) => b.textContent.includes(${JSON.stringify(text)}))
    if (!button) return 'no button matching ${text}'
    if (button.disabled) return 'button disabled'
    button.click()
    return 'clicked'
  })()`)

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 2, mobile: false })

// --- edit from here down ------------------------------------------------
console.log('at:', await go(START_URL))
console.log('headings:', await evaluate(`[...document.querySelectorAll('h1,h2,h3')].map((h) => h.textContent.trim()).join(' | ')`))
await shot('01-start')
// ------------------------------------------------------------------------

ws.close()
process.exit(0)
