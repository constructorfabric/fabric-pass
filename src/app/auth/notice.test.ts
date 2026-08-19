import { expect, test } from 'vitest'
import { noticeKind, noticeMessage, REAUTH_REQUIRED_MESSAGE, withNotice } from './notice.ts'

test('an unrecognized code shows nothing rather than failing', () => {
  expect(noticeMessage('not-a-real-code', 'telegram')).toBeUndefined()
})

test('withNotice round-trips through noticeMessage', () => {
  const url = withNotice(new URL('http://localhost:3000/'), 'identity-changed', 'discord')
  expect(noticeMessage(url.searchParams.get('notice') ?? undefined, url.searchParams.get('provider') ?? undefined)).toBe(
    'You signed in as a different GitHub account while linking discord. Please start the discord link again.',
  )
})

test('an identity-changed notice names the provider that was being linked', () => {
  expect(noticeMessage('identity-changed', 'discord')).toBe(
    'You signed in as a different GitHub account while linking discord. Please start the discord link again.',
  )
})

test('an identity-changed notice with no provider still reads sensibly', () => {
  expect(noticeMessage('identity-changed', undefined)).toBe(
    'You signed in as a different GitHub account partway through. Please try again.',
  )
})

test('a reauth-required notice tells the person to sign in again, not to retry', () => {
  expect(noticeMessage('reauth-required', undefined)).toMatch(/sign in/i)
})

// app/actions.ts's saveField surfaces this exact same condition mid-visit
// (a stale session naming a deleted row) — one message, shared, rather than
// a second copy of the wording that could drift from this one.
test('the reauth-required notice is the shared message constant', () => {
  expect(noticeMessage('reauth-required', undefined)).toBe(REAUTH_REQUIRED_MESSAGE)
})

test('a sign-in-required notice tells the person to sign in again, and reads distinctly from a stale sign-in link', () => {
  expect(noticeMessage('sign-in-required', undefined)).toMatch(/sign in/i)
  expect(noticeMessage('sign-in-required', undefined)).not.toBe(noticeMessage('expired', undefined))
  expect(noticeKind('sign-in-required')).toBe('error')
})

test('an email-confirmed notice reads as success, not an error', () => {
  expect(noticeMessage('email-confirmed', undefined)).toBe('Your email has been confirmed.')
  expect(noticeKind('email-confirmed')).toBe('success')
})

test('a confirmation-resent notice reads as success, not an error', () => {
  expect(noticeMessage('confirmation-resent', undefined)).toBe('Confirmation email sent — check your inbox.')
  expect(noticeKind('confirmation-resent')).toBe('success')
})

test('confirmation-expired and invalid-confirmation-link both read as errors and point at resending', () => {
  expect(noticeMessage('confirmation-expired', undefined)).toMatch(/expired/i)
  expect(noticeMessage('confirmation-expired', undefined)).toMatch(/resend/i)
  expect(noticeKind('confirmation-expired')).toBe('error')

  expect(noticeMessage('invalid-confirmation-link', undefined)).toMatch(/not valid/i)
  expect(noticeKind('invalid-confirmation-link')).toBe('error')
})

// Every existing notice code predates noticeKind and was always shown in the
// same red banner — this pins that none of them silently became "success"
// by omission when the two new codes were added.
test('every other existing notice code still reads as an error', () => {
  expect(noticeKind('expired')).toBe('error')
  expect(noticeKind('link-failed')).toBe('error')
  expect(noticeKind('telegram-no-contact')).toBe('error')
  expect(noticeKind('identity-changed')).toBe('error')
  expect(noticeKind('reauth-required')).toBe('error')
  expect(noticeKind('sign-in-required')).toBe('error')
})
