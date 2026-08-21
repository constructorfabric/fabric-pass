/**
 * IDEA-038 item 1 — Capitalized, everywhere a contributor's status is shown
 * (previously only the Admin table rendered it, as the raw lowercase DB
 * value with no label map at all). Client-safe on purpose (no `@/lib/db`
 * import via contributors.ts): consumed from 'use client' components —
 * admin-contributor-table.tsx, contributor-search.tsx — the same reason
 * that file already duplicates CONTRIBUTOR_STATUS_VALUES locally rather
 * than importing it from contributors.ts.
 */
export const CONTRIBUTOR_STATUS_LABELS: Record<'draft' | 'confirmed' | 'blocked' | 'revoke_pending' | 'revoked', string> = {
  draft: 'Draft',
  confirmed: 'Confirmed',
  // IDEA-071 — relabeled from "Blocked": this is the declined-a-stranger
  // outcome (Ignore), distinct from Revoke's own "was a contributor, now
  // isn't" outcome below. The DB value stays `blocked`, only the label
  // changed.
  blocked: 'Ignored',
  revoke_pending: 'Pending Revoke',
  revoked: 'Revoked',
}
