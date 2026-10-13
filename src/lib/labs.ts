import { pool } from '@/lib/db'
import type { ContributorStatus } from '@/lib/contributors'
import { dedupeRepositories, type LabCandidate, type LabInput, type LabRepository, type LabRole } from '@/lib/lab-input'

export {
  isLabRole,
  isValidLabSlug,
  LAB_ROLE_LABELS,
  LAB_ROLES,
  normalizeLabInput,
  parseRepositoryUrl,
  slugifyLabName,
} from '@/lib/lab-input'
export type { LabCandidate, LabInput, LabRepository, LabRole } from '@/lib/lab-input'

/**
 * IDEA-156 — a Lab: a standalone research or prototyping effort, one or
 * more repositories outside every track, with its own Leaders and
 * Maintainers. Created and edited by a Fabric Admin at /admin/labs; this
 * app's database is the source of truth, exported one-way to cf-internal's
 * pass/labs.yaml (labs-registry.ts) — the opposite direction from tracks,
 * which are hand-edited in pass/tracks.yaml and synced in.
 */

export interface LabPerson {
  githubId: string
  githubLogin: string
  name?: string
  role: LabRole
  /** A public profile only resolves for a `confirmed` contributor — the
   * page links out only then, same convention as the Track Leaders page. */
  contributorStatus: ContributorStatus
  profileHash: string
}

export interface Lab {
  id: string
  slug: string
  name: string
  description?: string
  repositories: LabRepository[]
  /** Leaders first, then Maintainers; alphabetical by login within each. */
  people: LabPerson[]
  createdAt: Date
  updatedAt: Date
}

interface LabRow {
  id: string
  slug: string
  name: string
  description: string | null
  repositories: unknown
  created_at: Date
  updated_at: Date
}

interface LabPersonRow {
  lab_id: string
  github_id: string
  github_login: string
  name: string | null
  role: LabRole
  contributor_status: ContributorStatus
  profile_hash: string
}

function toLab(row: LabRow, people: LabPerson[]): Lab {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? undefined,
    // jsonb comes back already-parsed from `pg` — cast, not JSON.parse.
    repositories: (row.repositories as LabRepository[] | null) ?? [],
    people,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function peopleByLabId(labIds: string[]): Promise<Map<string, LabPerson[]>> {
  const byLab = new Map<string, LabPerson[]>(labIds.map((labId) => [labId, []]))
  if (labIds.length === 0) return byLab

  const { rows } = await pool.query<LabPersonRow>(
    `SELECT lp.lab_id, lp.github_id::text AS github_id, c.github_login, c.name, lp.role,
            c.status AS contributor_status, md5(c.id::text) AS profile_hash
       FROM lab_people lp
       JOIN contributors c ON c.github_id = lp.github_id
      WHERE lp.lab_id = ANY($1)
      ORDER BY CASE lp.role WHEN 'leader' THEN 0 ELSE 1 END, lower(c.github_login)`,
    [labIds],
  )
  for (const row of rows) {
    byLab.get(row.lab_id)?.push({
      githubId: row.github_id,
      githubLogin: row.github_login,
      name: row.name ?? undefined,
      role: row.role,
      contributorStatus: row.contributor_status,
      profileHash: row.profile_hash,
    })
  }
  return byLab
}

export async function listLabs(): Promise<Lab[]> {
  const { rows } = await pool.query<LabRow>('SELECT * FROM labs ORDER BY lower(name), slug')
  const people = await peopleByLabId(rows.map((row) => row.id))
  return rows.map((row) => toLab(row, people.get(row.id) ?? []))
}

export async function findLabBySlug(slug: string): Promise<Lab | null> {
  const { rows } = await pool.query<LabRow>('SELECT * FROM labs WHERE slug = $1', [slug])
  const row = rows[0]
  if (!row) return null
  const people = await peopleByLabId([row.id])
  return toLab(row, people.get(row.id) ?? [])
}

/** The slug is already a Lab's or a track's — both name GitHub teams on the
 * same `{slug}-…` convention, so they share one namespace. */
export class LabSlugTakenError extends Error {}

export async function createLab(slug: string, input: LabInput): Promise<Lab> {
  const { rows: tracks } = await pool.query('SELECT 1 FROM tracks WHERE slug = $1', [slug])
  if (tracks.length > 0) throw new LabSlugTakenError(slug)

  const { rows } = await pool.query<LabRow>(
    `INSERT INTO labs (slug, name, description, repositories)
          VALUES ($1, $2, $3, $4)
     ON CONFLICT (slug) DO NOTHING
     RETURNING *`,
    [slug, input.name, input.description ?? null, JSON.stringify(dedupeRepositories(input.repositories))],
  )
  if (rows.length === 0) throw new LabSlugTakenError(slug)
  return toLab(rows[0], [])
}

/** Name, description and repositories — everything but the slug, which is
 * fixed at creation. Returns the Lab as it was before the write, so the
 * caller can log what changed (and, for IDEA-157, which repositories were
 * added or dropped); `null` when no Lab has this id. */
export async function updateLab(labId: string, input: LabInput): Promise<Lab | null> {
  const { rows: before } = await pool.query<LabRow>('SELECT * FROM labs WHERE id = $1', [labId])
  if (before.length === 0) return null

  await pool.query(
    `UPDATE labs SET name = $2, description = $3, repositories = $4, updated_at = now() WHERE id = $1`,
    [labId, input.name, input.description ?? null, JSON.stringify(dedupeRepositories(input.repositories))],
  )
  return toLab(before[0], [])
}

/** Deletes the Lab and, by cascade, every Leader/Maintainer row on it.
 * Returns the Lab as it was, people included, so the caller can log it and
 * revoke whatever access those people held through it. */
export async function deleteLab(labId: string): Promise<Lab | null> {
  const { rows } = await pool.query<LabRow>('SELECT * FROM labs WHERE id = $1', [labId])
  if (rows.length === 0) return null
  const people = await peopleByLabId([labId])
  await pool.query('DELETE FROM labs WHERE id = $1', [labId])
  return toLab(rows[0], people.get(labId) ?? [])
}

/**
 * Puts one person on a Lab with the given role, or switches the role they
 * already hold. Returns the role they held before (`null` when they weren't
 * on the Lab), so the caller can tell an add from a role change from a
 * no-op. `added_by_github_id` and `added_at` record the latest decision.
 */
export async function setLabPerson(
  labId: string,
  githubId: string,
  role: LabRole,
  decidedByGithubId: string,
): Promise<LabRole | null> {
  const { rows: before } = await pool.query<{ role: LabRole }>(
    'SELECT role FROM lab_people WHERE lab_id = $1 AND github_id = $2',
    [labId, githubId],
  )
  const previous = before[0]?.role ?? null
  if (previous === role) return previous

  await pool.query(
    `INSERT INTO lab_people (lab_id, github_id, role, added_by_github_id)
          VALUES ($1, $2, $3, $4)
     ON CONFLICT (lab_id, github_id) DO UPDATE
       SET role = EXCLUDED.role, added_at = now(), added_by_github_id = EXCLUDED.added_by_github_id`,
    [labId, githubId, role, decidedByGithubId],
  )
  await pool.query('UPDATE labs SET updated_at = now() WHERE id = $1', [labId])
  return previous
}

/** Takes one person off a Lab. Returns the role they held, or `null` when
 * they weren't on it (nothing to log, nothing to revoke). */
export async function removeLabPerson(labId: string, githubId: string): Promise<LabRole | null> {
  const { rows } = await pool.query<{ role: LabRole }>(
    'DELETE FROM lab_people WHERE lab_id = $1 AND github_id = $2 RETURNING role',
    [labId, githubId],
  )
  if (rows.length === 0) return null
  await pool.query('UPDATE labs SET updated_at = now() WHERE id = $1', [labId])
  return rows[0].role
}

/**
 * The people picker on a Lab's page — Admin-only, so unlike
 * contributors.ts's searchContributors it returns the github id and login
 * (what assigning someone needs) and has no hidden-handle guard to apply:
 * it matches on name and login only. `confirmed` contributors only — a
 * Lab's Leaders and Maintainers get org access through it (IDEA-157), the
 * same population an Admin's Confirm already vetted.
 */
export async function searchLabCandidates(query: string): Promise<LabCandidate[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  const { rows } = await pool.query<{ github_id: string; github_login: string; name: string | null }>(
    `SELECT github_id::text AS github_id, github_login, name
       FROM contributors
      WHERE status = 'confirmed' AND (github_login ILIKE $1 OR name ILIKE $1)
      ORDER BY CASE WHEN github_login ILIKE $2 OR name ILIKE $2 THEN 0 ELSE 1 END, lower(github_login)
      LIMIT 8`,
    [`%${trimmed}%`, `${trimmed}%`],
  )
  return rows.map((row) => ({ githubId: row.github_id, githubLogin: row.github_login, name: row.name ?? undefined }))
}

/** Whether this github id belongs to a contributor who may be put on a Lab —
 * the server-side re-check behind the picker above. */
export async function isLabCandidate(githubId: string): Promise<boolean> {
  const { rows } = await pool.query("SELECT 1 FROM contributors WHERE github_id = $1 AND status = 'confirmed'", [
    githubId,
  ])
  return rows.length > 0
}
