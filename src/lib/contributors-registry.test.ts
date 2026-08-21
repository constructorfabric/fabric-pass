import { expect, test } from 'vitest'
import { parseRegistryYaml, toRegistryYaml } from './contributors-registry.ts'
import type { Contributor } from './contributors.ts'

function contributor(overrides: Partial<Contributor> = {}): Contributor {
  return {
    id: 'id-1',
    githubId: '1001',
    githubLogin: 'octocat',
    status: 'draft',
    isAgent: false,
    isAdmin: false,
    profileCompleteness: 'incomplete',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  }
}

test('renders a contributor as a registry row, contact fields and admin fields alike', () => {
  const yaml = toRegistryYaml([
    contributor({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      emailConfirmedAt: new Date('2026-02-01T00:00:00.000Z'),
      company: 'Analytical Engines',
      status: 'confirmed',
      aliasOfGithubId: '2002',
      isAgent: true,
      isAdmin: true,
      linkedinId: 'li-555',
      linkedinName: 'Ada Lovelace',
      profileCompleteness: 'complete',
    }),
  ])

  expect(yaml).toContain('id: id-1')
  expect(yaml).toContain('github_id: "1001"')
  expect(yaml).toContain('github_login: octocat')
  expect(yaml).toContain('name: Ada Lovelace')
  expect(yaml).toContain('email: ada@example.com')
  expect(yaml).toContain('email_confirmed_at: 2026-02-01T00:00:00.000Z')
  expect(yaml).toContain('company: Analytical Engines')
  expect(yaml).toContain('status: confirmed')
  expect(yaml).toContain('alias_of_github_id: "2002"')
  expect(yaml).toContain('is_agent: true')
  expect(yaml).toContain('is_admin: true')
  expect(yaml).toContain('profile_completeness: complete')
  expect(yaml).toContain('created_at:')
  expect(yaml).toContain('linkedin_id: li-555')
  expect(yaml).toContain('linkedin_name: Ada Lovelace')
})

// The confirmation token is a bearer credential — the one thing standing
// between "click this link" and confirming someone else's email — and the
// registry file is neither private nor access-controlled the way Postgres
// is. It must never appear in an export, under any field name.
test('never exports the email confirmation token, confirmed or not', () => {
  const yaml = toRegistryYaml([contributor({ email: 'ada@example.com', emailConfirmedAt: new Date('2026-01-01') })])
  expect(yaml.toLowerCase()).not.toContain('token')
})

test('an unset contact field renders as null, not omitted or empty-string', () => {
  const yaml = toRegistryYaml([contributor()])
  expect(yaml).toContain('name: null')
  expect(yaml).toContain('email: null')
  expect(yaml).toContain('alias_of_github_id: null')
  expect(yaml).toContain('is_agent: false')
  expect(yaml).toContain('is_admin: false')
  expect(yaml).toContain('linkedin_id: null')
  expect(yaml).toContain('linkedin_name: null')
})

test('round-trips admin field updates back out of what it just rendered', () => {
  const yaml = toRegistryYaml([
    contributor({ githubId: '1001', status: 'confirmed', isAgent: true, isAdmin: true }),
    contributor({ githubId: '2002', status: 'draft', aliasOfGithubId: '1001' }),
  ])

  const { updates, invalidRowCount } = parseRegistryYaml(yaml)

  expect(invalidRowCount).toBe(0)
  expect(updates).toEqual([
    { githubId: '1001', status: 'confirmed', aliasOfGithubId: null, isAgent: true, isAdmin: true },
    { githubId: '2002', status: 'draft', aliasOfGithubId: '1001', isAgent: false, isAdmin: false },
  ])
})

test('accepts a bare YAML integer github_id, the same as a quoted one', () => {
  const { updates } = parseRegistryYaml('contributors:\n  - github_id: 1001\n    status: confirmed\n')
  expect(updates).toEqual([{ githubId: '1001', status: 'confirmed', aliasOfGithubId: null, isAgent: false, isAdmin: false }])
})

test('a row with no alias_of_github_id, is_agent, or is_admin defaults to not-an-alias, not-an-agent, not-an-admin', () => {
  const { updates } = parseRegistryYaml('contributors:\n  - github_id: "1001"\n    status: draft\n')
  expect(updates).toEqual([{ githubId: '1001', status: 'draft', aliasOfGithubId: null, isAgent: false, isAdmin: false }])
})

test('drops a row with an out-of-set status rather than throwing', () => {
  const { updates, invalidRowCount } = parseRegistryYaml(
    'contributors:\n  - github_id: "1001"\n    status: banned\n  - github_id: "2002"\n    status: confirmed\n',
  )
  expect(invalidRowCount).toBe(1)
  expect(updates).toEqual([{ githubId: '2002', status: 'confirmed', aliasOfGithubId: null, isAgent: false, isAdmin: false }])
})

test('drops a row missing github_id entirely', () => {
  const { updates, invalidRowCount } = parseRegistryYaml('contributors:\n  - status: confirmed\n')
  expect(invalidRowCount).toBe(1)
  expect(updates).toEqual([])
})

test('email_confirmed_at in the file is ignored on import, same as every other non-admin-owned field', () => {
  const { updates } = parseRegistryYaml(
    'contributors:\n  - github_id: "1001"\n    status: draft\n    email_confirmed_at: "2026-01-01T00:00:00.000Z"\n',
  )
  expect(updates).toEqual([{ githubId: '1001', status: 'draft', aliasOfGithubId: null, isAgent: false, isAdmin: false }])
})

test('accepts a `blocked` status — the one value this app itself writes, not the registry file', () => {
  const { updates, invalidRowCount } = parseRegistryYaml('contributors:\n  - github_id: "1001"\n    status: blocked\n')
  expect(invalidRowCount).toBe(0)
  expect(updates).toEqual([{ githubId: '1001', status: 'blocked', aliasOfGithubId: null, isAgent: false, isAdmin: false }])
})

// IDEA-071 — revoke_pending/revoked are valid ContributorStatus values (the
// same file this parser feeds round-trips them back out via toRegistryYaml
// above), but only requestRevoke/approveRevoke's two-Admin-approval gate may
// ever set them — a raw file edit dropping straight into either must not
// bypass that gate, so both are rejected here the same as any other
// out-of-set value.
test('drops rows with revoke_pending or revoked status — only the two-Admin-approval Revoke workflow may set those', () => {
  const { updates, invalidRowCount } = parseRegistryYaml(
    'contributors:\n' +
      '  - github_id: "1001"\n    status: revoke_pending\n' +
      '  - github_id: "2002"\n    status: revoked\n' +
      '  - github_id: "3003"\n    status: confirmed\n',
  )
  expect(invalidRowCount).toBe(2)
  expect(updates).toEqual([{ githubId: '3003', status: 'confirmed', aliasOfGithubId: null, isAgent: false, isAdmin: false }])
})

test('an empty or missing contributors list parses to no updates, not an error', () => {
  expect(parseRegistryYaml('contributors: []\n')).toEqual({ updates: [], invalidRowCount: 0 })
  expect(parseRegistryYaml('{}\n')).toEqual({ updates: [], invalidRowCount: 0 })
})
