import { beforeEach, expect, test, vi } from 'vitest'

// Covers the callback route's handling of what `linkProvider` (lib/contributors)
// can do once a provider's identity has been exchanged: a generic failure, a
// stale/deleted contributor row, and — the one success path with no
// route-level coverage before this file — a completed Telegram link. (An
// already-linked provider account no longer errors at all — see
// lib/contributors.ts's linkProvider and contributors.test.ts — so there's
// nothing left for the route layer to handle for that case.) Session,
// providers, and the contributors module are replaced with in-memory
// doubles, the same seam tests/auth-oauth-concurrent-transactions.test.ts
// and tests/auth-callback-github-guard.test.ts use.
const { fakeSession, discordCallbackResult, telegramCallbackResult, contributorsState } = vi.hoisted(() => ({
  fakeSession: {
    oauth: undefined as
      | Partial<
          Record<
            'github' | 'discord' | 'telegram',
            { codeVerifier: string; state: string; variant?: 'phone'; githubId?: string }
          >
        >
      | undefined,
    github: undefined as { id: string; login: string } | undefined,
    save: async () => {},
  },
  discordCallbackResult: { current: { providerId: 'discord-id-1', username: 'discordfan' } },
  telegramCallbackResult: { current: { providerId: 'tg-id-1', username: 'ada_tg' } as {
    providerId: string
    username?: string
    phone?: string
  } },
  contributorsState: {
    linkCalls: [] as { githubId: string; provider: string; identity: unknown }[],
    linkShouldThrow: undefined as 'generic' | 'not-found' | undefined,
  },
}))

vi.mock('@/lib/session', () => ({
  getSession: async () => fakeSession,
}))

vi.mock('@/lib/contributors', async () => {
  const actual = await vi.importActual<typeof import('@/lib/contributors')>('@/lib/contributors')
  return {
    ...actual,
    linkProvider: async (githubId: string, provider: string, identity: unknown) => {
      if (contributorsState.linkShouldThrow === 'generic') {
        throw new Error('connection refused')
      }
      if (contributorsState.linkShouldThrow === 'not-found') {
        throw new actual.ContributorNotFoundError(githubId)
      }
      contributorsState.linkCalls.push({ githubId, provider, identity })
    },
  }
})

vi.mock('@/lib/providers', () => ({
  isProviderName: (value: string) => value === 'github' || value === 'discord' || value === 'telegram',
  providers: {
    github: {
      name: 'github',
      authRequest: async () => {
        throw new Error('not used in this test')
      },
      callback: async () => {
        throw new Error('not used in this test')
      },
    },
    discord: {
      name: 'discord',
      authRequest: async () => {
        throw new Error('not used in this test')
      },
      callback: async () => discordCallbackResult.current,
    },
    telegram: {
      name: 'telegram',
      authRequest: async () => {
        throw new Error('not used in this test')
      },
      callback: async () => telegramCallbackResult.current,
    },
  },
}))

const { GET } = await import('@/app/auth/[provider]/callback/route')

beforeEach(() => {
  fakeSession.github = { id: '1001', login: 'octocat' }
  // Both transactions are bound to the signed-in identity above, per
  // session.ts's OAuthTransaction — otherwise the identity-binding guard
  // (tests/auth-oauth-concurrent-transactions.test.ts) would refuse these
  // before ever reaching linkProvider.
  fakeSession.oauth = {
    discord: { codeVerifier: 'discord-verifier', state: 'discord-state', githubId: '1001' },
    telegram: { codeVerifier: 'telegram-verifier', state: 'telegram-state', githubId: '1001' },
  }
  discordCallbackResult.current = { providerId: 'discord-id-1', username: 'discordfan' }
  telegramCallbackResult.current = { providerId: 'tg-id-1', username: 'ada_tg' }
  contributorsState.linkCalls = []
  contributorsState.linkShouldThrow = undefined
})

test('a discord callback that fails generically is refused with the link-failed notice', async () => {
  contributorsState.linkShouldThrow = 'generic'
  const request = new Request('http://localhost:3000/auth/discord/callback?code=abc&state=discord-state')

  const response = await GET(request, { params: Promise.resolve({ provider: 'discord' }) })

  const location = response.headers.get('location')
  expect(location).toBe('http://localhost:3000/profile?notice=link-failed&provider=discord')
})

// resolveTelegramOutcome itself is unit-tested (tests/auth-routes.test.ts),
// but nothing before this drove a successful Telegram link through the
// route end to end.
test('a successful telegram callback links the account and redirects to Profile with no notice', async () => {
  const request = new Request('http://localhost:3000/auth/telegram/callback?code=abc&state=telegram-state')

  const response = await GET(request, { params: Promise.resolve({ provider: 'telegram' }) })

  expect(response.headers.get('location')).toBe('http://localhost:3000/profile')
  expect(contributorsState.linkCalls).toEqual([
    { githubId: '1001', provider: 'telegram', identity: { providerId: 'tg-id-1', username: 'ada_tg' } },
  ])
})

// The session cookie names a github id whose row is gone — a stale
// session, not a transient failure — so this must read as "sign in again",
// not the generic link-failed message a real outage gets.
test('a discord callback whose contributor row is gone is refused with the reauth-required notice, not link-failed', async () => {
  contributorsState.linkShouldThrow = 'not-found'
  const request = new Request('http://localhost:3000/auth/discord/callback?code=abc&state=discord-state')

  const response = await GET(request, { params: Promise.resolve({ provider: 'discord' }) })

  const location = response.headers.get('location')
  expect(location).toBe('http://localhost:3000/profile?notice=reauth-required')
  expect(location).not.toContain('notice=link-failed')
})
