import { getApiKey } from '@/lib/api-keys'
import { findByGithubId } from '@/lib/contributors'
import { getSession } from '@/lib/session'
import { HOME_BREADCRUMB } from '@/app/breadcrumb'
import { PageHeader } from '@/app/page-header'
import { SignInPrompt } from '@/app/sign-in-prompt'
import { ApiKeyView } from './api-key-view'

/**
 * IDEA-119 — a contributor's own personal API key for `pass.cfabric.org/api`
 * (IDEA-120), reachable from the account menu. Read-only server-rendered
 * shell: the masked key (or "none yet") comes straight from the DB, the
 * same way every other page here renders its own data — the one-time full
 * reveal after Generate/Regenerate lives entirely in ApiKeyView's client
 * state, never in anything this page fetches or re-fetches.
 */
export default async function ApiKeyPage() {
  const session = await getSession()
  if (!session.github) return <SignInPrompt />

  const contributor = await findByGithubId(session.github.id)
  if (!contributor) return <SignInPrompt />

  const apiKey = await getApiKey(contributor.githubId)

  return (
    <>
      <PageHeader title="API Key" breadcrumb={[HOME_BREADCRUMB]} />
      <p className="subtitle">
        A personal API key authenticates requests to pass.cfabric.org/api on your behalf. Keep it secret — anyone
        with it can act as you within its access.
      </p>
      <ApiKeyView
        initialApiKey={apiKey ? { maskedKey: apiKey.maskedKey, createdAt: apiKey.createdAt.toISOString() } : null}
      />
    </>
  )
}
