import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  clientIp,
  isFromGitHub,
  parseHookRanges,
  shouldDeploy,
  verifySignature,
} from './verify.mjs'

const SECRET = 'a'.repeat(64)

function sign(body, secret = SECRET) {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

describe('verifySignature', () => {
  const body = Buffer.from(JSON.stringify({ action: 'completed' }))

  it('accepts a signature produced with the same secret over the same body', () => {
    expect(verifySignature(SECRET, body, sign(body))).toBe(true)
  })

  it('rejects a body that changed after it was signed', () => {
    const signature = sign(body)
    const tampered = Buffer.from(JSON.stringify({ action: 'requested' }))
    expect(verifySignature(SECRET, tampered, signature)).toBe(false)
  })

  it('rejects a signature made with a different secret', () => {
    expect(verifySignature(SECRET, body, sign(body, 'b'.repeat(64)))).toBe(false)
  })

  it('rejects a missing, empty, or non-string header rather than throwing', () => {
    expect(verifySignature(SECRET, body, undefined)).toBe(false)
    expect(verifySignature(SECRET, body, '')).toBe(false)
    expect(verifySignature(SECRET, body, ['sha256=deadbeef'])).toBe(false)
  })

  it('rejects a truncated signature without throwing on the length mismatch', () => {
    // timingSafeEqual throws unless both buffers are the same length, so this
    // is the case the explicit length guard in verifySignature exists for.
    expect(verifySignature(SECRET, body, sign(body).slice(0, 20))).toBe(false)
  })

  it('rejects the bare hex digest when the sha256= prefix is missing', () => {
    const bare = createHmac('sha256', SECRET).update(body).digest('hex')
    expect(verifySignature(SECRET, body, bare)).toBe(false)
  })
})

describe('parseHookRanges', () => {
  it('parses the IPv4 and IPv6 CIDRs api.github.com/meta actually returns', () => {
    const ranges = parseHookRanges(['192.30.252.0/22', '2a0a:a440::/29'])
    expect(ranges).not.toBeNull()
    expect(isFromGitHub(ranges, '192.30.252.1')).toBe(true)
    expect(isFromGitHub(ranges, '2a0a:a440::1')).toBe(true)
  })

  it('returns null for an empty or non-array value, so the caller fails open', () => {
    expect(parseHookRanges([])).toBeNull()
    expect(parseHookRanges(undefined)).toBeNull()
    expect(parseHookRanges('192.30.252.0/22')).toBeNull()
  })

  it('skips malformed entries but keeps the usable ones', () => {
    const ranges = parseHookRanges(['not-a-cidr', '192.30.252.0/nonsense', 42, '192.30.252.0/22'])
    expect(ranges).not.toBeNull()
    expect(isFromGitHub(ranges, '192.30.252.1')).toBe(true)
  })

  it('returns null when nothing in the list was usable', () => {
    expect(parseHookRanges(['not-a-cidr', 42])).toBeNull()
  })
})

describe('clientIp', () => {
  it('prefers CF-Connecting-IP, since behind Cloudflare nothing else names the caller', () => {
    // Production's real chain is GitHub -> Cloudflare -> Caddy -> here, so
    // X-Forwarded-For's rightmost entry is a Cloudflare edge address and the
    // socket peer is Caddy. Reading either would 403 every genuine delivery.
    expect(clientIp('192.30.252.1', '172.71.246.4', '172.18.0.5')).toBe('192.30.252.1')
  })

  it('reads the rightmost X-Forwarded-For entry, not the leftmost, with no Cloudflare', () => {
    // The security-critical fallback: a caller prepends a GitHub address
    // hoping to be allowlisted, and the proxy appends the address it really
    // saw. Reading leftmost would trust the attacker's value outright.
    expect(clientIp(undefined, '192.30.252.1, 203.0.113.9', '10.0.0.2')).toBe('203.0.113.9')
  })

  it('ignores an empty CF-Connecting-IP rather than treating it as an answer', () => {
    expect(clientIp('', '192.30.252.1, 203.0.113.9', '10.0.0.2')).toBe('203.0.113.9')
    expect(clientIp('   ', undefined, '203.0.113.9')).toBe('203.0.113.9')
  })

  it('falls back to the socket peer when no proxy headers are present', () => {
    expect(clientIp(undefined, undefined, '203.0.113.9')).toBe('203.0.113.9')
    expect(clientIp(undefined, '   ', '203.0.113.9')).toBe('203.0.113.9')
  })

  it('unwraps the IPv4-mapped IPv6 form Node reports on a dual-stack socket', () => {
    expect(clientIp(undefined, undefined, '::ffff:203.0.113.9')).toBe('203.0.113.9')
    expect(clientIp('::ffff:192.30.252.1', undefined, '10.0.0.2')).toBe('192.30.252.1')
  })

  it('leaves a genuine IPv6 address alone', () => {
    expect(clientIp(undefined, undefined, '2a0a:a440::1')).toBe('2a0a:a440::1')
    expect(clientIp('2a0a:a440::1', undefined, '10.0.0.2')).toBe('2a0a:a440::1')
  })

  it('tolerates the whitespace proxies leave around entries', () => {
    expect(clientIp(undefined, '192.30.252.1 ,  203.0.113.9  ', '10.0.0.2')).toBe('203.0.113.9')
    expect(clientIp('  192.30.252.1  ', undefined, '10.0.0.2')).toBe('192.30.252.1')
  })
})

describe('isFromGitHub', () => {
  const ranges = parseHookRanges(['192.30.252.0/22', '2a0a:a440::/29'])

  it('allows anything when the ranges are unknown — signature is the real control', () => {
    expect(isFromGitHub(null, '203.0.113.9')).toBe(true)
  })

  it('allows an address inside a published range', () => {
    expect(isFromGitHub(ranges, '192.30.252.1')).toBe(true)
  })

  it('rejects an address outside every published range', () => {
    expect(isFromGitHub(ranges, '203.0.113.9')).toBe(false)
  })

  it('rejects something that is not an address at all', () => {
    expect(isFromGitHub(ranges, '')).toBe(false)
    expect(isFromGitHub(ranges, 'not-an-ip')).toBe(false)
  })
})

describe('shouldDeploy', () => {
  const success = {
    action: 'completed',
    workflow_run: { name: 'Build and deploy', head_branch: 'main', conclusion: 'success' },
  }

  it('accepts a completed, successful run of the deploy workflow on main', () => {
    expect(shouldDeploy(success)).toBe(true)
  })

  it('ignores the hourly contributors export, which would otherwise redeploy every hour', () => {
    expect(
      shouldDeploy({ ...success, workflow_run: { ...success.workflow_run, name: 'Export contributors registry' } }),
    ).toBe(false)
  })

  it('ignores a run on any branch other than main', () => {
    expect(
      shouldDeploy({ ...success, workflow_run: { ...success.workflow_run, head_branch: 'idea-044-webhook' } }),
    ).toBe(false)
  })

  it('ignores a failed or cancelled run rather than deploying a stale :latest', () => {
    expect(shouldDeploy({ ...success, workflow_run: { ...success.workflow_run, conclusion: 'failure' } })).toBe(false)
    expect(shouldDeploy({ ...success, workflow_run: { ...success.workflow_run, conclusion: 'cancelled' } })).toBe(false)
    expect(shouldDeploy({ ...success, workflow_run: { ...success.workflow_run, conclusion: null } })).toBe(false)
  })

  it('ignores the requested/in_progress stages of the same run', () => {
    expect(shouldDeploy({ ...success, action: 'requested' })).toBe(false)
    expect(shouldDeploy({ ...success, action: 'in_progress' })).toBe(false)
  })

  it('ignores a payload with no workflow_run at all rather than throwing', () => {
    expect(shouldDeploy({ action: 'completed' })).toBe(false)
    expect(shouldDeploy({})).toBe(false)
    expect(shouldDeploy(undefined)).toBe(false)
  })
})
