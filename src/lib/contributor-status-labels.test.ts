import { expect, test } from 'vitest'
import { CONTRIBUTOR_STATUS_LABELS } from './contributor-status-labels.ts'

test('every status has a Capitalized label', () => {
  expect(CONTRIBUTOR_STATUS_LABELS).toEqual({
    draft: 'Draft',
    confirmed: 'Confirmed',
    // IDEA-071 — relabeled from "Blocked"; the DB value is unchanged.
    blocked: 'Ignored',
    revoke_pending: 'Pending Revoke',
    revoked: 'Revoked',
  })
})
