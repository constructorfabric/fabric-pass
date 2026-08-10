import { createHmac, timingSafeEqual } from 'node:crypto'
import { BlockList, isIPv4, isIPv6 } from 'node:net'

// IDEA-044 — the pure half of the deploy webhook: signature verification,
// source-IP checking, and the "is this delivery one we should act on" gate.
// Deliberately free of I/O and process state so it can be tested directly
// (verify.test.mjs) without binding a port or shelling out to Docker. See
// server.mjs for the half that listens and actually deploys.

export const DEPLOY_WORKFLOW = 'Build and deploy'
export const DEPLOY_BRANCH = 'main'

/**
 * GitHub signs the *raw* request body with the webhook secret and sends the
 * digest as `X-Hub-Signature-256: sha256=<hex>`. It has to be the raw bytes:
 * re-serialising parsed JSON would reorder or reformat it and produce a
 * different digest, so the caller buffers the body and hands it here
 * untouched.
 *
 * Unlike the bearer token this replaced, the secret itself never travels
 * over the wire — only a digest proving possession of it. That, not
 * brute-force resistance, is the actual gain: the secret was already 64 hex
 * chars (256-bit), so guessing it was never the threat worth designing
 * against.
 */
export function verifySignature(secret, rawBody, header) {
  if (typeof header !== 'string' || header === '') return false

  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`
  const expectedBuf = Buffer.from(expected)
  const providedBuf = Buffer.from(header)

  // `timingSafeEqual` throws on a length mismatch rather than returning
  // false, so the length check has to come first — it leaks only the
  // digest's length, which is a fixed constant for sha256 anyway.
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf)
}

/**
 * Turns api.github.com/meta's `hooks` array of CIDR strings into a
 * `net.BlockList`. Returns `null` for anything that doesn't look like the
 * real list — the caller reads "unknown" as *allow*, never as *deny*
 * (see isFromGitHub), so a bad or empty response can never wedge deploys.
 */
export function parseHookRanges(hooks) {
  if (!Array.isArray(hooks) || hooks.length === 0) return null

  const ranges = new BlockList()
  let added = 0
  for (const entry of hooks) {
    if (typeof entry !== 'string') continue
    const [address, prefix] = entry.split('/')
    const bits = Number(prefix)
    if (!Number.isInteger(bits)) continue

    if (isIPv4(address)) {
      ranges.addSubnet(address, bits, 'ipv4')
      added += 1
    } else if (isIPv6(address)) {
      ranges.addSubnet(address, bits, 'ipv6')
      added += 1
    }
  }

  return added > 0 ? ranges : null
}

/** Node reports an IPv4 peer on a dual-stack socket as `::ffff:1.2.3.4`;
 * BlockList's ipv4 rules don't match that form, so unwrap it first. */
function normalizeIp(ip) {
  if (ip.startsWith('::ffff:')) {
    const mapped = ip.slice('::ffff:'.length)
    if (isIPv4(mapped)) return mapped
  }
  return ip
}

/**
 * Caddy terminates TLS in front of this service, so the socket's peer is
 * always Caddy — the real caller is in X-Forwarded-For.
 *
 * The *rightmost* entry is the one to read, not the leftmost. Caddy is
 * configured to overwrite the header with the address it actually observed
 * (see deploy/Caddyfile), but reading right-to-left stays correct even if
 * that config is ever lost or changed: a client can prepend whatever it
 * likes to X-Forwarded-For, but it cannot append past the proxy in front of
 * it. Reading the leftmost entry — the usual mistake — would let anyone
 * claim a GitHub address just by setting the header, turning the allowlist
 * below into a bypass.
 */
export function clientIp(forwardedFor, remoteAddress) {
  if (typeof forwardedFor === 'string' && forwardedFor.trim() !== '') {
    const hops = forwardedFor.split(',')
    return normalizeIp(hops[hops.length - 1].trim())
  }
  return normalizeIp(remoteAddress ?? '')
}

/**
 * Defence in depth behind the signature, never the primary control — which
 * is why unknown ranges (`null`) means allow rather than deny.
 *
 * This is only worth checking at all because GitHub publishes just 6 CIDR
 * ranges for webhook delivery. The `actions` list, by contrast, is over
 * seven thousand ranges shared by every GitHub-hosted runner on earth, so
 * allowlisting *that* — the obvious thing to reach for when the trigger was
 * still a runner's `curl` — would have been close to meaningless.
 */
export function isFromGitHub(ranges, ip) {
  if (ranges === null) return true
  if (isIPv4(ip)) return ranges.check(ip, 'ipv4')
  if (isIPv6(ip)) return ranges.check(ip, 'ipv6')
  return false
}

/**
 * A `workflow_run` delivery fires for every workflow in the repository, at
 * every stage of every run, so the gate has to be narrow. Without the name
 * check the hourly "Export contributors registry" run would redeploy
 * production every hour; without the conclusion check a *failed* build would
 * deploy whatever stale `:latest` happened to still be in the registry.
 */
export function shouldDeploy(payload) {
  const run = payload?.workflow_run
  return (
    payload?.action === 'completed' &&
    run?.name === DEPLOY_WORKFLOW &&
    run?.head_branch === DEPLOY_BRANCH &&
    run?.conclusion === 'success'
  )
}
