import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { clientIp, isFromGitHub, parseHookRanges, shouldDeploy, verifySignature } from './verify.mjs'

// IDEA-044 — this endpoint is called by GitHub itself, not by a runner's
// `curl`. Authentication is `X-Hub-Signature-256` (HMAC-SHA256 of the raw
// body under the shared secret), with GitHub's published hook IP ranges as
// defence in depth behind it. See verify.mjs for the reasoning behind each
// check; this file is the I/O half.

const SECRET = process.env.DEPLOY_WEBHOOK_SECRET
if (!SECRET) throw new Error('DEPLOY_WEBHOOK_SECRET is not set')

const COMPOSE_ARGS = ['compose', '-f', '/deploy/docker-compose.yml', '--project-directory', '/deploy']

// A workflow_run delivery is a few KB. Anything past this isn't a real
// delivery, and refusing it before buffering keeps a public endpoint from
// being used to grow this process's memory.
const MAX_BODY_BYTES = 1024 * 1024

// GitHub can change its published hook ranges, so they're refreshed
// periodically rather than pinned — hourly keeps the allowlist current
// without ever making a delivery wait on a live lookup.
const RANGES_REFRESH_MS = 60 * 60 * 1000

/** `null` until the first successful fetch, and left as-is on a failed
 * refresh — isFromGitHub treats that as "allow", so api.github.com being
 * unreachable degrades to signature-only rather than blocking deploys. */
let hookRanges = null

async function refreshHookRanges() {
  try {
    const response = await fetch('https://api.github.com/meta', {
      headers: { 'user-agent': 'fabric-pass-deploy-webhook' },
    })
    if (!response.ok) throw new Error(`api.github.com/meta responded ${response.status}`)

    const parsed = parseHookRanges((await response.json()).hooks)
    if (!parsed) throw new Error('api.github.com/meta returned no usable hook ranges')

    hookRanges = parsed
  } catch (error) {
    console.error('could not refresh GitHub hook ranges:', error.message)
  }
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function redeploy() {
  execFile('docker', [...COMPOSE_ARGS, 'pull', 'app'], (pullError, _stdout, pullStderr) => {
    if (pullError) return console.error('pull failed:', pullStderr)
    execFile('docker', [...COMPOSE_ARGS, 'up', '-d', 'app'], (upError, upStdout, upStderr) => {
      if (upError) return console.error('up failed:', upStderr)
      console.log('deployed:', upStdout.trim())
      // Every pull retags the previous image to <none> instead of removing
      // it. With no cleanup those accumulate on every deploy and eventually
      // fill the disk — which then makes every future pull fail with "no
      // space left on device", silently, days after the image that actually
      // filled it shipped. Pruning only after a successful deploy (not
      // before pulling) means a failed pull never loses the still-good
      // image a rollback might need.
      execFile('docker', ['image', 'prune', '-f'], (pruneError, _pruneStdout, pruneStderr) => {
        if (pruneError) console.error('prune failed:', pruneStderr)
      })
    })
  })
}

async function handle(req, res) {
  if (req.method !== 'POST' || req.url !== '/deploy-hook') {
    res.writeHead(404).end()
    return
  }

  // Cheapest check first, before anything is buffered.
  const ip = clientIp(req.headers['x-forwarded-for'], req.socket.remoteAddress)
  if (!isFromGitHub(hookRanges, ip)) {
    console.warn(`rejected ${ip}: outside GitHub's published hook ranges`)
    res.writeHead(403).end('forbidden')
    return
  }

  let raw
  try {
    raw = await readBody(req, MAX_BODY_BYTES)
  } catch {
    res.writeHead(413).end('payload too large')
    return
  }

  if (!verifySignature(SECRET, raw, req.headers['x-hub-signature-256'])) {
    console.warn(`rejected ${ip}: bad or missing X-Hub-Signature-256`)
    res.writeHead(401).end('unauthorized')
    return
  }

  // Past this point the payload is proven to come from whoever holds the
  // secret, so its fields are safe to read.
  const event = req.headers['x-github-event']

  // GitHub sends `ping` once, when the webhook is first created — answering
  // it is what turns a green tick in the repo's webhook settings into real
  // evidence that the URL, the secret and the TLS chain all work.
  if (event === 'ping') {
    res.writeHead(200).end('pong')
    return
  }

  if (event !== 'workflow_run') {
    res.writeHead(204).end()
    return
  }

  let payload
  try {
    payload = JSON.parse(raw.toString('utf8'))
  } catch {
    res.writeHead(400).end('invalid json')
    return
  }

  if (!shouldDeploy(payload)) {
    res.writeHead(204).end()
    return
  }

  // Answer before deploying: GitHub times a delivery out after 10 seconds
  // and retries, and a `docker compose pull` is far slower than that.
  res.writeHead(202).end('deploying')
  console.log(`deploying ${payload.workflow_run.head_sha} (run ${payload.workflow_run.id})`)
  redeploy()
}

const server = createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error('request failed:', error)
    if (!res.headersSent) res.writeHead(500).end('internal error')
  })
})

await refreshHookRanges()
setInterval(refreshHookRanges, RANGES_REFRESH_MS).unref()

server.listen(9000, () => console.log('deploy webhook listening on :9000'))
