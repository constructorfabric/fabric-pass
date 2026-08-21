import { expect, test } from 'vitest'
import { parseConfigYaml } from './app-config-registry.ts'

test('parses a full config.yaml', () => {
  const config = parseConfigYaml(`
github_organization: constructorfabric
github_contributors_team: contributors
github_track_team_pattern: "{track}-contributors"
github_track_maintainer_team_pattern: "{track}-maintainers"
discord_guild_id: "123456789012345678"
discord_invite_url: https://discord.gg/example
`)
  expect(config).toEqual({
    githubOrganization: 'constructorfabric',
    githubContributorsTeam: 'contributors',
    githubTrackTeamPattern: '{track}-contributors',
    githubTrackMaintainerTeamPattern: '{track}-maintainers',
    discordGuildId: '123456789012345678',
    discordInviteUrl: 'https://discord.gg/example',
  })
})

test('every field is independently optional', () => {
  expect(parseConfigYaml('github_organization: constructorfabric')).toEqual({
    githubOrganization: 'constructorfabric',
    discordGuildId: undefined,
    discordInviteUrl: undefined,
  })
})

test('parses an empty file as an entirely empty config', () => {
  expect(parseConfigYaml('')).toEqual({
    githubOrganization: undefined,
    discordGuildId: undefined,
    discordInviteUrl: undefined,
  })
})

test('throws on a malformed value rather than silently dropping it', () => {
  expect(() => parseConfigYaml('github_organization: 5')).toThrow()
})
