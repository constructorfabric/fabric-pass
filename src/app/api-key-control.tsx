'use client'

import { Button } from '@gears-frontx/ui-kit'
import { useState } from 'react'
import { ActionMessage } from '@/app/action-message'
import { CopyButton } from '@/app/copy-button'

export interface StoredApiKey {
  maskedKey: string
  createdAt: string
}

export interface RegenerateResult {
  ok: boolean
  message?: string
  reauthRequired?: boolean
  /** The full key, in the clear — set only on success, read exactly once
   * for the one-time reveal below. */
  key?: string
  maskedKey?: string
  createdAt?: string
}

/** Pinned locale/timezone — this is a 'use client' component, so its first
 * render happens server-side too; an unpinned locale/timezone would render
 * one string on the server and another once the browser hydrates. */
function formatCreatedAt(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * IDEA-119/121 — the Generate/show-once/mask/Regenerate control, shared by
 * a contributor's own personal key (`api-key/api-key-view.tsx`) and, per
 * IDEA-121's own framing ("logic is the same as for personal API keys"),
 * each application's key on the Admin-only Applications screen. `onRegenerate`
 * is the only thing that differs between the two — which key table gets
 * written to — so this component itself has no notion of "personal" vs.
 * "application."
 *
 * Three states: no key yet (Generate), a key exists (masked, with its
 * generation date/time, and Regenerate), and the moment right after a
 * successful Generate/Regenerate (the one-time full-key reveal). The
 * revealed key lives only in `revealed` below — component state, never
 * fetched from or written back to the server — so navigating away and back
 * always lands on the masked state, satisfying "shown once."
 */
export function ApiKeyControl({
  initialKey,
  onRegenerate,
  generateLabel = 'Generate API key',
  noKeyMessage = "You don't have an API key yet.",
}: {
  initialKey: StoredApiKey | null
  onRegenerate: () => Promise<RegenerateResult>
  generateLabel?: string
  noKeyMessage?: string
}) {
  const [current, setCurrent] = useState(initialKey)
  const [revealed, setRevealed] = useState<string>()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string>()
  const [reauthRequired, setReauthRequired] = useState(false)

  async function generate() {
    setPending(true)
    setMessage(undefined)
    setReauthRequired(false)
    try {
      const result = await onRegenerate()

      if (!result.ok || !result.key || !result.maskedKey || !result.createdAt) {
        setMessage(result.message ?? 'Could not generate a key right now. Please try again in a moment.')
        setReauthRequired(Boolean(result.reauthRequired))
        return
      }

      setRevealed(result.key)
      setCurrent({ maskedKey: result.maskedKey, createdAt: result.createdAt })
    } catch (error) {
      // onRegenerate's own action itself never throws — this only catches a
      // failure in reaching it at all (e.g. a dropped connection) — same
      // "pending must never get stuck true" guarantee the finally below
      // gives regardless of which of the two failure shapes actually hit.
      console.error('ApiKeyControl regenerate failed:', error)
      setMessage('Could not generate a key right now. Please try again in a moment.')
    } finally {
      setPending(false)
    }
  }

  if (revealed) {
    return (
      <>
        <p className="subtitle">
          Copy the key now — this is the only time it's shown in full. After this, only a masked version is ever
          displayed again.
        </p>
        <div className="api-key-reveal">
          <code>{revealed}</code>
          <CopyButton value={revealed} label="Copy API key" />
        </div>
      </>
    )
  }

  return (
    <>
      {current ? (
        <>
          <div className="api-key-reveal">
            <code>{current.maskedKey}</code>
          </div>
          <p className="subtitle">Generated {formatCreatedAt(current.createdAt)}</p>
          <Button variant="outline" onClick={generate} loading={pending}>
            Regenerate
          </Button>
        </>
      ) : (
        <>
          <p className="subtitle">{noKeyMessage}</p>
          <Button onClick={generate} loading={pending}>
            {generateLabel}
          </Button>
        </>
      )}
      <ActionMessage message={message} reauthRequired={reauthRequired} />
    </>
  )
}
