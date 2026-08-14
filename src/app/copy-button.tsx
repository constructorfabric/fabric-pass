'use client'

import { useEffect, useState } from 'react'
import { CheckMark, CopyMark } from './marks'

/**
 * The public profile's per-row copy action (public-profile-view.tsx).
 * `navigator.clipboard.writeText` needs a secure context — every real
 * deploy of this app is one (HTTPS in production, localhost in dev), so
 * there's no fallback for an insecure context to fall back from.
 *
 * Tapping performs the copy immediately, same click as a mouse user gets —
 * this is a real action bound to the tap, not a hover-only affordance like
 * hint.tsx's droplet-status/completeness tooltips, so there's no separate
 * "tap to reveal, tap again to act" step to design around here.
 */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  return (
    <button
      type="button"
      className="icon-button-square icon-button-square-sm"
      title={copied ? 'Copied!' : label}
      aria-label={copied ? 'Copied!' : label}
      onClick={async () => {
        // A real, documented failure mode, not a fabricated edge case —
        // writeText rejects with NotAllowedError under a strict enough
        // clipboard permissions policy, not just in an automated browser.
        // Left unhandled, that's a click that silently does nothing; this
        // at least means "no visible confirmation" reads as "it failed,"
        // not "it worked," rather than lying either way.
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
        } catch (error) {
          console.error(`CopyButton(${label}) failed:`, error)
        }
      }}
    >
      {copied ? <CheckMark size={15} /> : <CopyMark size={15} />}
    </button>
  )
}
