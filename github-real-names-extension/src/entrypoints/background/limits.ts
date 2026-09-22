/**
 * Shared fetch limits for background's network calls (URL source, T9; the Fabric
 * Pass resolver). Split out from `index.ts` so `pass.ts` can import
 * `FETCH_TIMEOUT_MS` without creating an import cycle (`index.ts` imports `pass.ts`).
 */

/** A sane cap on the URL source response — don't let the internal endpoint send gigabytes. */
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024

/** Timeout for a single request — a hung endpoint shouldn't hang the extension. */
export const FETCH_TIMEOUT_MS = 15000
