'use server'

import { regenerateApiKey } from '@/lib/api-keys'
import { getSession } from '@/lib/session'

export interface RegenerateApiKeyResult {
  ok: boolean
  message?: string
  reauthRequired?: boolean
  /** The full key, in the clear — set only on success, read by the client
   * exactly once for its one-time reveal. Never re-derivable from the
   * `apiKey` field below, or from anything else this app stores. */
  key?: string
  maskedKey?: string
  createdAt?: string
}

/**
 * IDEA-119's Generate/Regenerate — one action for both buttons, since
 * they're the same operation (see api-keys.ts's regenerateApiKey): a
 * contributor either has no key yet or has one already, but either way
 * this call ends with exactly one live key, the previous one (if any)
 * invalidated in the same statement.
 */
export async function regenerateApiKeyAction(): Promise<RegenerateApiKeyResult> {
  const session = await getSession()
  if (!session.github) return { ok: false, message: 'Please sign in with GitHub first.', reauthRequired: true }

  try {
    const { key, apiKey } = await regenerateApiKey(session.github.id)
    return { ok: true, key, maskedKey: apiKey.maskedKey, createdAt: apiKey.createdAt.toISOString() }
  } catch (error) {
    console.error(`regenerateApiKeyAction(${session.github.id}) failed:`, error)
    return { ok: false, message: 'Could not generate a key right now. Please try again in a moment.' }
  }
}
