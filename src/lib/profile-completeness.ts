/**
 * IDEA-000's two mandatory fields — Name and Email — checked the same way
 * everywhere a contributor's profile is judged complete: contributors.ts's
 * isProfileComplete, over a stored row, and form.tsx's Save gate, over a
 * form's live draft values (via missingMandatoryFields below). One rule, one
 * place, so the two readings of "complete" can't drift apart.
 *
 * Client-safe (no @/lib/db import): form.tsx ('use client') imports
 * missingMandatoryFields directly. form-schema.ts's validateField pulls in
 * @/lib/contributors (and, through it, `pg`) for isDetailField — a chain
 * that must never reach the browser bundle — so this rule can't live there.
 */
export function missingMandatoryFields(values: { name?: string; email?: string }): string[] {
  const missing: string[] = []
  if (!values.name?.trim()) missing.push('Name')
  if (!values.email?.trim()) missing.push('Email')
  return missing
}

/** The boolean reading of missingMandatoryFields above, over a stored row
 * rather than a form's live draft — see contributors.ts's isProfileComplete. */
export function isProfileComplete(values: { name?: string; email?: string }): boolean {
  return missingMandatoryFields(values).length === 0
}
