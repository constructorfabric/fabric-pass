import { afterAll, beforeEach, expect, test } from 'vitest'
import { getAppConfig, syncAppConfig } from './app-config.ts'
import { pool } from './db.ts'

beforeEach(async () => {
  await pool.query('TRUNCATE app_config')
})

afterAll(async () => {
  await pool.end()
})

test('getAppConfig returns null before the first sync', async () => {
  expect(await getAppConfig()).toBeNull()
})

test('syncAppConfig then getAppConfig round-trips every field', async () => {
  await syncAppConfig({
    githubOrganization: 'constructorfabric',
    githubContributorsTeam: 'contributors',
    githubTrackTeamPattern: '{track}-contributors',
    githubTrackMaintainerTeamPattern: '{track}-maintainers',
    githubTrackInternalReaderTeamPattern: '{track}-internal-readers',
    discordGuildId: '123456789012345678',
    discordInviteUrl: 'https://discord.gg/example',
    preferredTrackOrder: ['Studio', 'Insight'],
  })

  expect(await getAppConfig()).toEqual({
    githubOrganization: 'constructorfabric',
    githubContributorsTeam: 'contributors',
    githubTrackTeamPattern: '{track}-contributors',
    githubTrackMaintainerTeamPattern: '{track}-maintainers',
    githubTrackInternalReaderTeamPattern: '{track}-internal-readers',
    discordGuildId: '123456789012345678',
    discordInviteUrl: 'https://discord.gg/example',
    preferredTrackOrder: ['Studio', 'Insight'],
  })
})

test('preferredTrackOrder round-trips as a native array', async () => {
  await syncAppConfig({ preferredTrackOrder: ['Studio', 'Insight', 'Gears Rust'] })

  expect((await getAppConfig())?.preferredTrackOrder).toEqual(['Studio', 'Insight', 'Gears Rust'])
})

test('re-syncing replaces the singleton row rather than adding a second one', async () => {
  await syncAppConfig({ githubOrganization: 'constructorfabric' })
  await syncAppConfig({ githubOrganization: 'renamed-org' })

  expect(await getAppConfig()).toEqual({
    githubOrganization: 'renamed-org',
    discordGuildId: undefined,
    discordInviteUrl: undefined,
  })

  const { rows } = await pool.query('SELECT count(*) FROM app_config')
  expect(rows[0].count).toBe('1')
})

test('syncing with a field omitted clears it, not leaves the previous value', async () => {
  await syncAppConfig({ githubOrganization: 'constructorfabric', discordGuildId: '123', preferredTrackOrder: ['Studio'] })
  await syncAppConfig({ githubOrganization: 'constructorfabric' })

  const config = await getAppConfig()
  expect(config?.discordGuildId).toBeUndefined()
  expect(config?.preferredTrackOrder).toBeUndefined()
})
