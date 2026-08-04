import { expect, test } from 'vitest'
import { missingMandatoryFields } from './profile-completeness.ts'

test('nothing is missing when both mandatory fields are filled in', () => {
  expect(missingMandatoryFields({ name: 'Ada Lovelace', email: 'ada@example.com' })).toEqual([])
})

test('a blank name is reported as missing', () => {
  expect(missingMandatoryFields({ name: '  ', email: 'ada@example.com' })).toEqual(['Name'])
})

test('a blank email is reported as missing', () => {
  expect(missingMandatoryFields({ name: 'Ada Lovelace', email: '' })).toEqual(['Email'])
})

test('both blank are reported together, name first', () => {
  expect(missingMandatoryFields({ name: '', email: '' })).toEqual(['Name', 'Email'])
})
