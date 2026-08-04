import { expect, test } from 'vitest'
import { validateField } from './form-schema.ts'

test('a name is trimmed and accepted as-is', () => {
  expect(validateField('name', '  Ada Lovelace  ')).toEqual({ ok: true, value: 'Ada Lovelace' })
})

test('a blank name clears the field rather than failing', () => {
  expect(validateField('name', '   ')).toEqual({ ok: true, value: undefined })
})

test('a company is trimmed and accepted as-is', () => {
  expect(validateField('company', '  Analytical Engines  ')).toEqual({ ok: true, value: 'Analytical Engines' })
})

test('a blank company clears the field rather than failing', () => {
  expect(validateField('company', '')).toEqual({ ok: true, value: undefined })
})

test('a valid email is trimmed and accepted', () => {
  expect(validateField('email', '  ada@example.com  ')).toEqual({ ok: true, value: 'ada@example.com' })
})

test('a blank email clears the field rather than failing', () => {
  expect(validateField('email', '  ')).toEqual({ ok: true, value: undefined })
})

test('a malformed email is rejected rather than saved as typed', () => {
  const result = validateField('email', 'not-an-email')
  expect(result.ok).toBe(false)
  expect(result.message).toMatch(/email/i)
})

// The default `phase` ('final') is what every pre-existing call site above
// exercises implicitly — this pins that default down explicitly, so it can't
// silently drift once 'typing' exists as an option.
test('a malformed email defaults to the final, error-toned rejection when no phase is given', () => {
  const result = validateField('email', 'not-an-email')
  expect(result.guidance).toBeUndefined()
})

// The defect this guards: "zatsepin.gmail.com" typed into a still-focused
// field showed a red "That does not look like an email address" before the
// "@" had even been typed. While still typing, the same not-yet-valid string
// reads as guidance, not an error — but it must still not be persisted.
test('an incomplete email while still typing reads as guidance, not an error, and is not persisted', () => {
  const result = validateField('email', 'zatsepin.gmail.com', 'typing')
  expect(result.ok).toBe(false)
  expect(result.guidance).toBe(true)
  expect(result.value).toBeUndefined()
  expect(result.message).toMatch(/continue typing/i)
})

test('the same incomplete email once focus has left the field is a real error', () => {
  const result = validateField('email', 'zatsepin.gmail.com', 'final')
  expect(result.ok).toBe(false)
  expect(result.guidance).toBeUndefined()
  expect(result.message).toMatch(/does not look like an email/i)
})

test('a valid email while still typing saves normally — phase only changes the rejection, not success', () => {
  const result = validateField('email', 'ada@example.com', 'typing')
  expect(result).toEqual({ ok: true, value: 'ada@example.com' })
})

test('a blank email while still typing still just clears the field', () => {
  const result = validateField('email', '  ', 'typing')
  expect(result).toEqual({ ok: true, value: undefined })
})

// `validateField`'s own `field` parameter is a plain string, not the
// compile-time `DetailField` type — it is the boundary a `'use server'`
// action's arbitrary runtime input actually crosses, so a field name outside
// the closed set of real columns must be refused here, not merely happen to
// fail wherever it's next used.
test('a field name outside the closed set is refused rather than passed through', () => {
  const result = validateField('is_admin', 'true')
  expect(result.ok).toBe(false)
})
