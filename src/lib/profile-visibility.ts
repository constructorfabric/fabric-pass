/**
 * IDEA-110's per-field Admins-only lock — which optional profile fields a
 * contributor can restrict to Admins, and the two shared strings the lock
 * button's tooltip uses. Client-safe (no `@/lib/db` import, and nothing that
 * reaches `pg` transitively): `src/app/form.tsx` ('use client') imports
 * OPTIONAL_PROFILE_FIELDS's type and VISIBILITY_LABELS directly, the same
 * constraint profile-completeness.ts documents for its own module.
 */
export const OPTIONAL_PROFILE_FIELDS = ['telegram', 'linkedin'] as const
export type OptionalProfileField = (typeof OPTIONAL_PROFILE_FIELDS)[number]

/**
 * The real boundary check for `OptionalProfileField`: `setFieldVisibilityAction`
 * (app/actions.ts) is a `'use server'` action reachable as a plain HTTP
 * endpoint, where this type is erased to `string` before this function ever
 * sees it — same reasoning contributors.ts's `isDetailField` documents for
 * `DetailField`. Compile-time typing alone would let an arbitrary column
 * name through to the query `setOptionalFieldVisibility` builds from it.
 */
export function isOptionalProfileField(value: string): value is OptionalProfileField {
  return (OPTIONAL_PROFILE_FIELDS as readonly string[]).includes(value)
}

/** The lock button's own tooltip/aria-label text, one wording shared by the
 * client (`VisibilityLock` in form.tsx) and any future surface that shows
 * the same control — never duplicated as a second copy of the same string. */
export const VISIBILITY_LABELS = {
  everyone: 'Visible to all contributors — click to restrict to Admins',
  adminsOnly: 'Visible to Admins only — click to make visible to all contributors',
} as const
