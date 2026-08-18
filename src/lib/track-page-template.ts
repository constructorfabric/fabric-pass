import MarkdownIt from 'markdown-it'
import { pool } from '@/lib/db'
import { ARTIFACT_LINK_CATEGORY_LABELS, type ArtifactLink } from '@/lib/artifact-links'
import type { TrackRepository } from '@/lib/tracks'

// `html: false` — the template and every value substituted into it come
// from cf-internal (admin-edited, trusted the same way tracks.yaml already
// is), but there's no reason to let raw HTML through a *markdown* template
// when nothing here needs it. `linkify: true` turns a bare URL substituted
// into a placeholder (e.g. a repository with no description) into a real
// link rather than plain text.
const markdown = new MarkdownIt({ html: false, linkify: true })

/** IDEA-035's one shared template — a singleton row, not one per track (see
 * migrations/014_track_page_template.sql's module doc). `null` before the
 * first sync has ever landed. */
export async function getTrackPageTemplate(): Promise<string | null> {
  const { rows } = await pool.query<{ content: string }>('SELECT content FROM track_page_template WHERE id = true')
  return rows[0]?.content ?? null
}

/** pass/track-page.md -> DB, one-way — same reasoning as syncTracks/
 * syncArtifactLinks (nothing here is self-reported by any one
 * contributor). Upsert against the singleton row rather than delete+insert,
 * since there's exactly one row by construction (the table's own PK
 * constraint). */
export async function syncTrackPageTemplate(content: string): Promise<void> {
  await pool.query(
    `INSERT INTO track_page_template (id, content, updated_at) VALUES (true, $1, now())
       ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
    [content],
  )
}

export interface TrackPageLeader {
  role: string
  name: string
  /** IDEA-055 — link to the leader's existing public profile page
   * (`/contributors/{hash}`, see contributors.ts's getPublicProfile). A
   * leader whose contributor row somehow has no profile still renders,
   * just as plain text — see track-page rendering below. */
  profileUrl?: string
}

export interface TrackPageData {
  name: string
  description?: string
  leaders: TrackPageLeader[]
  repositories: TrackRepository[]
  artifactLinks: ArtifactLink[]
}

/** Turns a list into a markdown bullet block, or a plain italic fallback
 * line when there's nothing to list — never an empty section, which would
 * read as the template having a blank spot rather than "genuinely none
 * yet". */
function bulletList(items: string[], emptyMessage: string): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : `_${emptyMessage}_`
}

/**
 * Substitutes a track's data into the shared template and renders the
 * result to HTML. Deliberately flat placeholders only (`{{name}}`,
 * `{{description}}`, `{{leaders}}`, `{{repositories}}`, `{{artifact_links}}`)
 * — no loop/conditional syntax in the template itself. The three list-shaped
 * fields are pre-rendered as markdown bullet lists *before* substitution
 * (bulletList above), so a Track/Org Admin editing pass/track-page.md only
 * ever needs to know a handful of named placeholders, not a templating
 * language.
 */
export function renderTrackPage(template: string, data: TrackPageData): string {
  const leaders = bulletList(
    data.leaders.map((leader) =>
      leader.profileUrl ? `**${leader.role}:** [${leader.name}](${leader.profileUrl})` : `**${leader.role}:** ${leader.name}`,
    ),
    'No leaders assigned yet',
  )
  const repositories = bulletList(
    data.repositories.map((repo) => {
      const label = repo.description ?? repo.url
      const issueLink = repo.issueTracker ? ` ([issues](${repo.issueTracker}))` : ''
      return `[${label}](${repo.url})${issueLink}`
    }),
    'No repositories listed yet',
  )
  const artifactLinks = bulletList(
    data.artifactLinks.map((link) => `**${ARTIFACT_LINK_CATEGORY_LABELS[link.category]}:** [${link.label}](${link.url})`),
    'No links yet',
  )

  const substituted = template
    .replaceAll('{{name}}', data.name)
    .replaceAll('{{description}}', data.description ?? '')
    .replaceAll('{{leaders}}', leaders)
    .replaceAll('{{repositories}}', repositories)
    .replaceAll('{{artifact_links}}', artifactLinks)

  return markdown.render(substituted)
}
