'use server'

import { logAdminAction } from '@/lib/audit-log'
import { findByGithubId } from '@/lib/contributors'
import { grantLabAccess, revokeDeletedLabAccess, revokeLabAccess, syncLabRepositories } from '@/lib/lab-access'
import {
  createLab,
  deleteLab,
  findLabBySlug,
  isLabCandidate,
  isLabRole,
  isValidLabSlug,
  LabSlugTakenError,
  normalizeLabInput,
  removeLabPerson,
  searchLabCandidates,
  setLabPerson,
  updateLab,
  type Lab,
  type LabCandidate,
} from '@/lib/labs'
import { isAdmin } from '@/lib/roles'
import { getSession } from '@/lib/session'
import { REAUTH_REQUIRED_MESSAGE } from '@/app/auth/notice'
import { toLabView, type LabView } from './lab-view'

export interface LabActionResult {
  ok: boolean
  message?: string
  reauthRequired?: boolean
  lab?: LabView
}

const TRY_AGAIN = 'Please try again in a moment.'

/** Session + Admin gate shared by every Lab action — the pages' own gate
 * keeps the controls out of a non-Admin's browser, but an action is an
 * HTTP endpoint and re-checks regardless. */
async function authorize(): Promise<{ callerGithubId: string } | { failure: LabActionResult }> {
  const session = await getSession()
  if (!session.github) {
    return { failure: { ok: false, message: 'Please sign in with GitHub first.', reauthRequired: true } }
  }
  const caller = await findByGithubId(session.github.id)
  if (!caller) return { failure: { ok: false, message: REAUTH_REQUIRED_MESSAGE, reauthRequired: true } }
  if (!isAdmin(caller)) return { failure: { ok: false, message: 'Not authorized.' } }
  return { callerGithubId: caller.githubId }
}

async function authorizeLab(slug: unknown): Promise<{ callerGithubId: string; lab: Lab } | { failure: LabActionResult }> {
  const gate = await authorize()
  if ('failure' in gate) return gate
  const lab = typeof slug === 'string' ? await findLabBySlug(slug) : null
  if (!lab) return { failure: { ok: false, message: 'This Lab no longer exists.' } }
  return { ...gate, lab }
}

/** What an audit entry needs to keep naming the Lab after it's renamed or
 * deleted — see audit-log.ts's 'lab_*' doc comment. */
function labDetails(lab: Pick<Lab, 'slug' | 'name'>) {
  return { lab: lab.slug, labName: lab.name }
}

async function freshView(slug: string): Promise<LabView | undefined> {
  const lab = await findLabBySlug(slug)
  return lab ? toLabView(lab) : undefined
}

export async function createLabAction(slug: unknown, form: unknown): Promise<LabActionResult> {
  const gate = await authorize()
  if ('failure' in gate) return gate.failure

  const trimmedSlug = typeof slug === 'string' ? slug.trim() : ''
  if (!isValidLabSlug(trimmedSlug)) {
    return { ok: false, message: 'The slug must be lowercase letters and digits, words joined by single hyphens.' }
  }
  const normalized = normalizeLabInput(form)
  if (!normalized.ok) return { ok: false, message: normalized.message }

  let lab: Lab
  try {
    lab = await createLab(trimmedSlug, normalized.input)
  } catch (error) {
    if (error instanceof LabSlugTakenError) {
      return { ok: false, message: `"${trimmedSlug}" is already used by a Lab or a track. Choose another slug.` }
    }
    console.error(`createLabAction(${trimmedSlug}) failed:`, error)
    return { ok: false, message: `Could not create this Lab right now. ${TRY_AGAIN}` }
  }

  await logAdminAction({ actorGithubId: gate.callerGithubId, action: 'lab_create', details: labDetails(lab) })
  return { ok: true, lab: toLabView(lab) }
}

export async function updateLabAction(slug: unknown, form: unknown): Promise<LabActionResult> {
  const gate = await authorizeLab(slug)
  if ('failure' in gate) return gate.failure
  const { callerGithubId, lab } = gate

  const normalized = normalizeLabInput(form)
  if (!normalized.ok) return { ok: false, message: normalized.message }
  const { input } = normalized

  try {
    await updateLab(lab.id, input)
  } catch (error) {
    console.error(`updateLabAction(${lab.slug}) failed:`, error)
    return { ok: false, message: `Could not save this Lab right now. ${TRY_AGAIN}` }
  }

  const changed = [
    lab.name !== input.name ? 'name' : null,
    (lab.description ?? '') !== (input.description ?? '') ? 'description' : null,
    JSON.stringify(lab.repositories) !== JSON.stringify(input.repositories) ? 'repositories' : null,
  ].filter((field): field is string => field !== null)

  if (changed.length > 0) {
    await logAdminAction({
      actorGithubId: callerGithubId,
      action: 'lab_update',
      details: { ...labDetails({ slug: lab.slug, name: input.name }), changed },
    })
  }

  // IDEA-157 — best-effort, after the write and the log: grant both teams
  // any newly listed repository, take away any dropped one.
  if (changed.includes('repositories')) {
    const roles = [...new Set(lab.people.map((person) => person.role))]
    await syncLabRepositories({ slug: lab.slug, repositories: input.repositories, roles }, lab.repositories)
  }
  return { ok: true, lab: await freshView(lab.slug) }
}

export async function deleteLabAction(slug: unknown): Promise<LabActionResult> {
  const gate = await authorizeLab(slug)
  if ('failure' in gate) return gate.failure
  const { callerGithubId, lab } = gate

  try {
    await deleteLab(lab.id)
  } catch (error) {
    console.error(`deleteLabAction(${lab.slug}) failed:`, error)
    return { ok: false, message: `Could not delete this Lab right now. ${TRY_AGAIN}` }
  }

  await logAdminAction({ actorGithubId: callerGithubId, action: 'lab_delete', details: labDetails(lab) })

  // IDEA-157 — everyone leaves their team, both teams lose the repositories.
  const people = []
  for (const person of lab.people) {
    const contributor = await findByGithubId(person.githubId)
    if (contributor) people.push({ contributor, role: person.role })
  }
  await revokeDeletedLabAccess(lab, people)
  return { ok: true }
}

/** Adds a contributor to the Lab with the given role, or switches the role
 * they already hold there — one action for both, since a person holds
 * exactly one role on a Lab (migrations/041_labs.sql's primary key). */
export async function setLabPersonAction(slug: unknown, githubId: unknown, role: unknown): Promise<LabActionResult> {
  const gate = await authorizeLab(slug)
  if ('failure' in gate) return gate.failure
  const { callerGithubId, lab } = gate

  if (typeof role !== 'string' || !isLabRole(role)) return { ok: false, message: 'Unknown Lab role.' }
  if (typeof githubId !== 'string' || !/^\d+$/.test(githubId) || !(await isLabCandidate(githubId))) {
    return { ok: false, message: 'Only confirmed contributors can be put on a Lab.' }
  }

  let previous
  try {
    previous = await setLabPerson(lab.id, githubId, role, callerGithubId)
  } catch (error) {
    console.error(`setLabPersonAction(${lab.slug}, ${githubId}, ${role}) failed:`, error)
    return { ok: false, message: `Could not update this Lab right now. ${TRY_AGAIN}` }
  }

  if (previous !== role) {
    await logAdminAction({
      actorGithubId: callerGithubId,
      action: previous ? 'lab_change_role' : 'lab_add_person',
      targetGithubId: githubId,
      details: previous ? { ...labDetails(lab), from: previous, to: role } : { ...labDetails(lab), role },
    })

    // IDEA-157 — the role's GitHub team (plus an org invite if they were
    // never sent one); on a switch, out of the old role's team.
    const contributor = await findByGithubId(githubId)
    if (contributor) await grantLabAccess(contributor, lab, role, previous)
  }
  return { ok: true, lab: await freshView(lab.slug) }
}

export async function removeLabPersonAction(slug: unknown, githubId: unknown): Promise<LabActionResult> {
  const gate = await authorizeLab(slug)
  if ('failure' in gate) return gate.failure
  const { callerGithubId, lab } = gate

  if (typeof githubId !== 'string' || !/^\d+$/.test(githubId)) return { ok: false, message: 'Unknown contributor.' }

  let removed
  try {
    removed = await removeLabPerson(lab.id, githubId)
  } catch (error) {
    console.error(`removeLabPersonAction(${lab.slug}, ${githubId}) failed:`, error)
    return { ok: false, message: `Could not update this Lab right now. ${TRY_AGAIN}` }
  }

  if (removed) {
    await logAdminAction({
      actorGithubId: callerGithubId,
      action: 'lab_remove_person',
      targetGithubId: githubId,
      details: { ...labDetails(lab), role: removed },
    })

    const contributor = await findByGithubId(githubId)
    if (contributor) await revokeLabAccess(contributor, lab, removed)
  }
  return { ok: true, lab: await freshView(lab.slug) }
}

/** The people picker's search — Admin-only like everything else here; a
 * non-Admin gets an empty list rather than an error, the same quiet failure
 * searchContributorsAction gives a signed-out caller. */
export async function searchLabCandidatesAction(query: unknown): Promise<LabCandidate[]> {
  const gate = await authorize()
  if ('failure' in gate || typeof query !== 'string') return []
  return searchLabCandidates(query)
}
