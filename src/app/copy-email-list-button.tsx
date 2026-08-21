'use client'

import { Button } from '@gears-frontx/ui-kit'
import { useEffect, useState } from 'react'
import { CheckMark, CopyMark } from './marks'

/**
 * IDEA-066 — same copy-to-clipboard mechanics as CopyButton
 * (public-profile-view.tsx's per-row copy action), but a labeled action
 * rather than an icon-only row control: this is a page-level export (an
 * Admin or Track Admin building a mailing list to paste into Outlook/etc.),
 * so the button names what it does instead of relying on a hover title.
 * `;`-joined, matching what a mail client's To/Bcc field expects when
 * pasted directly. Renders nothing when there's no one to list — an empty
 * button with nothing to copy would just be confusing.
 */
export function CopyEmailListButton({ emails }: { emails: string[] }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  if (emails.length === 0) return null

  return (
    <Button
      variant="outline"
      size="sm"
      icon={copied ? <CheckMark /> : <CopyMark />}
      onClick={async () => {
        // See CopyButton's own doc comment — writeText can genuinely reject
        // (a strict clipboard permissions policy), not just in a test
        // environment; logged rather than silently swallowed so a failure
        // doesn't read as a successful copy that just happened not to show
        // the "Copied!" confirmation.
        try {
          await navigator.clipboard.writeText(emails.join('; '))
          setCopied(true)
        } catch (error) {
          console.error('CopyEmailListButton failed:', error)
        }
      }}
    >
      {copied ? 'Copied!' : `Copy email list (${emails.length})`}
    </Button>
  )
}
