'use client'

import { Badge, Card, CardHeader, CardTitle, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@gears-frontx/ui-kit'
import { useMemo, useState } from 'react'
import { ExternalLinkMark } from '@/app/marks'

interface RepositoryRow {
  name: string
  htmlUrl: string
  archived: boolean
  type: string | null
  track: string | null
}

/** `'all'` plus one entry per allowed value — same shape as
 * admin-contributor-table.tsx's own STATUS_FILTER_ITEMS/
 * COMPLETENESS_FILTER_ITEMS (`'all'` labelled with the filter's own name,
 * matching the kit Select's "closed trigger needs its label without
 * opening the popup" requirement). */
const ALL = 'all'

function filterItems(label: string, allowedValues: string[]) {
  return [{ value: ALL, label }, ...allowedValues.map((value) => ({ value, label: value }))]
}

/**
 * IDEA-107 — the same client-side-filter-what's-already-loaded pattern as
 * admin-contributor-table.tsx: search reuses `.admin-filters`/
 * `.admin-filter-input`, the two label filters reuse the same
 * `variant="filter"` kit Select shape, and the list reuses `.admin-tiles`
 * (this app has no table anywhere — IDEA-036 replaced one on purpose).
 * Each tile is audit-log/page.tsx's lightest-weight Card shape: a
 * `CardTitle` and one `.admin-tile-properties` row, no `CardContent`/
 * `CardFooter` — there's nothing here to act on, only to view and follow
 * out to GitHub.
 */
export function RepositoriesTable({
  repositories,
  typeOptions,
  trackOptions,
}: {
  repositories: RepositoryRow[]
  typeOptions: string[]
  trackOptions: string[]
}) {
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState(ALL)
  const [trackFilter, setTrackFilter] = useState(ALL)

  const typeItems = useMemo(() => filterItems('Type', typeOptions), [typeOptions])
  const trackItems = useMemo(() => filterItems('Track', trackOptions), [trackOptions])

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    return repositories.filter((repo) => {
      if (typeFilter !== ALL && repo.type !== typeFilter) return false
      if (trackFilter !== ALL && repo.track !== trackFilter) return false
      if (!trimmed) return true
      return repo.name.toLowerCase().includes(trimmed)
    })
  }, [repositories, query, typeFilter, trackFilter])

  return (
    <>
      <div className="admin-filters">
        <Input
          type="text"
          className="admin-filter-input"
          placeholder="Filter by repository name…"
          value={query}
          onValueChange={setQuery}
          autoComplete="off"
        />
        <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as string)} items={typeItems}>
          <SelectTrigger variant="filter" aria-label="Filter by Type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {typeItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={trackFilter} onValueChange={(value) => setTrackFilter(value as string)} items={trackItems}>
          <SelectTrigger variant="filter" aria-label="Filter by Track">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {trackItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {filtered.length === 0 ? (
        <p className="search-empty">No repositories match.</p>
      ) : (
        <div className="admin-tiles">
          {filtered.map((repo) => (
            <Card size="sm" key={repo.name}>
              <CardHeader>
                <CardTitle>
                  <h3 className="card-heading">
                    <a className="repo-name-link" href={`${repo.htmlUrl}/settings`} target="_blank" rel="noreferrer">
                      {repo.name}
                      <ExternalLinkMark size={14} />
                    </a>
                  </h3>
                </CardTitle>
                <div className="admin-tile-properties">
                  <Badge variant="muted">Type: {repo.type ?? 'Not set'}</Badge>
                  <Badge variant="muted">Track: {repo.track ?? 'Not set'}</Badge>
                  {repo.archived ? <Badge variant="warning">Archived</Badge> : null}
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
