'use client'

import { Card, CardContent } from '@gears-frontx/ui-kit'
import { ApiKeyControl, type StoredApiKey } from '@/app/api-key-control'
import { regenerateApiKeyAction } from './actions'

/** IDEA-119 — the contributor's own personal key, using the shared
 * generate/mask/regenerate control (`api-key-control.tsx`). */
export function ApiKeyView({ initialApiKey }: { initialApiKey: StoredApiKey | null }) {
  return (
    <Card>
      <CardContent>
        <ApiKeyControl initialKey={initialApiKey} onRegenerate={regenerateApiKeyAction} />
      </CardContent>
    </Card>
  )
}
