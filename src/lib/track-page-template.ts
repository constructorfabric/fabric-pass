import MarkdownIt from 'markdown-it'
import { pool } from '@/lib/db'
import {
  ARTIFACT_LINK_CATEGORIES,
  ARTIFACT_LINK_CATEGORY_LABELS,
  type ArtifactLink,
  type ArtifactLinkCategory,
} from '@/lib/artifact-links'
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
 * IDEA-057 — one placeholder per category (`{{links_vision}}`,
 * `{{links_roadmap}}`, `{{links_guide}}`, ...) rather than a single bundled
 * `{{artifact_links}}` blob rendered in ARTIFACT_LINK_CATEGORIES' fixed
 * order. pass/track-page.md places each placeholder wherever it wants —
 * Vision before Repositories, Documentation after, whatever a given track
 * page calls for — instead of section order being dictated by the category
 * enum. A category with no links for this scope substitutes to an empty
 * string (the placeholder, and its own `### {label}` heading, simply
 * vanish) rather than showing a "no links" placeholder — matches how an
 * unused category was already invisible before this split, just per-section
 * instead of per-bundle. A template that doesn't reference a given
 * category's placeholder at all just never shows that category, the same
 * way a template that omits `{{leaders}}` already never shows leaders.
 */
function renderLinksForCategory(links: ArtifactLink[], category: ArtifactLinkCategory): string {
  const inCategory = links.filter((link) => link.category === category)
  if (inCategory.length === 0) return ''
  const items = bulletList(
    inCategory.map((link) => `[${link.label}](${link.url})`),
    '',
  )
  return `### ${ARTIFACT_LINK_CATEGORY_LABELS[category]}\n\n${items}`
}

/** Repo name is the URL's last path segment (e.g. `.../gears-rust` ->
 * `gears-rust`) — pass/tracks.yaml only ever gives a URL, never a separate
 * name field, so this is the only name there is to show. A `|` in a
 * description would otherwise break the table's row syntax — escaped
 * defensively even though cf-internal content is trusted, same spirit as
 * IDEA-057's other markdown-generation here. */
function repositoryName(url: string): string {
  return url.replace(/\/+$/, '').split('/').pop() || url
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

/** IDEA-057 — a two-column table (Repository, Description) rather than a
 * bulleted list of description-only links, so a repository with no
 * description still shows its name instead of a bare URL as the link text. */
function renderRepositoriesTable(repositories: TrackRepository[]): string {
  if (repositories.length === 0) return '_No repositories listed yet_'

  const rows = repositories.map((repo) => {
    const issueLink = repo.issueTracker ? ` ([issues](${repo.issueTracker}))` : ''
    const repositoryCell = `[${escapeTableCell(repositoryName(repo.url))}](${repo.url})${issueLink}`
    const descriptionCell = repo.description ? escapeTableCell(repo.description) : ''
    return `| ${repositoryCell} | ${descriptionCell} |`
  })

  return ['| Repository | Description |', '| --- | --- |', ...rows].join('\n')
}

/**
 * Substitutes a track's data into the shared template and renders the
 * result to HTML. Deliberately flat placeholders only (`{{name}}`,
 * `{{description}}`, `{{leaders}}`, `{{repositories}}`, and one
 * `{{links_<category>}}` per ARTIFACT_LINK_CATEGORIES entry) — no
 * loop/conditional syntax in the template itself. Every field is
 * pre-rendered as markdown *before* substitution (bulletList/
 * renderLinksForCategory/renderRepositoriesTable above), so a Track/Org
 * Admin editing pass/track-page.md only ever needs to know a handful of
 * named placeholders, not a templating language. The `links_*` placeholders
 * are the one exception to "flat": each substituted value carries its own
 * `###` subheading (see renderLinksForCategory), so pass/track-page.md
 * places them directly with no wrapping heading of its own.
 */
export function renderTrackPage(template: string, data: TrackPageData): string {
  const leaders = bulletList(
    data.leaders.map((leader) =>
      leader.profileUrl ? `**${leader.role}:** [${leader.name}](${leader.profileUrl})` : `**${leader.role}:** ${leader.name}`,
    ),
    'No leaders assigned yet',
  )
  const repositories = renderRepositoriesTable(data.repositories)

  let substituted = template
    .replaceAll('{{name}}', data.name)
    .replaceAll('{{description}}', data.description ?? '')
    .replaceAll('{{leaders}}', leaders)
    .replaceAll('{{repositories}}', repositories)

  for (const category of ARTIFACT_LINK_CATEGORIES) {
    substituted = substituted.replaceAll(`{{links_${category}}}`, renderLinksForCategory(data.artifactLinks, category))
  }

  return markdown.render(substituted)
}
