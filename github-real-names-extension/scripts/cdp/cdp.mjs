// Run an expression in a page, or in the extension's service worker.
//
//   node cdp.mjs '<expression>' [target-substring]
//
// The target is matched against each target's url+title, so pass a page URL fragment
// ("commits/main") or the extension id to reach its service worker. Pick the service
// worker when the expression needs extension APIs (chrome.storage, chrome.tabs); a page
// only has the DOM. The worker sleeps when idle — reload the extension to wake it.
const expr = process.argv[2]
const match = process.argv[3] ?? 'github.com'
const port = process.env.CDP_PORT ?? '9222'

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const target = targets.find((t) => (t.url + t.title).includes(match))
if (!target) {
  console.error('No target matched. Available:')
  for (const t of targets) console.error(`  ${t.type}  ${t.url}`)
  process.exit(1)
}

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })

const result = await new Promise((resolve) => {
  const onMessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id === 1) { ws.removeEventListener('message', onMessage); resolve(message) }
  }
  ws.addEventListener('message', onMessage)
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: { expression: expr, returnByValue: true, awaitPromise: true },
  }))
})
ws.close()

const details = result.result?.exceptionDetails
if (details) {
  console.error('Page threw:', details.exception?.description ?? details.text)
  process.exit(1)
}
console.log(JSON.stringify(result.result?.result?.value, null, 2))
