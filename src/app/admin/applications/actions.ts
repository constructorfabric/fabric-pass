'use server'

import { createApplication, regenerateApplicationApiKey } from '@/lib/applications'
import { findByGithubId } from '@/lib/contributors'
import { isAdmin } from '@/lib/roles'
import { getSession } from '@/lib/session'

export interface CreateApplicationResult {
  ok: boolean
  message?: string
  application?: { id: string; name: string; contactName: string; contactEmail: string }
}

/** IDEA-121's "register a new application" — Admin-only, same
 * authorization re-check every other admin action in this app does
 * server-side, since the page's own gate only keeps this out of an
 * unauthorized browser's UI, not out of a direct call to the action. */
export async function createApplicationAction(name: string, contactName: string, contactEmail: string): Promise<CreateApplicationResult> {
  const session = await getSession()
  if (!session.github) return { ok: false, message: 'Please sign in with GitHub first.' }

  const caller = await findByGithubId(session.github.id)
  if (!caller || !isAdmin(caller)) return { ok: false, message: 'Not authorized.' }

  const trimmedName = name.trim()
  const trimmedContactName = contactName.trim()
  const trimmedContactEmail = contactEmail.trim()
  if (!trimmedName || !trimmedContactName || !trimmedContactEmail) {
    return { ok: false, message: 'Name, contact name, and contact email are all required.' }
  }

  try {
    const application = await createApplication(trimmedName, trimmedContactName, trimmedContactEmail)
    return {
      ok: true,
      application: {
        id: application.id,
        name: application.name,
        contactName: application.contactName,
        contactEmail: application.contactEmail,
      },
    }
  } catch (error) {
    console.error('createApplicationAction failed:', error)
    return { ok: false, message: 'Could not create this application right now. Please try again in a moment.' }
  }
}

export interface RegenerateApplicationApiKeyResult {
  ok: boolean
  message?: string
  key?: string
  maskedKey?: string
  createdAt?: string
}

/** IDEA-121's Generate/Regenerate for an application's own key — same
 * shape as IDEA-119's `regenerateApiKeyAction`, just keyed on
 * `applicationId` instead of the caller's own session. */
export async function regenerateApplicationApiKeyAction(applicationId: string): Promise<RegenerateApplicationApiKeyResult> {
  const session = await getSession()
  if (!session.github) return { ok: false, message: 'Please sign in with GitHub first.' }

  const caller = await findByGithubId(session.github.id)
  if (!caller || !isAdmin(caller)) return { ok: false, message: 'Not authorized.' }

  try {
    const { key, apiKey } = await regenerateApplicationApiKey(applicationId)
    return { ok: true, key, maskedKey: apiKey.maskedKey, createdAt: apiKey.createdAt.toISOString() }
  } catch (error) {
    console.error(`regenerateApplicationApiKeyAction(${applicationId}) failed:`, error)
    return { ok: false, message: 'Could not generate a key right now. Please try again in a moment.' }
  }
}
