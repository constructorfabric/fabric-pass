'use server'

import {
  ContributorNotFoundError,
  findByGithubId,
  hideChecklistItem,
  isDetailField,
  saveField as persistField,
  searchContributors,
  setOptionalFieldVisibility,
  type ChecklistItem,
  type ContributorSearchResult,
} from '@/lib/contributors'
import { isAdmin } from '@/lib/roles'
import { isOptionalProfileField } from '@/lib/profile-visibility'
import { getSession } from '@/lib/session'
import { REAUTH_REQUIRED_MESSAGE } from '@/app/auth/notice'
import { validateField } from '@/app/form-schema'

export interface FieldSaveResult {
  ok: boolean
  message?: string
  /**
   * Set on a rejection that is informational rather than an error — right
   * now, only an email that doesn't parse yet while the field still has
   * focus (see form-schema.ts's `validateField`). The client uses this to
   * show the message as guidance rather than in the same red, alarming style
   * as a real error, without ever persisting the unparsed value either way.
   */
  guidance?: boolean
  /**
   * Set only for a `ContributorNotFoundError`: the row this session names is
   * gone, so no retry of this same save can ever succeed. The client uses
   * this to offer a way back into GitHub sign-in right where the error
   * surfaced — see README's "session outlives its row" for why that escape
   * hatch has to exist somewhere reachable, not just in the signed-out view.
   */
  reauthRequired?: boolean
}

/**
 * Autosaves one field at a time — called from the client on a debounced
 * change and again on blur, never from a form submit. There is no Save
 * button any more: this is the only path a keystroke has to the database.
 *
 * `field` is a plain string, not `DetailField`: a `'use server'` action is an
 * HTTP endpoint, so whatever the client's build-time type says, an arbitrary
 * value can arrive here at runtime. `validateField` is what actually checks
 * it against the closed set of real fields.
 *
 * `phase` distinguishes a debounced save fired while the field still has
 * focus ('typing') from the one fired on blur or an explicit commit
 * ('final') — see use-autosave-field.ts. It only changes how a not-yet-valid
 * email is reported (guidance vs. error); every other field, and every valid
 * value, behaves the same either way.
 */
export async function saveField(field: string, raw: string, phase: 'typing' | 'final' = 'final'): Promise<FieldSaveResult> {
  const session = await getSession()
  // IDEA-058 — reauthRequired here too, not just for ContributorNotFoundError
  // below: a session that's simply gone (cookie expired, cleared) is exactly
  // as unfixable by retrying as a session naming a deleted row is, and
  // deserves the same "sign in again" link rather than a dead-end message.
  if (!session.github) return { ok: false, message: 'Please sign in with GitHub first.', reauthRequired: true }

  // Narrows `field` for the persistField call below. validateField re-checks
  // this same closed set on its own (it's called elsewhere with a plain
  // string too), so this isn't the only guard — but it's what lets the
  // compiler prove the value handed to persistField is a real DetailField
  // rather than whatever a caller of this action sent.
  if (!isDetailField(field)) return { ok: false, message: 'Unknown field' }

  const validated = validateField(field, raw, phase)
  if (!validated.ok) return { ok: false, message: validated.message, guidance: validated.guidance }

  try {
    await persistField(session.github.id, field, validated.value)
    return { ok: true }
  } catch (error) {
    if (error instanceof ContributorNotFoundError) {
      // Retrying can never help here — the row this session's cookie names
      // is simply gone — so the person needs to sign in again, not wait a
      // moment and try the same save.
      console.error(`saveField(${field}) failed: contributor row is gone for this session`, error)
      return { ok: false, message: REAUTH_REQUIRED_MESSAGE, reauthRequired: true }
    }
    console.error(`saveField(${field}) failed:`, error)
    return { ok: false, message: 'Could not save right now. Please try again in a moment.' }
  }
}

/**
 * IDEA-005's search, gated the same way every other server action here is —
 * signed out gets nothing rather than an error, since a search box has no
 * business being usable before sign-in in the first place (Main redirects
 * a signed-out visitor to the sign-in prompt before this could ever be
 * called, but the action itself doesn't trust that).
 *
 * IDEA-110 — loads the caller's own row to compute their Admin role, the
 * same `caller`/`isAdmin` pattern admin/actions.ts uses, and passes it to
 * searchContributors as the viewer: a locked Telegram/LinkedIn must not be
 * matchable for anyone but an Admin or the handle's own owner.
 */
export async function searchContributorsAction(query: string): Promise<ContributorSearchResult[]> {
  const session = await getSession()
  if (!session.github) return []
  const caller = await findByGithubId(session.github.id)
  return searchContributors(query, { githubId: session.github.id, isAdmin: caller ? isAdmin(caller) : false })
}

/**
 * IDEA-110's padlock toggle next to Telegram/LinkedIn on /profile —
 * autosaves immediately on click, same shape as saveField above, just with
 * a boolean instead of a typed value. `field` is a plain string for the
 * same reason saveField's own comment gives: a `'use server'` action is an
 * HTTP endpoint, reachable with whatever value a caller sends regardless of
 * what the client's build-time type says.
 *
 * The *subject* is always `session.github.id`, never anything the client
 * sends — this is a privacy control, so it must not be settable for
 * someone else's row no matter what a crafted request claims.
 */
export async function setFieldVisibilityAction(
  field: string,
  adminsOnly: boolean,
): Promise<{ ok: boolean; message?: string; reauthRequired?: boolean }> {
  const session = await getSession()
  if (!session.github) return { ok: false, message: 'Please sign in with GitHub first.', reauthRequired: true }

  if (!isOptionalProfileField(field)) return { ok: false, message: 'Unknown field' }

  try {
    await setOptionalFieldVisibility(session.github.id, field, adminsOnly)
    return { ok: true }
  } catch (error) {
    if (error instanceof ContributorNotFoundError) {
      console.error(`setFieldVisibilityAction(${field}) failed: contributor row is gone for this session`, error)
      return { ok: false, message: REAUTH_REQUIRED_MESSAGE, reauthRequired: true }
    }
    console.error(`setFieldVisibilityAction(${field}) failed:`, error)
    return { ok: false, message: 'Could not save right now. Please try again in a moment.' }
  }
}

/**
 * IDEA-047's "Hide" control — only ever shown on the client for an item
 * already in its done state (see OnboardingChecklist), and not re-checked
 * here: hiding an item that's still todo only ever affects that same
 * contributor's own view of their own checklist, the same "not a security
 * boundary" reasoning hideChecklistItem's own doc comment gives.
 */
export async function hideChecklistItemAction(item: ChecklistItem): Promise<{ ok: boolean }> {
  const session = await getSession()
  if (!session.github) return { ok: false }
  await hideChecklistItem(session.github.id, item)
  return { ok: true }
}
