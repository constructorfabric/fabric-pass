/**
 * The Save button's gate: Name and Email are mandatory to leave edit mode,
 * even though either can autosave blank mid-edit (see form-schema.ts's
 * `validateField` doc comment). Returns the missing fields' labels, in
 * display order, so the caller can name them in the prompt shown to the
 * contributor; an empty array means Save may proceed.
 *
 * Kept in its own client-safe module, apart from form-schema.ts: this is the
 * one check form.tsx ('use client') needs, and form-schema.ts pulls in
 * `@/lib/contributors` (and, through it, `pg`) for `isDetailField` — a chain
 * that must never reach the browser bundle.
 */
export function missingMandatoryFields(values: { name: string; email: string }): string[] {
  const missing: string[] = []
  if (!values.name.trim()) missing.push('Name')
  if (!values.email.trim()) missing.push('Email')
  return missing
}
