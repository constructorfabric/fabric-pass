import { pool } from '@/lib/db'
import { listTracks } from '@/lib/tracks'

export const ARTIFACT_LINK_CATEGORIES = ['policy', 'vision', 'roadmap', 'schedule', 'discord', 'guide', 'other'] as const
export type ArtifactLinkCategory = (typeof ARTIFACT_LINK_CATEGORIES)[number]

/** Shared between wherever a category needs a human label — the track page
 * template's rendered links list, and any future UI — same idea as
 * profile-completeness.ts's PROFILE_COMPLETENESS_LABELS. */
export const ARTIFACT_LINK_CATEGORY_LABELS: Record<ArtifactLinkCategory, string> = {
  policy: 'Policy',
  vision: 'Vision',
  roadmap: 'Roadmap',
  schedule: 'Schedule',
  discord: 'Discord',
  guide: 'Documentation',
  other: 'Link',
}

/** The one non-track `scope` value — everything else names a real track's
 * `slug`, checked against `tracks` at sync time (see syncArtifactLinks). */
export const COMMUNITY_SCOPE = 'community'

export interface ArtifactLink {
  id: string
  scope: string
  category: ArtifactLinkCategory
  label: string
  url: string
  createdAt: Date
  updatedAt: Date
}

interface ArtifactLinkRow {
  id: string
  scope: string
  category: ArtifactLinkCategory
  label: string
  url: string
  created_at: Date
  updated_at: Date
}

function toArtifactLink(row: ArtifactLinkRow): ArtifactLink {
  return {
    id: row.id,
    scope: row.scope,
    category: row.category,
    label: row.label,
    url: row.url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Every artifact link for one scope (`COMMUNITY_SCOPE`, or a track's
 * slug) — IDEA-006's policy list and IDEA-035's track page both call this,
 * just with a different scope. */
export async function listArtifactLinks(scope: string): Promise<ArtifactLink[]> {
  const { rows } = await pool.query<ArtifactLinkRow>(
    'SELECT * FROM artifact_links WHERE scope = $1 ORDER BY category, label',
    [scope],
  )
  return rows.map(toArtifactLink)
}

export interface ArtifactLinkSync {
  scope: string
  category: ArtifactLinkCategory
  label: string
  url: string
}

export interface ArtifactLinkSyncResult {
  synced: number
  /** A row whose `scope` names neither `COMMUNITY_SCOPE` nor a real track's
   * slug — reported, not fatal to the rest of the file's sync. */
  rejected: number
}

/**
 * pass/artifact-links.yaml -> DB, one-way (see tracks.ts's module doc for
 * the same reasoning — nothing here is self-reported by any one
 * contributor, so there's no export direction). Full-replace inside one
 * transaction: delete every existing row, insert the file's whole set — the
 * "file is the whole set" pattern applied to the entire table rather than
 * one track's admin list, since there's no natural per-row key here worth
 * building upsert-by-key matching around for something this small.
 *
 * `scope` isn't a foreign key (see migrations/013_artifact_links.sql's
 * module doc — `COMMUNITY_SCOPE` doesn't name a row in `tracks`), so it's
 * validated here in application code instead, against the tracks that
 * actually exist right now — the same skip-and-log treatment tracks.ts's
 * own syncTracks gives an unrecognized leader/admin login.
 */
export async function syncArtifactLinks(links: ArtifactLinkSync[]): Promise<ArtifactLinkSyncResult> {
  const tracks = await listTracks()
  const knownScopes = new Set<string>([COMMUNITY_SCOPE, ...tracks.map((track) => track.slug)])

  const accepted = links.filter((link) => knownScopes.has(link.scope))
  const rejected = links.length - accepted.length

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM artifact_links')
    for (const link of accepted) {
      await client.query('INSERT INTO artifact_links (scope, category, label, url) VALUES ($1, $2, $3, $4)', [
        link.scope,
        link.category,
        link.label,
        link.url,
      ])
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  return { synced: accepted.length, rejected }
}
