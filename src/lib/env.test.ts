import { expect, test } from 'vitest'
import { envSchema } from './env.ts'

// A minimal object satisfying every required field, so each test below only
// has to vary the LinkedIn pair or ROOT_GITHUB_ID it's actually checking.
const baseEnv = {
  DATABASE_URL: 'postgresql://localhost:5432/test',
  SESSION_PASSWORD: 'test-password-at-least-32-characters-long',
  APP_URL: 'http://localhost:3000',
  GITHUB_CLIENT_ID: 'github-id',
  GITHUB_CLIENT_SECRET: 'github-secret',
  DISCORD_CLIENT_ID: 'discord-id',
  DISCORD_CLIENT_SECRET: 'discord-secret',
  TELEGRAM_CLIENT_ID: 'telegram-id',
  TELEGRAM_CLIENT_SECRET: 'telegram-secret',
  CONTRIBUTORS_EXPORT_SECRET: 'export-secret',
  CONTRIBUTORS_SYNC_SECRET: 'sync-secret',
  TRACKS_SYNC_SECRET: 'tracks-sync-secret',
  ARTIFACT_LINKS_SYNC_SECRET: 'artifact-links-sync-secret',
  TRACK_PAGE_TEMPLATE_SYNC_SECRET: 'track-page-template-sync-secret',
  CONFIG_SYNC_SECRET: 'config-sync-secret',
  TRACK_MEMBERS_EXPORT_SECRET: 'track-members-export-secret',
}

test('parses with both LinkedIn credentials unset', () => {
  expect(() => envSchema.parse(baseEnv)).not.toThrow()
})

test('parses with both LinkedIn credentials set', () => {
  expect(() =>
    envSchema.parse({ ...baseEnv, LINKEDIN_CLIENT_ID: 'linkedin-id', LINKEDIN_CLIENT_SECRET: 'linkedin-secret' }),
  ).not.toThrow()
})

test('rejects LINKEDIN_CLIENT_ID set without LINKEDIN_CLIENT_SECRET', () => {
  expect(() => envSchema.parse({ ...baseEnv, LINKEDIN_CLIENT_ID: 'linkedin-id' })).toThrow()
})

test('rejects LINKEDIN_CLIENT_SECRET set without LINKEDIN_CLIENT_ID', () => {
  expect(() => envSchema.parse({ ...baseEnv, LINKEDIN_CLIENT_SECRET: 'linkedin-secret' })).toThrow()
})

test('parses with ROOT_GITHUB_ID unset', () => {
  expect(() => envSchema.parse(baseEnv)).not.toThrow()
})

test('parses with a numeric ROOT_GITHUB_ID', () => {
  expect(() => envSchema.parse({ ...baseEnv, ROOT_GITHUB_ID: '12345' })).not.toThrow()
})

test('rejects a non-numeric ROOT_GITHUB_ID', () => {
  expect(() => envSchema.parse({ ...baseEnv, ROOT_GITHUB_ID: 'not-a-number' })).toThrow()
})

test('treats a blank ROOT_GITHUB_ID as unset', () => {
  const result = envSchema.parse({ ...baseEnv, ROOT_GITHUB_ID: '' })
  expect(result.ROOT_GITHUB_ID).toBeUndefined()
})

test('parses with both DO credentials unset', () => {
  expect(() => envSchema.parse(baseEnv)).not.toThrow()
})

test('parses with both DO credentials set', () => {
  expect(() => envSchema.parse({ ...baseEnv, DO_API_TOKEN: 'do-token', DO_DROPLET_ID: '12345' })).not.toThrow()
})

test('rejects DO_API_TOKEN set without DO_DROPLET_ID', () => {
  expect(() => envSchema.parse({ ...baseEnv, DO_API_TOKEN: 'do-token' })).toThrow()
})

test('rejects DO_DROPLET_ID set without DO_API_TOKEN', () => {
  expect(() => envSchema.parse({ ...baseEnv, DO_DROPLET_ID: '12345' })).toThrow()
})

test('rejects a missing CONFIG_SYNC_SECRET', () => {
  const { CONFIG_SYNC_SECRET: _unused, ...withoutConfigSecret } = baseEnv
  expect(() => envSchema.parse(withoutConfigSecret)).toThrow()
})

test('rejects a missing TRACK_MEMBERS_EXPORT_SECRET', () => {
  const { TRACK_MEMBERS_EXPORT_SECRET: _unused, ...withoutSecret } = baseEnv
  expect(() => envSchema.parse(withoutSecret)).toThrow()
})

// Unlike the DO_* pair above, GitHub org invites and Discord role grants
// are independent capabilities — either can be configured without the
// other, so there's no pairing constraint to enforce.
test('parses with GITHUB_ORG_TOKEN set and DISCORD_BOT_TOKEN unset', () => {
  expect(() => envSchema.parse({ ...baseEnv, GITHUB_ORG_TOKEN: 'github-org-token' })).not.toThrow()
})

test('parses with DISCORD_BOT_TOKEN set and GITHUB_ORG_TOKEN unset', () => {
  expect(() => envSchema.parse({ ...baseEnv, DISCORD_BOT_TOKEN: 'discord-bot-token' })).not.toThrow()
})

test('parses with both GITHUB_ORG_TOKEN and DISCORD_BOT_TOKEN unset', () => {
  expect(() => envSchema.parse(baseEnv)).not.toThrow()
})
