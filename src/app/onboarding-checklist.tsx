'use client'

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@gears-frontx/ui-kit'
import Link from 'next/link'
import { useState } from 'react'
import { hideChecklistItemAction } from './actions'
import type { ChecklistItem } from '@/lib/contributors'

export type ChecklistItemState = 'todo' | 'done' | 'hidden'

export interface ChecklistItemData {
  item: ChecklistItem
  label: string
  href: string
  state: ChecklistItemState
  /** Track's "pending approval" nuance — not a fourth state, just extra
   * text shown alongside `todo`. */
  note?: string
}

interface Props {
  items: ChecklistItemData[]
}

/**
 * IDEA-015/IDEA-047 — three independently todo/done/hidden steps tying
 * together completing the profile, reading the community policies, and
 * requesting to join a track. `page.tsx` derives each item's initial state
 * from the actual domain signal it stands for (profileCompleteness,
 * policyLinkClickedAt, track membership) — this component only renders
 * that state and handles hiding.
 *
 * Hiding updates local state immediately rather than waiting on a page
 * reload — the server action already persisted the same change, so a
 * later reload can't disagree with what's shown here. Once every item is
 * hidden, the whole panel (heading included) stops rendering.
 */
export function OnboardingChecklist({ items: initialItems }: Props) {
  const [items, setItems] = useState(initialItems)
  const [pendingItem, setPendingItem] = useState<ChecklistItem>()

  if (items.every((item) => item.state === 'hidden')) return null

  async function hide(item: ChecklistItem) {
    setPendingItem(item)
    const result = await hideChecklistItemAction(item)
    setPendingItem(undefined)
    if (!result.ok) return
    setItems((current) => current.map((i) => (i.item === item ? { ...i, state: 'hidden' } : i)))
  }

  return (
    <Card size="sm" className="onboarding-checklist">
      <CardHeader>
        {/* CardTitle renders a plain div (see the kit's card doc) — the h3
            keeps this panel in the page's document outline, styled by the
            CardTitle it sits in. */}
        <CardTitle>
          <h3 className="card-heading">Getting started</h3>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="onboarding-steps">
          {items
            .filter((i) => i.state !== 'hidden')
            .map((i) => (
              <li key={i.item} className={i.state === 'done' ? 'onboarding-step-done' : undefined}>
                <Link href={i.href}>{i.label}</Link>
                {i.state === 'done' ? (
                  <Badge variant="success" shape="plain">
                    Done
                  </Badge>
                ) : null}
                {i.note ? (
                  <Badge variant="warning" shape="plain">
                    {i.note}
                  </Badge>
                ) : null}
                {i.state === 'done' ? (
                  <Button
                    variant="link"
                    size="sm"
                    className="onboarding-step-hide"
                    disabled={pendingItem === i.item}
                    onClick={() => hide(i.item)}
                  >
                    Hide
                  </Button>
                ) : null}
              </li>
            ))}
        </ul>
      </CardContent>
    </Card>
  )
}
