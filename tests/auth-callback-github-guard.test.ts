import { beforeEach, expect, test, vi } from 'vitest'

// The callback route is a Next.js GET handler: it reads cookies via
// getSession(), calls out to a real provider over the network via
// providers[name].callback(), and now also writes straight to Postgres via
// @/lib/contributors — the piece that makes sign-in create a row the same
// instant it sets the session. All three are replaced with in-memory
// doubles, the seam that makes these guards testable without a live request,
// a live GitHub call, or a live database.
const { fakeSession, githubCallbackResult, discordCallbackResult, contributorsState } = vi.hoisted(() => ({
  fakeSession: {
    oauth: undefined as
      | Partial<
          Record<'github' | 'discord' | 'telegram', { codeVerifier: string; state: string; variant?: 'phone' }>
        >
      | undefined,
    github: undefined as { id: string; login: string } | undefined,
    save: async () => {},
  },
  // Mutable so individual tests can make the mocked github callback return a
  // full identity (for the row-creation tests) instead of the no-username
  // shape the guard test needs — set back to the default in beforeEach.
  githubCallbackResult: { current: { providerId: '583231' } as { providerId: string; username?: string } },
  discordCallbackResult: { current: { providerId: 'discord-id-1', username: 'discordfan' } },
  contributorsState: {
    ensureCalls: [] as { githubId: string; githubLogin: string }[],
    ensureShouldThrow: false,
    // Overrides the name/email the mocked ensureContributor returns, so a
    // test can drive the redirect decision (Main vs. Profile-in-edit-mode)
    // without a real database row.
    ensureResult: {} as { name?: string; email?: string },
  },
}))

vi.mock('@/lib/session', () => ({
  getSession: async () => fakeSession,
}))

vi.mock('@/lib/contributors', async () => {
  const actual = await vi.importActual<typeof import('@/lib/contributors')>('@/lib/contributors')
  return {
    ...actual,
    ensureContributor: async (githubId: string, githubLogin: string) => {
      if (contributorsState.ensureShouldThrow) throw new Error('connection refused')
      contributorsState.ensureCalls.push({ githubId, githubLogin })
      return {
        id: '1',
        githubId,
        githubLogin,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...contributorsState.ensureResult,
      }
    },
    linkProvider: async () => {
      throw new Error('not used in this test — no test here exercises a completed link')
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
      callback: async () => githubCallbackResult.current,
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
      callback: async () => {
        throw new Error('not used in this test')
      },
    },
  },
}))

const { GET } = await import('@/app/auth/[provider]/callback/route')

beforeEach(() => {
  fakeSession.oauth = { github: { codeVerifier: 'verifier', state: 'state-123' } }
  fakeSession.github = undefined
  // No username — the exact shape the "no username" guard test needs. The
  // row-creation tests below override this to a full identity.
  githubCallbackResult.current = { providerId: '583231' }
  discordCallbackResult.current = { providerId: 'discord-id-1', username: 'discordfan' }
  contributorsState.ensureCalls = []
  contributorsState.ensureShouldThrow = false
  contributorsState.ensureResult = {}
})

test('a github identity with no username is refused, not written to the session, and no row is created', async () => {
  const request = new Request('http://localhost:3000/auth/github/callback?code=abc&state=state-123')
  const context = { params: Promise.resolve({ provider: 'github' }) }

  const response = await GET(request, context)

  // The invariant the assertion relied on can't be seen by the guard's
  // caller, so a missing username must be refused the same way every other
  // provider failure already is — not written into a `string`-typed field,
  // and surfaced as the same one-shot notice a provider callback error gets.
  expect(fakeSession.github).toBeUndefined()
  expect(contributorsState.ensureCalls).toEqual([])
  const location = response.headers.get('location')
  expect(location).toContain('notice=link-failed')
  expect(location).toContain('provider=github')
})

// The transaction guard is the CSRF/replay boundary for the whole callback:
// no session.oauth (a stale tab, a replay) and a transaction that names a
// different provider (an attacker or a mixed-up multi-tab flow) must both be
// refused before the callback ever calls out to the provider or touches
// session.github or the contributor row.

test('a callback with no stored transaction at all is refused as expired', async () => {
  fakeSession.oauth = undefined
  const request = new Request('http://localhost:3000/auth/github/callback?code=abc&state=state-123')
  const context = { params: Promise.resolve({ provider: 'github' }) }

  const response = await GET(request, context)

  expect(fakeSession.oauth).toBeUndefined()
  expect(fakeSession.github).toBeUndefined()
  expect(contributorsState.ensureCalls).toEqual([])
  const location = response.headers.get('location')
  expect(location).toContain('notice=expired')
})

test('a callback for a provider with no transaction of its own is refused as expired, even while another provider has one in flight', async () => {
  // The URL asks to complete a github callback, but only a discord
  // authorization is stored — each provider's transaction is keyed
  // separately, so github's own slot is simply absent here.
  fakeSession.oauth = { discord: { codeVerifier: 'verifier', state: 'state-123' } }
  const request = new Request('http://localhost:3000/auth/github/callback?code=abc&state=state-123')
  const context = { params: Promise.resolve({ provider: 'github' }) }

  const response = await GET(request, context)

  // The in-flight discord transaction must survive an unrelated, refused
  // github callback — refusing one provider must not clear another's slot.
  expect(fakeSession.oauth).toEqual({ discord: { codeVerifier: 'verifier', state: 'state-123' } })
  expect(fakeSession.github).toBeUndefined()
  const location = response.headers.get('location')
  expect(location).toContain('notice=expired')
})

// Autosave begins at GitHub sign-in: the row must exist from that instant,
// not from a later save.

test('a successful github sign-in creates the contributor row the same instant it sets the session', async () => {
  githubCallbackResult.current = { providerId: '583231', username: 'octocat' }
  const request = new Request('http://localhost:3000/auth/github/callback?code=abc&state=state-123')
  const context = { params: Promise.resolve({ provider: 'github' }) }

  await GET(request, context)

  expect(fakeSession.github).toEqual({ id: '583231', login: 'octocat' })
  expect(contributorsState.ensureCalls).toEqual([{ githubId: '583231', githubLogin: 'octocat' }])
})

// IDEA-001: sign-in lands on Main if the profile is already complete
// (Name and Email both filled in), otherwise on Profile — which opens
// straight into edit mode on its own (see profile/page.tsx), keyed off the
// same isProfileComplete check.

test('a successful github sign-in with a complete profile redirects to Main', async () => {
  githubCallbackResult.current = { providerId: '583231', username: 'octocat' }
  contributorsState.ensureResult = { name: 'Ada Lovelace', email: 'ada@example.com' }
  const request = new Request('http://localhost:3000/auth/github/callback?code=abc&state=state-123')
  const context = { params: Promise.resolve({ provider: 'github' }) }

  const response = await GET(request, context)

  expect(response.headers.get('location')).toBe('http://localhost:3000/')
})

test('a successful github sign-in with an incomplete profile redirects to Profile', async () => {
  githubCallbackResult.current = { providerId: '583231', username: 'octocat' }
  contributorsState.ensureResult = { name: 'Ada Lovelace', email: undefined }
  const request = new Request('http://localhost:3000/auth/github/callback?code=abc&state=state-123')
  const context = { params: Promise.resolve({ provider: 'github' }) }

  const response = await GET(request, context)

  expect(response.headers.get('location')).toBe('http://localhost:3000/profile')
})

test('a failure creating the row is refused the same way a provider error is, and the session is left signed out', async () => {
  githubCallbackResult.current = { providerId: '583231', username: 'octocat' }
  contributorsState.ensureShouldThrow = true
  const request = new Request('http://localhost:3000/auth/github/callback?code=abc&state=state-123')
  const context = { params: Promise.resolve({ provider: 'github' }) }

  const response = await GET(request, context)

  expect(fakeSession.github).toBeUndefined()
  const location = response.headers.get('location')
  expect(location).toContain('notice=link-failed')
  expect(location).toContain('provider=github')
})

// Telegram and Discord links are only reachable from the signed-in state —
// the page offers their buttons only once session.github is set — so a
// callback that arrives with no github identity in the session has nothing
// to link to. This must be refused before linkProvider is ever called,
// rather than writing to some row guessed at another way.

test('a discord callback with no signed-in github identity is refused as expired rather than attempting to link', async () => {
  fakeSession.oauth = { discord: { codeVerifier: 'verifier', state: 'state-123' } }
  fakeSession.github = undefined
  const request = new Request('http://localhost:3000/auth/discord/callback?code=abc&state=state-123')
  const context = { params: Promise.resolve({ provider: 'discord' }) }

  const response = await GET(request, context)

  const location = response.headers.get('location')
  // Discord's notice target is Profile, not Main — unlike a github callback,
  // whose expired/failed notices still land at '/' (see the other guard
  // tests above).
  expect(location).toBe('http://localhost:3000/profile?notice=expired')
})
