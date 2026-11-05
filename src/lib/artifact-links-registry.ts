import { parse } from 'yaml'
import { z } from 'zod'
import { ARTIFACT_LINK_CATEGORIES, type ArtifactLinkSync } from '@/lib/artifact-links'
import type { EventSync } from '@/lib/events'

const artifactLinkRowSchema = z.object({
  scope: z.string().min(1),
  category: z.enum(ARTIFACT_LINK_CATEGORIES),
  label: z.string().min(1),
  url: z.string().min(1),
})

const registryFileSchema = z.object({
  artifact_links: z.array(z.unknown()).default([]),
  // IDEA-165 — community events, synced by the same call (see lib/events.ts).
  events: z.array(z.unknown()).default([]),
})

/** A calendar day. Quoted or not: YAML 1.1 readers turn a bare 2026-10-16
 * into a timestamp, so a `Date` is folded back to its UTC day. The
 * round-trip rejects a well-formed but impossible day like 2026-02-30 here,
 * where it costs one row, instead of in Postgres, where it would abort the
 * whole events transaction. */
const daySchema = z
  .union([z.string(), z.date().transform((date) => date.toISOString().slice(0, 10))])
  .refine((day) => /^\d{4}-\d{2}-\d{2}$/.test(day) && new Date(`${day}T00:00:00Z`).toISOString().startsWith(day))

/** Only http(s) — these end up as `href`s, and a `javascript:` URL in a
 * hand-edited file must not become a clickable link. */
const webUrlSchema = z.string().regex(/^https?:\/\/\S+$/)

const eventRowSchema = z
  .object({
    title: z.string().min(1),
    starts_on: daySchema,
    ends_on: daySchema,
    place: z.string().min(1).optional(),
    agenda_url: webUrlSchema.optional(),
    recordings: z.array(z.object({ label: z.string().min(1), url: webUrlSchema })).default([]),
  })
  .refine((event) => event.ends_on >= event.starts_on)

/**
 * pass/artifact-links.yaml -> ArtifactLinkSync[]. A row failing validation
 * (missing scope/label/url, or a category outside ARTIFACT_LINK_CATEGORIES)
 * is dropped, not thrown on — same reasoning as tracks-registry.ts's
 * parseTracksYaml: one malformed hand-edit shouldn't block every other
 * link from syncing. Whether `scope` actually names a real track (or
 * `COMMUNITY_SCOPE`) is checked later, in artifact-links.ts's
 * syncArtifactLinks — this function has no database connection to
 * validate against.
 */
export function parseArtifactLinksYaml(content: string): {
  links: ArtifactLinkSync[]
  invalidRowCount: number
  events: EventSync[]
  invalidEventCount: number
} {
  const parsed = registryFileSchema.parse(parse(content) ?? {})
  const links: ArtifactLinkSync[] = []
  let invalidRowCount = 0

  for (const raw of parsed.artifact_links) {
    const row = artifactLinkRowSchema.safeParse(raw)
    if (!row.success) {
      invalidRowCount += 1
      continue
    }
    links.push({
      scope: row.data.scope,
      category: row.data.category,
      label: row.data.label,
      url: row.data.url,
    })
  }

  // IDEA-165 — same drop-don't-throw treatment for events: a whole event
  // with any bad field (a missing title, an impossible day, a recording
  // without a url) is skipped, never half-imported.
  const events: EventSync[] = []
  let invalidEventCount = 0
  for (const raw of parsed.events) {
    const row = eventRowSchema.safeParse(raw)
    if (!row.success) {
      invalidEventCount += 1
      continue
    }
    events.push({
      title: row.data.title,
      startsOn: row.data.starts_on,
      endsOn: row.data.ends_on,
      place: row.data.place,
      agendaUrl: row.data.agenda_url,
      recordings: row.data.recordings,
    })
  }

  return { links, invalidRowCount, events, invalidEventCount }
}
