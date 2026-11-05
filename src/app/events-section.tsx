import { formatEventDates, isPastEvent, type CommunityEvent } from '@/lib/events'

/**
 * IDEA-165 — Home's Events section: each event's dates and place, its
 * agenda, and one link per recording. Rendered only for a confirmed
 * contributor — page.tsx doesn't even query events for anyone else, so the
 * recording links (which carry meeting passcodes) never reach a Stranger's
 * HTML. Renders nothing when there are no events.
 */
export function EventsSection({ events, today }: { events: CommunityEvent[]; today: string }) {
  if (events.length === 0) return null

  return (
    <section className="home-events" aria-labelledby="home-events-heading">
      <h3 id="home-events-heading">Events</h3>
      <ul className="home-events-list">
        {events.map((event) => (
          <li key={event.id} className="home-event">
            <div className="home-event-head">
              <span className="home-event-title">{event.title}</span>
              {isPastEvent(event, today) ? <span className="home-event-badge">Past</span> : null}
            </div>
            <div className="home-event-meta">
              {formatEventDates(event.startsOn, event.endsOn)}
              {event.place ? ` · ${event.place}` : null}
            </div>
            {event.agendaUrl ? (
              <a className="home-event-agenda" href={event.agendaUrl} target="_blank" rel="noreferrer">
                Agenda →
              </a>
            ) : null}
            {event.recordings.length > 0 ? (
              <div className="home-event-recordings">
                <span className="home-event-recordings-label">Recordings</span>
                <ul>
                  {event.recordings.map((recording) => (
                    <li key={recording.url}>
                      <a href={recording.url} target="_blank" rel="noreferrer">
                        {recording.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
