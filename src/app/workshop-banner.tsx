/** IDEA-161's invitation to the Sofia workshop — one link to its agenda,
 * shown above the header on every page. Full page width like the header and
 * footer, with its text kept in the same column via `.workshop-banner-inner`
 * (see globals.css). */
export function WorkshopBanner() {
  return (
    <aside className="workshop-banner" aria-label="Workshop">
      <div className="workshop-banner-inner">
        <a href="https://talks.cfabric.org/cf-sofia-2026/talk/">Join Workshop in Sofia →</a>
      </div>
    </aside>
  )
}
