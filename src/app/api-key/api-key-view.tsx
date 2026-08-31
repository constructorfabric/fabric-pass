'use client'

import { Button, Card, CardContent } from '@gears-frontx/ui-kit'
import { useState } from 'react'
import { ActionMessage } from '@/app/action-message'
import { CopyButton } from '@/app/copy-button'
import { regenerateApiKeyAction } from './actions'

interface StoredApiKey {
  maskedKey: string
  createdAt: string
}

/** Pinned locale/timezone, same reasoning as track-membership-review.tsx's
 * own grant-date formatting — this is a 'use client' component, so its
 * first render happens server-side too; an unpinned locale/timezone would
 * render one string on the server and another once the browser hydrates. */
function formatCreatedAt(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * IDEA-119 — three states: no key yet (Generate), a key exists (masked,
 * with its generation date/time, and Regenerate), and the moment right
 * after a successful Generate/Regenerate (the one-time full-key reveal).
 * The revealed key lives only in `revealed` below — component state, never
 * fetched from or written back to the server — so navigating away and
 * back always lands on the masked state, satisfying "shown once."
 */
export function ApiKeyView({ initialApiKey }: { initialApiKey: StoredApiKey | null }) {
  const [current, setCurrent] = useState(initialApiKey)
  const [revealed, setRevealed] = useState<string>()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string>()
  const [reauthRequired, setReauthRequired] = useState(false)

  async function generate() {
    setPending(true)
    setMessage(undefined)
    setReauthRequired(false)
    try {
      const result = await regenerateApiKeyAction()

      if (!result.ok || !result.key || !result.maskedKey || !result.createdAt) {
        setMessage(result.message ?? 'Could not generate a key right now. Please try again in a moment.')
        setReauthRequired(Boolean(result.reauthRequired))
        return
      }

      setRevealed(result.key)
      setCurrent({ maskedKey: result.maskedKey, createdAt: result.createdAt })
    } catch (error) {
      // regenerateApiKeyAction itself never throws — this only catches a
      // failure in reaching it at all (e.g. a dropped connection) — same
      // "pending must never get stuck true" guarantee the finally below
      // gives regardless of which of the two failure shapes actually hit.
      console.error('regenerateApiKeyAction call failed:', error)
      setMessage('Could not generate a key right now. Please try again in a moment.')
    } finally {
      setPending(false)
    }
  }

  if (revealed) {
    return (
      <Card>
        <CardContent>
          <p className="subtitle">
            Copy your key now — this is the only time it's shown in full. After you leave this page, only a masked
            version is ever displayed again.
          </p>
          <div className="api-key-reveal">
            <code>{revealed}</code>
            <CopyButton value={revealed} label="Copy API key" />
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent>
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
            <p className="subtitle">You don't have an API key yet.</p>
            <Button onClick={generate} loading={pending}>
              Generate API key
            </Button>
          </>
        )}
        <ActionMessage message={message} reauthRequired={reauthRequired} />
      </CardContent>
    </Card>
  )
}
