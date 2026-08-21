import { afterEach, expect, test, vi } from 'vitest'

const { fakeEnv } = vi.hoisted(() => ({ fakeEnv: { DISCORD_BOT_TOKEN: undefined as string | undefined } }))

vi.mock('@/lib/env', () => ({ env: fakeEnv }))

const { grantDiscordRole, revokeDiscordRole } = await import('./discord-role.ts')

afterEach(() => {
  fakeEnv.DISCORD_BOT_TOKEN = undefined
  vi.unstubAllGlobals()
})

test('returns false without throwing when DISCORD_BOT_TOKEN is unset', async () => {
  await expect(grantDiscordRole('user-id', 'guild-id', 'role-id')).resolves.toBe(false)
})

test('calls the guild member role endpoint and returns true on success', async () => {
  fakeEnv.DISCORD_BOT_TOKEN = 'test-bot-token'
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetchMock)

  const result = await grantDiscordRole('user-id', 'guild-id', 'role-id')

  expect(result).toBe(true)
  expect(fetchMock).toHaveBeenCalledWith(
    'https://discord.com/api/v10/guilds/guild-id/members/user-id/roles/role-id',
    expect.objectContaining({
      method: 'PUT',
      headers: { Authorization: 'Bot test-bot-token' },
    }),
  )
})

test('returns false without throwing on a 404 (contributor not a guild member yet)', async () => {
  fakeEnv.DISCORD_BOT_TOKEN = 'test-bot-token'
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('not found', { status: 404 })),
  )

  await expect(grantDiscordRole('user-id', 'guild-id', 'role-id')).resolves.toBe(false)
})

test('returns false without throwing on a network failure', async () => {
  fakeEnv.DISCORD_BOT_TOKEN = 'test-bot-token'
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('network down')
    }),
  )

  await expect(grantDiscordRole('user-id', 'guild-id', 'role-id')).resolves.toBe(false)
})

test('revokeDiscordRole returns false without throwing when DISCORD_BOT_TOKEN is unset', async () => {
  await expect(revokeDiscordRole('user-id', 'guild-id', 'role-id')).resolves.toBe(false)
})

test('revokeDiscordRole calls the guild member role endpoint with DELETE and returns true on success', async () => {
  fakeEnv.DISCORD_BOT_TOKEN = 'test-bot-token'
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetchMock)

  const result = await revokeDiscordRole('user-id', 'guild-id', 'role-id')

  expect(result).toBe(true)
  expect(fetchMock).toHaveBeenCalledWith(
    'https://discord.com/api/v10/guilds/guild-id/members/user-id/roles/role-id',
    expect.objectContaining({
      method: 'DELETE',
      headers: { Authorization: 'Bot test-bot-token' },
    }),
  )
})

// Unlike grantDiscordRole, a 404 here means "already doesn't have the
// role" — already in the desired end state, not a failure.
test('revokeDiscordRole returns true, not false, on a 404 (already doesn\'t have the role)', async () => {
  fakeEnv.DISCORD_BOT_TOKEN = 'test-bot-token'
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('not found', { status: 404 })),
  )

  await expect(revokeDiscordRole('user-id', 'guild-id', 'role-id')).resolves.toBe(true)
})

test('revokeDiscordRole returns false without throwing on a network failure', async () => {
  fakeEnv.DISCORD_BOT_TOKEN = 'test-bot-token'
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('network down')
    }),
  )

  await expect(revokeDiscordRole('user-id', 'guild-id', 'role-id')).resolves.toBe(false)
})
