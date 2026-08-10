import { afterAll, beforeEach, expect, test } from 'vitest'
import {
  type AdminFieldsUpdate,
  confirmEmail,
  ContributorNotFoundError,
  CONTRIBUTOR_STATUSES,
  countConfirmedContributors,
  ensureContributor,
  findByGithubId,
  getPublicProfile,
  hideChecklistItem,
  linkProvider,
  listContributorsForRegistry,
  markPolicyLinkClicked,
  resendConfirmationEmail,
  resolveProviderLabels,
  saveField,
  searchContributors,
  setContributorStatus,
  syncContributorAdminFields,
} from './contributors.ts'
import { pool } from './db.ts'
import { isProfileComplete } from './profile-completeness.ts'

/** Confirmation tokens are deliberately not on the `Contributor` type at all
 * (see contributors.ts's module doc) — tests that need one read it straight
 * out of Postgres, the same as the migration tests already do for other
 * columns no public function exposes. */
async function confirmationToken(githubId: string): Promise<string | null> {
  const { rows } = await pool.query<{ email_confirmation_token: string | null }>(
    'SELECT email_confirmation_token FROM contributors WHERE github_id = $1',
    [githubId],
  )
  return rows[0]?.email_confirmation_token ?? null
}

/** `status` is the only field every caller of syncContributorAdminFields
 * actually varies test to test; the other three default the same way an
 * absent registry-file value does (see contributors-registry.ts). */
function adminUpdate(overrides: Partial<AdminFieldsUpdate> & { githubId: string }): AdminFieldsUpdate {
  return { status: 'confirmed', aliasOfGithubId: null, isAgent: false, isAdmin: false, ...overrides }
}

beforeEach(async () => {
  // CASCADE: track_admins/tracks (migrations/010_tracks.sql) FK-reference
  // contributors, so a plain TRUNCATE contributors is refused outright.
  await pool.query('TRUNCATE contributors CASCADE')
})

afterAll(async () => {
  await pool.end()
})

const completeProfile = { name: 'Ada Lovelace', email: 'ada@example.com', company: 'Constructor', discordUsername: 'ada' }

test('a contributor with every mandatory field is complete', () => {
  expect(isProfileComplete(completeProfile)).toBe(true)
})

test('a contributor missing any mandatory field is incomplete', () => {
  expect(isProfileComplete({ ...completeProfile, name: undefined })).toBe(false)
  expect(isProfileComplete({ ...completeProfile, email: undefined })).toBe(false)
  expect(isProfileComplete({ ...completeProfile, company: undefined })).toBe(false)
  expect(isProfileComplete({ ...completeProfile, discordUsername: undefined })).toBe(false)
  expect(isProfileComplete({ name: undefined, email: undefined, company: undefined, discordUsername: undefined })).toBe(false)
})

test('whitespace-only name, email, or company does not count as filled in', () => {
  expect(isProfileComplete({ ...completeProfile, name: '   ' })).toBe(false)
  expect(isProfileComplete({ ...completeProfile, email: '  ' })).toBe(false)
  expect(isProfileComplete({ ...completeProfile, company: '  ' })).toBe(false)
})

test('signing in with GitHub creates a row with no other field filled in yet', async () => {
  await ensureContributor('1001', 'octocat')

  const found = await findByGithubId('1001')
  expect(found?.githubLogin).toBe('octocat')
  expect(found?.name).toBeUndefined()
  expect(found?.email).toBeUndefined()
  expect(found?.telegramUsername).toBeUndefined()
  // Only an admin editing the cf-internal registry can promote this — see
  // migrations/005_contributor_status.sql.
  expect(found?.status).toBe('draft')
})

test('returns null for an unknown github id', async () => {
  expect(await findByGithubId('999')).toBeNull()
})

test('a returning contributor updates the same row rather than adding one', async () => {
  await ensureContributor('1001', 'octocat')
  await ensureContributor('1001', 'octocat-renamed')

  const { rows } = await pool.query('SELECT count(*)::int AS n FROM contributors')
  expect(rows[0].n).toBe(1)
  expect((await findByGithubId('1001'))?.githubLogin).toBe('octocat-renamed')
})

test('stores the github name and public email, and keeps them fresh on a returning sign-in', async () => {
  await ensureContributor('1001', 'octocat', 'The Octocat', 'octocat@github.com')

  let found = await findByGithubId('1001')
  expect(found?.githubName).toBe('The Octocat')
  expect(found?.githubEmail).toBe('octocat@github.com')

  await ensureContributor('1001', 'octocat', 'Octo Cat', undefined)

  found = await findByGithubId('1001')
  expect(found?.githubName).toBe('Octo Cat')
  // A since-removed public email must not survive as a stale value.
  expect(found?.githubEmail).toBeUndefined()
})

test('prefills the typed name/email from github only while the field is still empty', async () => {
  await ensureContributor('1001', 'octocat', 'The Octocat', 'octocat@github.com')

  let found = await findByGithubId('1001')
  expect(found?.name).toBe('The Octocat')
  expect(found?.email).toBe('octocat@github.com')

  await saveField('1001', 'name', 'Ada Lovelace')
  await saveField('1001', 'email', undefined) // clearing is deliberate — see saveField's own doc comment

  // A later sign-in with a changed github name/email must not clobber the
  // name the contributor has since typed, prefilled or not — but the email,
  // deliberately cleared back to empty, is fair game again.
  await ensureContributor('1001', 'octocat', 'Something Else', 'something-else@github.com')

  found = await findByGithubId('1001')
  expect(found?.name).toBe('Ada Lovelace')
  expect(found?.email).toBe('something-else@github.com')
})

test('linking a provider does not disturb the other provider or the typed fields', async () => {
  await ensureContributor('1001', 'octocat')
  await saveField('1001', 'name', 'Ada Lovelace')
  await linkProvider('1001', 'discord', { providerId: '555', username: 'ada-discord', name: 'Ada' })

  await linkProvider('1001', 'telegram', { providerId: '777', username: 'ada-tg', name: 'Ada Lovelace TG' })

  const found = await findByGithubId('1001')
  expect(found?.name).toBe('Ada Lovelace')
  expect(found?.discordId).toBe('555')
  expect(found?.discordUsername).toBe('ada-discord')
  expect(found?.discordName).toBe('Ada')
  expect(found?.telegramId).toBe('777')
  expect(found?.telegramUsername).toBe('ada-tg')
  expect(found?.telegramName).toBe('Ada Lovelace TG')
})

// A provider's fields move together as a unit, the same invariant the old
// upsert-with-COALESCE design had to work for: Telegram's username and phone
// are mutually exclusive by construction (toIdentity returns one or the
// other, never both — see providers/telegram.ts), so a stale phone number
// must not survive next to a newly linked, username-bearing account.
test('re-linking telegram to a username-bearing account clears a previously stored phone', async () => {
  await ensureContributor('1001', 'octocat')
  await linkProvider('1001', 'telegram', { providerId: '111', phone: '+359888123456' })

  await linkProvider('1001', 'telegram', { providerId: '222', username: 'ada-tg' })

  const found = await findByGithubId('1001')
  expect(found?.telegramId).toBe('222')
  expect(found?.telegramUsername).toBe('ada-tg')
  expect(found?.telegramPhone).toBeUndefined()
})

// The exact defect this exists to catch: Telegram's OIDC `sub` is a string,
// not bounded by 64 bits, and production saw a real id 20 digits long — past
// bigint's ~9.2e18 max — rejected as "out of range for type bigint" on a
// callback that had already succeeded with Telegram (migrations/003 is the
// fix; this exercises the app path on top of it).
test('a telegram id larger than bigint can hold still links and reads back exactly', async () => {
  await ensureContributor('1001', 'octocat')
  const oversizedId = '12183332595470058690'

  await linkProvider('1001', 'telegram', { providerId: oversizedId, username: 'ada-tg' })

  const found = await findByGithubId('1001')
  expect(found?.telegramId).toBe(oversizedId)
})

// Completing a provider's OAuth flow is the strongest proof this app ever
// gets that two rows are the same real person, so a telegram_id/discord_id
// unique-constraint hit is not refused — see linkProvider's own doc comment.
test('linking a telegram account already linked elsewhere succeeds and records the newer row as an alias', async () => {
  await ensureContributor('1001', 'octocat')
  await linkProvider('1001', 'telegram', { providerId: '555', username: 'ada' })
  await ensureContributor('1002', 'grace')

  await expect(linkProvider('1002', 'telegram', { providerId: '555', username: 'ada' })).resolves.toBeUndefined()

  const newer = await findByGithubId('1002')
  expect(newer?.aliasOfGithubId).toBe('1001')
  // The identity itself is never duplicated — it stays only on the row that
  // already held it, keeping the unique constraint intact in storage.
  expect(newer?.telegramId).toBeUndefined()
  expect((await findByGithubId('1001'))?.telegramId).toBe('555')
})

test('linking a discord account already linked elsewhere succeeds and records the newer row as an alias', async () => {
  await ensureContributor('1001', 'octocat')
  await linkProvider('1001', 'discord', { providerId: '888', username: 'ada' })
  await ensureContributor('1002', 'grace')

  await expect(linkProvider('1002', 'discord', { providerId: '888', username: 'ada' })).resolves.toBeUndefined()

  expect((await findByGithubId('1002'))?.aliasOfGithubId).toBe('1001')
})

// LinkedIn carries no username — `toIdentity` (providers/linkedin.ts) never
// sets one — so linking stores only the id and name, with no counterpart
// column left stale.
test('linking linkedin stores id and name, with no username field to set', async () => {
  await ensureContributor('1001', 'octocat')

  await linkProvider('1001', 'linkedin', { providerId: 'li-555', name: 'Ada Lovelace' })

  const found = await findByGithubId('1001')
  expect(found?.linkedinId).toBe('li-555')
  expect(found?.linkedinName).toBe('Ada Lovelace')
})

test('linking a linkedin account already linked elsewhere succeeds and records the newer row as an alias', async () => {
  await ensureContributor('1001', 'octocat')
  await linkProvider('1001', 'linkedin', { providerId: 'li-888', name: 'Ada Lovelace' })
  await ensureContributor('1002', 'grace')

  await expect(
    linkProvider('1002', 'linkedin', { providerId: 'li-888', name: 'Ada Lovelace' }),
  ).resolves.toBeUndefined()

  const newer = await findByGithubId('1002')
  expect(newer?.aliasOfGithubId).toBe('1001')
  // The identity itself is never duplicated — it stays only on the row that
  // already held it, keeping the unique constraint intact in storage.
  expect(newer?.linkedinId).toBeUndefined()
  expect((await findByGithubId('1001'))?.linkedinId).toBe('li-888')
})

test('a shared-identity alias never overwrites an alias already set to someone else', async () => {
  await ensureContributor('1001', 'octocat')
  await linkProvider('1001', 'discord', { providerId: '888', username: 'ada' })
  await ensureContributor('1002', 'grace')
  await ensureContributor('1003', 'ada-third')
  // 1002 is already declared (e.g. by an admin) as an alias of 1003, not 1001.
  await syncContributorAdminFields([adminUpdate({ githubId: '1002', status: 'draft', aliasOfGithubId: '1003' })])

  // Still succeeds — the OAuth login itself is never refused — but the
  // existing, conflicting alias claim is left for an admin to sort out
  // rather than silently overwritten.
  await expect(linkProvider('1002', 'discord', { providerId: '888', username: 'ada' })).resolves.toBeUndefined()

  expect((await findByGithubId('1002'))?.aliasOfGithubId).toBe('1003')
})

test('linkProvider fails loud when the github id names no row', async () => {
  await expect(linkProvider('999999', 'discord', { providerId: '1', username: 'x' })).rejects.toThrow(
    /no contributor row/,
  )
  // Distinct from a transient error: callers use this to tell a contributor
  // to sign in again rather than to retry a save that can never succeed.
  await expect(linkProvider('999999', 'discord', { providerId: '1', username: 'x' })).rejects.toBeInstanceOf(
    ContributorNotFoundError,
  )
})

test('saveField persists each typed field independently, including clearing it back to empty', async () => {
  await ensureContributor('1001', 'octocat')

  await saveField('1001', 'name', 'Ada Lovelace')
  await saveField('1001', 'email', 'ada@example.com')
  await saveField('1001', 'company', 'Analytical Engines')
  expect(await findByGithubId('1001')).toMatchObject({
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    company: 'Analytical Engines',
  })

  await saveField('1001', 'company', undefined)
  const afterClear = await findByGithubId('1001')
  expect(afterClear?.company).toBeUndefined()
  // A save that names one column must not disturb the others.
  expect(afterClear?.name).toBe('Ada Lovelace')
  expect(afterClear?.email).toBe('ada@example.com')
})

test('saveField fails loud when the github id names no row', async () => {
  await expect(saveField('999999', 'name', 'Ada')).rejects.toThrow(/no contributor row/)
  await expect(saveField('999999', 'name', 'Ada')).rejects.toBeInstanceOf(ContributorNotFoundError)
})

// `field` is typed `DetailField` here, but that's compile-time only — this
// is the query-building layer itself, so an unrecognized value is checked
// explicitly rather than trusted to become a harmless column name.
test('saveField rejects a field name outside the closed set rather than building a query around it', async () => {
  await ensureContributor('1001', 'octocat')

  // @ts-expect-error — exercising the runtime guard for a value the type
  // system would otherwise rule out.
  await expect(saveField('1001', 'is_admin', 'true')).rejects.toThrow(/not a recognized field/)
})

// IDEA-034's profile_completeness — derived and recomputed after every
// write that could change it (see contributors.ts's refreshProfileCompleteness).
// .env.test sets no LINKEDIN_CLIENT_ID/SECRET, so isProviderConfigured('linkedin')
// is false here — Complete only requires Telegram, matching a deploy that
// never enabled LinkedIn (see computeProfileCompleteness's doc comment).
test('a fresh contributor starts incomplete', async () => {
  await ensureContributor('1001', 'octocat')
  expect((await findByGithubId('1001'))?.profileCompleteness).toBe('incomplete')
})

test('profile_completeness tracks every write that could change it: mandatory fields, discord, then email confirmation', async () => {
  await ensureContributor('1001', 'octocat')
  await saveField('1001', 'name', 'Ada Lovelace')
  await saveField('1001', 'email', 'ada@example.com')
  await saveField('1001', 'company', 'Analytical Engines')
  // Every mandatory field is filled except Discord, and the email isn't
  // confirmed yet — still incomplete on both counts.
  expect((await findByGithubId('1001'))?.profileCompleteness).toBe('incomplete')

  await linkProvider('1001', 'discord', { providerId: '555', username: 'ada-discord' })
  // Discord's now linked, but the email still isn't confirmed.
  expect((await findByGithubId('1001'))?.profileCompleteness).toBe('incomplete')

  await resendConfirmationEmail('1001')
  const token = await confirmationToken('1001')
  await confirmEmail(token!)
  // Every mandatory field filled and confirmed, but Telegram isn't linked yet.
  expect((await findByGithubId('1001'))?.profileCompleteness).toBe('ready')

  await linkProvider('1001', 'telegram', { providerId: '777', username: 'ada-tg' })
  expect((await findByGithubId('1001'))?.profileCompleteness).toBe('complete')
})

test('changing the email back to unconfirmed drops a complete profile back to incomplete', async () => {
  await ensureContributor('1001', 'octocat')
  await saveField('1001', 'name', 'Ada Lovelace')
  await saveField('1001', 'email', 'ada@example.com')
  await saveField('1001', 'company', 'Analytical Engines')
  await linkProvider('1001', 'discord', { providerId: '555', username: 'ada-discord' })
  await linkProvider('1001', 'telegram', { providerId: '777', username: 'ada-tg' })
  await resendConfirmationEmail('1001')
  await confirmEmail((await confirmationToken('1001'))!)
  expect((await findByGithubId('1001'))?.profileCompleteness).toBe('complete')

  // saveEmail clears email_confirmed_at whenever the address actually changes.
  await saveField('1001', 'email', 'ada.new@example.com')
  expect((await findByGithubId('1001'))?.profileCompleteness).toBe('incomplete')
})

test('syncContributorAdminFields applies status/alias/is_agent and reports an unmatched github_id back', async () => {
  await ensureContributor('1001', 'octocat')
  await ensureContributor('2002', 'grace')

  const { updated, notFound, rejected } = await syncContributorAdminFields([
    adminUpdate({ githubId: '1001', status: 'confirmed', isAgent: true }),
    adminUpdate({ githubId: '999999' }),
  ])

  expect(updated).toEqual(['1001'])
  expect(notFound).toEqual(['999999'])
  expect(rejected).toEqual([])
  const found = await findByGithubId('1001')
  expect(found?.status).toBe('confirmed')
  expect(found?.isAgent).toBe(true)
  // Untouched by the sync — still its defaults.
  const other = await findByGithubId('2002')
  expect(other?.status).toBe('draft')
  expect(other?.isAgent).toBe(false)
})

test('syncContributorAdminFields sets an alias pointing at another real contributor', async () => {
  await ensureContributor('1001', 'octocat')
  await ensureContributor('2002', 'grace')

  const { updated } = await syncContributorAdminFields([adminUpdate({ githubId: '2002', aliasOfGithubId: '1001' })])

  expect(updated).toEqual(['2002'])
  expect((await findByGithubId('2002'))?.aliasOfGithubId).toBe('1001')
})

test('syncContributorAdminFields rejects an alias pointing at a github_id this app has never seen', async () => {
  await ensureContributor('1001', 'octocat')

  const { updated, rejected } = await syncContributorAdminFields([
    adminUpdate({ githubId: '1001', aliasOfGithubId: '999999' }),
  ])

  expect(updated).toEqual([])
  expect(rejected).toEqual(['1001'])
  // Rejected, so nothing about the row changed at all.
  expect((await findByGithubId('1001'))?.aliasOfGithubId).toBeUndefined()
})

test('syncContributorAdminFields rejects a contributor aliased to themselves', async () => {
  await ensureContributor('1001', 'octocat')

  const { rejected } = await syncContributorAdminFields([adminUpdate({ githubId: '1001', aliasOfGithubId: '1001' })])

  expect(rejected).toEqual(['1001'])
})

test('listContributorsForRegistry returns every contributor, ordered by github login', async () => {
  await ensureContributor('2002', 'grace')
  await ensureContributor('1001', 'ada')

  const registry = await listContributorsForRegistry()

  expect(registry.map((c) => c.githubLogin)).toEqual(['ada', 'grace'])
})

test('resolveProviderLabels shows a contributor their own direct link when they have one', async () => {
  await ensureContributor('1001', 'octocat')
  await linkProvider('1001', 'telegram', { providerId: '555', username: 'ada' })

  const labels = await resolveProviderLabels((await findByGithubId('1001'))!)

  expect(labels.telegramLabel).toBe('@ada')
  expect(labels.discordLabel).toBeNull()
  expect(labels.linkedinLabel).toBeNull()
})

// LinkedIn's label is its name — there's no username to prefer, unlike
// Telegram/Discord above.
test('resolveProviderLabels shows a contributor their own linkedin name', async () => {
  await ensureContributor('1001', 'octocat')
  await linkProvider('1001', 'linkedin', { providerId: 'li-555', name: 'Ada Lovelace' })

  const labels = await resolveProviderLabels((await findByGithubId('1001'))!)

  expect(labels.linkedinLabel).toBe('Ada Lovelace')
})

test('resolveProviderLabels inherits an alias target\'s linkedin name when the row has none of its own', async () => {
  await ensureContributor('1001', 'octocat')
  await linkProvider('1001', 'linkedin', { providerId: 'li-555', name: 'Ada Lovelace' })
  await ensureContributor('1002', 'grace')
  await linkProvider('1002', 'linkedin', { providerId: 'li-555', name: 'Ada Lovelace' }) // sets 1002's alias to 1001

  const labels = await resolveProviderLabels((await findByGithubId('1002'))!)

  expect(labels.linkedinLabel).toBe('Ada Lovelace')
})

test('resolveProviderLabels inherits an alias target\'s link when the row has none of its own', async () => {
  await ensureContributor('1001', 'octocat')
  await linkProvider('1001', 'telegram', { providerId: '555', username: 'ada' })
  await ensureContributor('1002', 'grace')
  await linkProvider('1002', 'telegram', { providerId: '555', username: 'ada' }) // sets 1002's alias to 1001

  const labels = await resolveProviderLabels((await findByGithubId('1002'))!)

  expect(labels.telegramLabel).toBe('@ada')
})

test('resolveProviderLabels never inherits when the row already has its own link', async () => {
  await ensureContributor('1001', 'octocat')
  await linkProvider('1001', 'discord', { providerId: '888', username: 'ada' })
  await ensureContributor('1002', 'grace')
  await linkProvider('1002', 'discord', { providerId: '999', username: 'grace-discord' })

  const labels = await resolveProviderLabels((await findByGithubId('1002'))!)

  expect(labels.discordLabel).toBe('grace-discord')
})

// GitHub has already verified the email on its own side — that's exactly
// what the confirmation flow below exists to establish for an address a
// contributor typed themselves, so there's nothing left to prove here.
test('an email prefilled from github is confirmed immediately, with no token', async () => {
  const found = await ensureContributor('1001', 'octocat', 'The Octocat', 'octocat@github.com')

  expect(found.emailConfirmedAt).toBeInstanceOf(Date)
  expect(await confirmationToken('1001')).toBeNull()
})

test('a returning sign-in never re-confirms an email the contributor has since typed over', async () => {
  await ensureContributor('1001', 'octocat', 'The Octocat', 'octocat@github.com')
  await saveField('1001', 'email', 'ada@example.com')
  expect((await findByGithubId('1001'))?.emailConfirmedAt).toBeUndefined()

  await ensureContributor('1001', 'octocat', 'The Octocat', 'octocat@github.com')

  // Still whatever saveField left it as — a second sign-in must not silently
  // mark the contributor's own typed address as GitHub-confirmed.
  expect((await findByGithubId('1001'))?.emailConfirmedAt).toBeUndefined()
  expect((await findByGithubId('1001'))?.email).toBe('ada@example.com')
})

test('saving a typed email clears any previous confirmation, without sending anything', async () => {
  await ensureContributor('1001', 'octocat', 'The Octocat', 'octocat@github.com') // confirmed via github

  await saveField('1001', 'email', 'ada@example.com')

  const found = await findByGithubId('1001')
  expect(found?.email).toBe('ada@example.com')
  expect(found?.emailConfirmedAt).toBeUndefined()
  expect(found?.emailConfirmationSentAt).toBeUndefined()
  expect(await confirmationToken('1001')).toBeNull()
})

test('saving the same email again is a no-op — an existing confirmation survives', async () => {
  await ensureContributor('1001', 'octocat')
  await saveField('1001', 'email', 'ada@example.com')
  await resendConfirmationEmail('1001')
  const tokenBefore = await confirmationToken('1001')

  await saveField('1001', 'email', 'ada@example.com')

  expect(await confirmationToken('1001')).toBe(tokenBefore)
})

test('clearing an email back to empty clears every confirmation field with it', async () => {
  await ensureContributor('1001', 'octocat')
  await saveField('1001', 'email', 'ada@example.com')

  await saveField('1001', 'email', undefined)

  const found = await findByGithubId('1001')
  expect(found?.email).toBeUndefined()
  expect(found?.emailConfirmedAt).toBeUndefined()
  expect(found?.emailConfirmationSentAt).toBeUndefined()
  expect(await confirmationToken('1001')).toBeNull()
})

test('confirmEmail marks the email confirmed and keeps the token', async () => {
  await ensureContributor('1001', 'octocat')
  await saveField('1001', 'email', 'ada@example.com')
  await resendConfirmationEmail('1001')
  const token = await confirmationToken('1001')

  expect(await confirmEmail(token!)).toBe('confirmed')

  const found = await findByGithubId('1001')
  expect(found?.emailConfirmedAt).toBeInstanceOf(Date)
  // The token survives success so a second visit to the same link — a mail
  // scanner having pre-fetched it, a double click, a reload — reads as
  // "confirmed" rather than "not valid".
  expect(await confirmationToken('1001')).toBe(token)
})

test('confirmEmail reports a second visit to an already-used link as confirmed, not invalid', async () => {
  await ensureContributor('1001', 'octocat')
  await saveField('1001', 'email', 'ada@example.com')
  await resendConfirmationEmail('1001')
  const token = await confirmationToken('1001')
  const first = await confirmEmail(token!)
  expect(first).toBe('confirmed')
  const confirmedAt = (await findByGithubId('1001'))?.emailConfirmedAt

  expect(await confirmEmail(token!)).toBe('confirmed')

  // The repeat is read-only — the original confirmation timestamp survives.
  expect((await findByGithubId('1001'))?.emailConfirmedAt).toEqual(confirmedAt)
})

test('confirmEmail reports an unrecognized token as invalid', async () => {
  expect(await confirmEmail('not-a-real-token')).toBe('invalid')
})

test('confirmEmail reports an expired token as expired, and still consumes it', async () => {
  await ensureContributor('1001', 'octocat')
  await saveField('1001', 'email', 'ada@example.com')
  await resendConfirmationEmail('1001')
  const token = await confirmationToken('1001')
  // Backdate the send past the 24h TTL — the only way to exercise
  // expiration without waiting a real day.
  await pool.query("UPDATE contributors SET email_confirmation_sent_at = now() - interval '25 hours' WHERE github_id = '1001'")

  expect(await confirmEmail(token!)).toBe('expired')
  expect(await confirmationToken('1001')).toBeNull() // a dead token has no reason to linger
  expect((await findByGithubId('1001'))?.emailConfirmedAt).toBeUndefined()
})

test('resendConfirmationEmail re-sends the same still-live token — earlier emails keep working', async () => {
  await ensureContributor('1001', 'octocat')
  await saveField('1001', 'email', 'ada@example.com')
  await resendConfirmationEmail('1001')
  const originalToken = await confirmationToken('1001')

  await resendConfirmationEmail('1001')

  // Rotating here would silently kill the link in every email already
  // delivered — with two emails in the inbox, whichever the contributor
  // opens has to work.
  expect(await confirmationToken('1001')).toBe(originalToken)
})

test('resendConfirmationEmail restarts the 24h clock on the re-sent token', async () => {
  await ensureContributor('1001', 'octocat')
  await saveField('1001', 'email', 'ada@example.com')
  await resendConfirmationEmail('1001')
  // Age the pending send within the TTL — the resend must still reset the
  // clock, since the new email promises a full 24 hours.
  await pool.query("UPDATE contributors SET email_confirmation_sent_at = now() - interval '23 hours' WHERE github_id = '1001'")

  await resendConfirmationEmail('1001')

  const sentAt = (await findByGithubId('1001'))?.emailConfirmationSentAt
  expect(sentAt).toBeInstanceOf(Date)
  expect(Date.now() - sentAt!.getTime()).toBeLessThan(60 * 1000)
})

test('resendConfirmationEmail issues a fresh token once the previous one has expired', async () => {
  await ensureContributor('1001', 'octocat')
  await saveField('1001', 'email', 'ada@example.com')
  await resendConfirmationEmail('1001')
  const originalToken = await confirmationToken('1001')
  await pool.query("UPDATE contributors SET email_confirmation_sent_at = now() - interval '25 hours' WHERE github_id = '1001'")

  await resendConfirmationEmail('1001')

  const newToken = await confirmationToken('1001')
  expect(newToken).not.toBeNull()
  expect(newToken).not.toBe(originalToken)
})

test('resendConfirmationEmail is a no-op once the email is already confirmed', async () => {
  await ensureContributor('1001', 'octocat', 'The Octocat', 'octocat@github.com') // confirmed via github
  expect(await confirmationToken('1001')).toBeNull()

  await resendConfirmationEmail('1001')

  // No token materialized — nothing was sent, and emailConfirmedAt survives.
  expect(await confirmationToken('1001')).toBeNull()
  expect((await findByGithubId('1001'))?.emailConfirmedAt).toBeInstanceOf(Date)
})

test('resendConfirmationEmail is a no-op for a contributor with no email at all', async () => {
  await ensureContributor('1001', 'octocat')

  await resendConfirmationEmail('1001')

  expect(await confirmationToken('1001')).toBeNull()
})

async function confirm(githubId: string): Promise<void> {
  await syncContributorAdminFields([adminUpdate({ githubId })])
}

test('searchContributors returns nothing for fewer than 3 characters', async () => {
  await ensureContributor('1001', 'octocat')
  await saveField('1001', 'name', 'Ada Lovelace')
  await confirm('1001')

  expect(await searchContributors('Ad')).toEqual([])
})

test('searchContributors matches a confirmed contributor by name', async () => {
  await ensureContributor('1001', 'octocat')
  await saveField('1001', 'name', 'Ada Lovelace')
  await confirm('1001')

  const results = await searchContributors('lovelace')
  expect(results).toHaveLength(1)
  expect(results[0].name).toBe('Ada Lovelace')
})

// The registry sync's whole point is that `draft` isn't a real directory
// entry yet — search must honor that, not just the profile page.
test('searchContributors never returns a draft contributor', async () => {
  await ensureContributor('1001', 'octocat')
  await saveField('1001', 'name', 'Ada Lovelace')

  expect(await searchContributors('lovelace')).toEqual([])
})

test('searchContributors matches email, github login, github email, discord, telegram, and linkedin', async () => {
  await ensureContributor('1001', 'octocat', 'The Octocat', 'octocat@github.com')
  await saveField('1001', 'email', 'ada@example.com')
  await linkProvider('1001', 'discord', { providerId: '555', username: 'ada-discord' })
  await linkProvider('1001', 'telegram', { providerId: '777', username: 'ada-tg' })
  await linkProvider('1001', 'linkedin', { providerId: '999', name: 'Ada L.' })
  await confirm('1001')

  await expect(searchContributors('ada@example')).resolves.toHaveLength(1)
  await expect(searchContributors('octocat')).resolves.toHaveLength(1)
  await expect(searchContributors('octocat@github')).resolves.toHaveLength(1)
  await expect(searchContributors('ada-discord')).resolves.toHaveLength(1)
  await expect(searchContributors('ada-tg')).resolves.toHaveLength(1)
  await expect(searchContributors('Ada L.')).resolves.toHaveLength(1)
})

test('searchContributors caps at 5 results', async () => {
  for (let i = 0; i < 7; i++) {
    await ensureContributor(String(1000 + i), `contributor${i}`)
    await saveField(String(1000 + i), 'name', `Zebra Contributor ${i}`)
    await confirm(String(1000 + i))
  }

  expect(await searchContributors('Zebra')).toHaveLength(5)
})

test('searchContributors ranks a match at the start of a field above one only inside it', async () => {
  // Alphabetically "Abigail..." sorts before "Andy...", so this only passes
  // if the rank actually overrides plain alphabetical order, not merely
  // agrees with it.
  await ensureContributor('1001', 'octocat')
  await saveField('1001', 'name', 'Abigail Anderson') // "and" only inside "Anderson", not at the start
  await confirm('1001')
  await ensureContributor('1002', 'grace')
  await saveField('1002', 'name', 'Andy Baker') // "and" at the very start
  await confirm('1002')

  const results = await searchContributors('and')
  expect(results.map((r) => r.name)).toEqual(['Andy Baker', 'Abigail Anderson'])
})

test('countConfirmedContributors counts only confirmed rows', async () => {
  await ensureContributor('1001', 'octocat')
  await confirm('1001')
  await ensureContributor('1002', 'grace')
  await confirm('1002')
  await ensureContributor('1003', 'ada') // draft — never confirmed

  expect(await countConfirmedContributors()).toBe(2)
})

test('countConfirmedContributors is 0 against an empty table', async () => {
  expect(await countConfirmedContributors()).toBe(0)
})

test('getPublicProfile returns null for a hash matching nothing', async () => {
  expect(await getPublicProfile('not-a-real-hash')).toBeNull()
})

test('getPublicProfile returns null for a draft contributor — no public page until confirmed', async () => {
  await ensureContributor('1001', 'octocat')
  await saveField('1001', 'name', 'Ada Lovelace')
  const { rows } = await pool.query<{ hash: string }>("SELECT md5(id::text) AS hash FROM contributors WHERE github_id = '1001'")

  expect(await getPublicProfile(rows[0].hash)).toBeNull()
})

test('getPublicProfile returns a confirmed contributor by hash', async () => {
  await ensureContributor('1001', 'octocat')
  await saveField('1001', 'name', 'Ada Lovelace')
  await saveField('1001', 'company', 'Acronis')
  await confirm('1001')
  const { rows } = await pool.query<{ hash: string }>("SELECT md5(id::text) AS hash FROM contributors WHERE github_id = '1001'")

  const profile = await getPublicProfile(rows[0].hash)
  expect(profile?.name).toBe('Ada Lovelace')
  expect(profile?.company).toBe('Acronis')
  expect(profile?.githubLogin).toBe('octocat')
})

// IDEA-004's "merges in everything recorded under any of that contributor's
// aliases, not just the row that was opened" — both directions.
test('getPublicProfile merges in an alias row Discord when opening the primary', async () => {
  await ensureContributor('1001', 'octocat') // primary
  await saveField('1001', 'name', 'Ada Lovelace')
  await confirm('1001')
  await ensureContributor('1002', 'ada-work') // alias of 1001
  await linkProvider('1002', 'discord', { providerId: '555', username: 'ada-discord' })
  await syncContributorAdminFields([adminUpdate({ githubId: '1002', aliasOfGithubId: '1001' })])
  const { rows } = await pool.query<{ hash: string }>("SELECT md5(id::text) AS hash FROM contributors WHERE github_id = '1001'")

  const profile = await getPublicProfile(rows[0].hash)
  expect(profile?.discordLabel).toBe('ada-discord')
})

test('getPublicProfile merges in the primary Telegram when opening an alias', async () => {
  await ensureContributor('1001', 'octocat') // primary
  await linkProvider('1001', 'telegram', { providerId: '777', username: 'ada-tg' })
  await ensureContributor('1002', 'ada-work') // alias of 1001
  await saveField('1002', 'name', 'Ada at Work')
  await syncContributorAdminFields([
    adminUpdate({ githubId: '1001' }),
    adminUpdate({ githubId: '1002', aliasOfGithubId: '1001' }),
  ])
  const { rows } = await pool.query<{ hash: string }>("SELECT md5(id::text) AS hash FROM contributors WHERE github_id = '1002'")

  const profile = await getPublicProfile(rows[0].hash)
  expect(profile?.name).toBe('Ada at Work') // the opened row's own name wins
  expect(profile?.telegramUsername).toBe('ada-tg') // merged in from the primary
})

test('getPublicProfile only shows email once confirmed', async () => {
  await ensureContributor('1001', 'octocat')
  await saveField('1001', 'email', 'ada@example.com')
  await confirm('1001')
  const { rows } = await pool.query<{ hash: string }>("SELECT md5(id::text) AS hash FROM contributors WHERE github_id = '1001'")

  expect((await getPublicProfile(rows[0].hash))?.emailLabel).toBeUndefined()

  await resendConfirmationEmail('1001')
  const token = await confirmationToken('1001')
  await confirmEmail(token!)

  expect((await getPublicProfile(rows[0].hash))?.emailLabel).toBe('ada@example.com')
})

test('a new contributor is never an admin by default', async () => {
  await ensureContributor('1001', 'octocat')
  expect((await findByGithubId('1001'))?.isAdmin).toBe(false)
})

test('syncContributorAdminFields grants and revokes is_admin, same as it does status/isAgent', async () => {
  await ensureContributor('1001', 'octocat')

  await syncContributorAdminFields([adminUpdate({ githubId: '1001', isAdmin: true })])
  expect((await findByGithubId('1001'))?.isAdmin).toBe(true)

  await syncContributorAdminFields([adminUpdate({ githubId: '1001', isAdmin: false })])
  expect((await findByGithubId('1001'))?.isAdmin).toBe(false)
})

test('CONTRIBUTOR_STATUSES includes blocked alongside draft and confirmed', () => {
  expect(CONTRIBUTOR_STATUSES).toEqual(['draft', 'confirmed', 'blocked'])
})

test('setContributorStatus writes status directly, IDEA-012\'s Confirm/Block', async () => {
  await ensureContributor('1001', 'octocat')

  await setContributorStatus('1001', 'confirmed')
  expect((await findByGithubId('1001'))?.status).toBe('confirmed')

  await setContributorStatus('1001', 'blocked')
  expect((await findByGithubId('1001'))?.status).toBe('blocked')
})

test('setContributorStatus fails loud when the github id names no row', async () => {
  await expect(setContributorStatus('999999', 'blocked')).rejects.toThrow(ContributorNotFoundError)
})

// Blocked reads exactly like draft everywhere status already gates
// something — hidden, not additionally restricted (see the confirmed-only
// tests above/below for the same assertions against draft).
test('a blocked contributor is excluded from search, same as a draft one', async () => {
  await ensureContributor('1001', 'octocat')
  await saveField('1001', 'name', 'Ada Lovelace')
  await confirm('1001')
  await setContributorStatus('1001', 'blocked')

  expect(await searchContributors('lovelace')).toEqual([])
})

test('a blocked contributor has no public profile, same as a draft one', async () => {
  await ensureContributor('1001', 'octocat')
  await confirm('1001')
  const { rows } = await pool.query<{ hash: string }>("SELECT md5(id::text) AS hash FROM contributors WHERE github_id = '1001'")
  await setContributorStatus('1001', 'blocked')

  expect(await getPublicProfile(rows[0].hash)).toBeNull()
})

test('markPolicyLinkClicked stamps the moment, idempotently on repeat calls', async () => {
  await ensureContributor('1001', 'octocat')

  expect((await findByGithubId('1001'))?.policyLinkClickedAt).toBeUndefined()

  await markPolicyLinkClicked('1001')
  const first = (await findByGithubId('1001'))?.policyLinkClickedAt
  expect(first).toBeInstanceOf(Date)

  await markPolicyLinkClicked('1001')
  const second = (await findByGithubId('1001'))?.policyLinkClickedAt
  expect(second).toBeInstanceOf(Date)
})

test('hideChecklistItem stamps only the one item it names', async () => {
  await ensureContributor('1001', 'octocat')

  await hideChecklistItem('1001', 'policies')

  const row = await findByGithubId('1001')
  expect(row?.checklistPoliciesHiddenAt).toBeInstanceOf(Date)
  expect(row?.checklistProfileHiddenAt).toBeUndefined()
  expect(row?.checklistTrackHiddenAt).toBeUndefined()
})

test('hideChecklistItem covers all three items independently', async () => {
  await ensureContributor('1001', 'octocat')

  await hideChecklistItem('1001', 'profile')
  await hideChecklistItem('1001', 'track')

  const row = await findByGithubId('1001')
  expect(row?.checklistProfileHiddenAt).toBeInstanceOf(Date)
  expect(row?.checklistTrackHiddenAt).toBeInstanceOf(Date)
  expect(row?.checklistPoliciesHiddenAt).toBeUndefined()
})
