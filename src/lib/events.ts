import { pool } from '@/lib/db'

/**
 * IDEA-165 — community events (a workshop, a meetup) shown on Home to
 * confirmed contributors only. Owned by the `events:` list in cf-internal's
 * pass/artifact-links.yaml and synced one-way alongside the artifact links
 * themselves (see migrations/041_events.sql for why it lives there and not
 * in this public repository).
 *
 * Dates are calendar days (`YYYY-MM-DD`), not instants — an event "on
 * 16 October" is that day wherever the reader is — so they stay strings end
 * to end and never pass through a `Date` and a time zone.
 */
export interface EventRecording {
  label: string
  url: string
}

export interface CommunityEvent {
  id: string
  title: string
  startsOn: string
  endsOn: string
  place?: string
  agendaUrl?: string
  recordings: EventRecording[]
}

export interface EventSync {
  title: string
  startsOn: string
  endsOn: string
  place?: string
  agendaUrl?: string
  recordings: EventRecording[]
}

interface EventRow {
  id: string
  title: string
  starts_on: string
  ends_on: string
  place: string | null
  agenda_url: string | null
  recordings: EventRecording[]
}

/** Newest first — the event coming up next, or the one that just ended, is
 * the one a visitor is looking for. `to_char` keeps the dates as plain
 * `YYYY-MM-DD` strings instead of node-postgres's midnight-local `Date`. */
export async function listEvents(): Promise<CommunityEvent[]> {
  const { rows } = await pool.query<EventRow>(
    `SELECT id, title, to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on,
            place, agenda_url, recordings
       FROM events
      ORDER BY starts_on DESC, title`,
  )
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    place: row.place ?? undefined,
    agendaUrl: row.agenda_url ?? undefined,
    recordings: row.recordings,
  }))
}

/** File -> DB, full replace in one transaction — the same "the file is the
 * whole set" sync as syncArtifactLinks, so an event deleted from the file
 * disappears from Home on the next push. */
export async function syncEvents(events: EventSync[]): Promise<number> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM events')
    for (const event of events) {
      await client.query(
        'INSERT INTO events (title, starts_on, ends_on, place, agenda_url, recordings) VALUES ($1, $2, $3, $4, $5, $6)',
        [
          event.title,
          event.startsOn,
          event.endsOn,
          event.place ?? null,
          event.agendaUrl ?? null,
          JSON.stringify(event.recordings),
        ],
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  return events.length
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

function parts(day: string): { year: number; month: string; date: number } {
  const [year, month, date] = day.split('-').map(Number)
  return { year, month: MONTHS[month - 1], date }
}

/** "16–21 October 2026", "30 September – 2 October 2026", or
 * "29 December 2026 – 3 January 2027" — the shared parts said once.
 * Hand-rolled rather than Intl.DateTimeFormat#formatRange so the server
 * renders the same string whatever its locale and time zone. */
export function formatEventDates(startsOn: string, endsOn: string): string {
  const start = parts(startsOn)
  const end = parts(endsOn)
  if (startsOn === endsOn) return `${start.date} ${start.month} ${start.year}`
  if (start.year !== end.year) return `${start.date} ${start.month} ${start.year} – ${end.date} ${end.month} ${end.year}`
  if (start.month !== end.month) return `${start.date} ${start.month} – ${end.date} ${end.month} ${end.year}`
  return `${start.date}–${end.date} ${end.month} ${end.year}`
}

/** `today` as `YYYY-MM-DD`; an event is past once its last day is over. */
export function isPastEvent(event: Pick<CommunityEvent, 'endsOn'>, today: string): boolean {
  return event.endsOn < today
}
