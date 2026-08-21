import { expect, test } from 'vitest'
import {
  computeProfileCompleteness,
  missingForCompleteness,
  missingMandatoryFields,
  PROFILE_COMPLETENESS_LABELS,
} from './profile-completeness.ts'

const complete = { name: 'Ada Lovelace', email: 'ada@example.com', company: 'Constructor', discordUsername: 'ada' }

test('nothing is missing when every mandatory field is filled in', () => {
  expect(missingMandatoryFields(complete)).toEqual([])
})

// IDEA-067 — plain language over the raw state name, everywhere this map is
// read (ProfileLabels, the Admin table's filter).
test('profile-completeness labels read as plain language, not raw state names', () => {
  expect(PROFILE_COMPLETENESS_LABELS).toEqual({
    incomplete: 'Incomplete Profile',
    ready: 'Profile Ready',
    complete: 'Full Profile',
  })
})

test('a blank name is reported as missing, as Full Name', () => {
  expect(missingMandatoryFields({ ...complete, name: '  ' })).toEqual(['Full Name'])
})

test('a blank email is reported as missing', () => {
  expect(missingMandatoryFields({ ...complete, email: '' })).toEqual(['Email'])
})

test('a blank company is reported as missing', () => {
  expect(missingMandatoryFields({ ...complete, company: '  ' })).toEqual(['Company'])
})

test('an unlinked discord is reported as missing', () => {
  expect(missingMandatoryFields({ ...complete, discordUsername: undefined })).toEqual(['Discord'])
})

test('every blank field is reported together, in field order', () => {
  expect(missingMandatoryFields({ name: '', email: '', company: '', discordUsername: undefined })).toEqual([
    'Full Name',
    'Email',
    'Company',
    'Discord',
  ])
})

const completeInput = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  company: 'Constructor',
  discordLinked: true,
  emailConfirmed: true,
  telegramLinked: true,
  linkedinLinked: true,
  linkedinEnabled: true,
}

test('a missing mandatory field is incomplete, even with everything optional filled in', () => {
  expect(computeProfileCompleteness({ ...completeInput, company: '' })).toBe('incomplete')
})

test('every mandatory field filled but email unconfirmed is incomplete, not ready', () => {
  expect(computeProfileCompleteness({ ...completeInput, emailConfirmed: false })).toBe('incomplete')
})

test('every mandatory field filled and confirmed, but telegram missing, is ready', () => {
  expect(computeProfileCompleteness({ ...completeInput, telegramLinked: false })).toBe('ready')
})

test('every mandatory field filled and confirmed, but linkedin missing, is ready when linkedin is enabled', () => {
  expect(computeProfileCompleteness({ ...completeInput, linkedinLinked: false })).toBe('ready')
})

test('linkedin missing does not block complete when linkedin is not enabled on this deploy', () => {
  expect(computeProfileCompleteness({ ...completeInput, linkedinLinked: false, linkedinEnabled: false })).toBe('complete')
})

test('every mandatory and optional field filled in, confirmed, is complete', () => {
  expect(computeProfileCompleteness(completeInput)).toBe('complete')
})

test('missingForCompleteness lists mandatory and optional gaps together', () => {
  expect(
    missingForCompleteness({
      name: '',
      email: 'ada@example.com',
      company: '',
      discordLinked: false,
      emailConfirmed: true,
      telegramLinked: false,
      linkedinLinked: false,
      linkedinEnabled: true,
    }),
  ).toEqual(['Full Name', 'Company', 'Discord', 'Telegram', 'LinkedIn'])
})

test('missingForCompleteness reports nothing for a complete profile', () => {
  expect(missingForCompleteness(completeInput)).toEqual([])
})

test('missingForCompleteness reports email confirmation as missing separately from a blank email', () => {
  expect(missingForCompleteness({ ...completeInput, emailConfirmed: false })).toEqual(['Email confirmation'])
})
