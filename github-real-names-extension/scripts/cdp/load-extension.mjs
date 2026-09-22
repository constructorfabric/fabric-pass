// Load (or reload) the built extension into the running Chrome via the DevTools protocol.
// Chrome ignores the --load-extension command-line flag, so this is the way to get an
// unpacked build in without clicking through chrome://extensions. Re-running it picks up
// a fresh `npm run build` and wakes the service worker.
import { resolve } from 'node:path'

const port = process.env.CDP_PORT ?? '9222'
const path = resolve(process.argv[2] ?? '.output/chrome-mv3')

const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
const ws = new WebSocket(version.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

const result = await new Promise((resolve) => {
  const onMessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id === 1) { ws.removeEventListener('message', onMessage); resolve(message) }
  }
  ws.addEventListener('message', onMessage)
  ws.send(JSON.stringify({ id: 1, method: 'Extensions.loadUnpacked', params: { path } }))
})
ws.close()
console.log(JSON.stringify(result.result ?? result.error, null, 2))
