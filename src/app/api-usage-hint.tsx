import { InfoMark } from '@/app/marks'

/**
 * IDEA-125 — a short, always-visible reminder of how to actually call the
 * API a key on this page authenticates against, shown at the bottom of
 * every screen that displays an API key (`api-key/page.tsx`'s own personal
 * key, `admin/applications`'s per-application keys) — regardless of
 * whether a key has been generated yet, since deciding whether to bother
 * generating one needs this just as much as already having one does.
 * `examplePath` differs per caller, matching what that page's own key can
 * actually call (IDEA-120's `/api/me` for a personal key, IDEA-121's
 * `/api/members` for an application key) — no new API endpoint here.
 */
export function ApiUsageHint({
  origin,
  exampleLabel,
  examplePath,
}: {
  origin: string
  exampleLabel: string
  examplePath: string
}) {
  return (
    <div className="api-usage-hint">
      <InfoMark size={16} />
      <div>
        <p>
          Send requests to <code>{origin}/api</code> with an <code>Authorization: Bearer YOUR_API_KEY</code> header.
        </p>
        <p>
          Example — {exampleLabel}:<br />
          <code className="api-usage-example">
            curl -H &quot;Authorization: Bearer YOUR_API_KEY&quot; {origin}
            {examplePath}
          </code>
        </p>
      </div>
    </div>
  )
}
