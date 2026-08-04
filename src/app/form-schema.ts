import { z } from 'zod'
import { isDetailField } from '@/lib/contributors'

export interface FieldValidation {
  ok: boolean
  /** The value to persist. Absent (rather than an empty string) clears the column. */
  value?: string
  message?: string
  /**
   * Set when this rejection is informational rather than an error — an email
   * that doesn't parse yet while the field still has focus. Never set
   * together with `ok: true`; a guidance message still means "do not persist
   * this value," same as any other rejection.
   */
  guidance?: boolean
}

/**
 * Validates one autosaved field. `field` arrives as a plain string — this is
 * the entry point for the `saveField` server action, which is reachable as
 * an HTTP endpoint where `DetailField` has already been erased to `string` —
 * so the closed set of real fields is checked explicitly before anything
 * else, rather than trusting the caller's compile-time type.
 *
 * Name and company accept anything, trimmed — blank means "not filled in
 * yet" rather than an error: a field autosaves whatever it holds, including
 * blank, mid-edit — it's `missingMandatoryFields` below, not this function,
 * that stops the contributor from leaving edit mode with Name or Email
 * still blank. Email is the one field
 * checked for shape, and the only one `phase` affects: a string that doesn't
 * parse yet is never persisted either way, but while the field still has
 * focus ('typing' — a debounced autosave firing mid-entry, see
 * use-autosave-field.ts) that is normal, expected progress, not a mistake —
 * "zatsepin.gmail.com" while still typing shouldn't read as a scolding red
 * error before the "@" has even been typed. Once focus leaves ('final' — on
 * blur, or an explicit commit), the same non-parsing value is the contributor
 * saying they're done, and a typo is worth catching rather than silently
 * discarding.
 */
export function validateField(field: string, raw: string, phase: 'typing' | 'final' = 'final'): FieldValidation {
  if (!isDetailField(field)) return { ok: false, message: 'Unknown field' }

  const trimmed = raw.trim()
  if (field !== 'email') return { ok: true, value: trimmed || undefined }

  if (trimmed === '') return { ok: true, value: undefined }
  const parsed = z.email().safeParse(trimmed)
  if (parsed.success) return { ok: true, value: parsed.data }

  if (phase === 'typing') {
    return { ok: false, guidance: true, message: 'You entered an incomplete email address, please continue typing…' }
  }
  return { ok: false, message: 'That does not look like an email address' }
}
