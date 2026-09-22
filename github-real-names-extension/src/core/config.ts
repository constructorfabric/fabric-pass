/**
 * Build-time configuration for Fabric Pass.
 *
 * The ONLY module that reads `import.meta.env` — everything else imports the
 * constants below. WXT inlines `import.meta.env.WXT_*` at build time (values come
 * from `.env`/the environment, prefixed `WXT_`), so these can't change at runtime;
 * that's exactly the point — the origin and cache lifetimes are fixed per build, not
 * per user.
 *
 * Every raw env value is run through one of the two pure helpers below, which fall
 * back to a sane default for anything malformed. A build with no `.env` at all — and
 * therefore no `WXT_*` variables — must still produce a working extension.
 */

/**
 * Parses a positive, finite number from a raw env string. Anything that isn't one —
 * undefined/empty, non-numeric, NaN, Infinity, zero or negative — falls back to
 * `fallback` rather than producing a broken duration or batch size.
 */
export function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  const trimmed = raw?.trim()
  if (!trimmed) return fallback

  const value = Number(trimmed)
  if (!Number.isFinite(value) || value <= 0) return fallback

  return value
}

/**
 * Parses a URL origin from a raw env string, normalizing away any path/trailing
 * slash (`new URL(raw).origin`). Anything `new URL()` rejects, or an empty value,
 * falls back to `fallback`.
 */
export function parseOrigin(raw: string | undefined, fallback: string): string {
  const trimmed = raw?.trim()
  if (!trimmed) return fallback

  try {
    return new URL(trimmed).origin
  } catch {
    return fallback
  }
}

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

export const PASS_ORIGIN = parseOrigin(import.meta.env.WXT_PASS_ORIGIN, 'https://pass.cfabric.org')

export const PASS_MAX_CACHE_AGE_MS = parsePositiveNumber(import.meta.env.WXT_PASS_MAX_CACHE_AGE_DAYS, 3) * DAY_MS

export const PASS_ENTRY_TTL_MS = parsePositiveNumber(import.meta.env.WXT_PASS_ENTRY_TTL_HOURS, 24) * HOUR_MS

export const PASS_MISS_TTL_MS = parsePositiveNumber(import.meta.env.WXT_PASS_MISS_TTL_HOURS, 24) * HOUR_MS

/** Matches the pass endpoint's own limit on the `logins` query parameter. */
export const PASS_BATCH_SIZE = 100

/** Caps how many batches a single `resolveLogins` call sends — the rest waits for the next call. */
export const PASS_MAX_BATCHES_PER_REQUEST = 3

/** Minimum spacing between network attempts, so a burst of lookups doesn't turn into a burst of requests. */
export const PASS_MIN_NETWORK_INTERVAL_MS = 1000
