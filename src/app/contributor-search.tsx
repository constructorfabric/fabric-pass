'use client'

import { Input, Label } from '@gears-frontx/ui-kit'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { searchContributorsAction } from './actions'
import type { ContributorSearchResult } from '@/lib/contributors'
import { SearchMark } from './marks'

/** Snappier than autosave's 600ms debounce (use-autosave-field.ts) — this is
 * read-as-you-type feedback, not a write that needs to avoid firing on
 * every keystroke for its own sake. */
const DEBOUNCE_MS = 250
const MIN_QUERY_LENGTH = 3

export function ContributorSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ContributorSearchResult[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Guards against a slower, earlier search's response landing after a
  // faster, later one and clobbering it with stale results — the same class
  // of race use-autosave-field.ts's SaveQueue exists to prevent, just for a
  // read instead of a write.
  const latestQuery = useRef('')

  useEffect(() => {
    clearTimeout(timer.current)
    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([])
      return
    }
    timer.current = setTimeout(() => {
      latestQuery.current = trimmed
      searchContributorsAction(trimmed).then((found) => {
        if (latestQuery.current === trimmed) setResults(found)
      })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer.current)
  }, [query])

  return (
    <div className="contributor-search">
      <Label htmlFor="contributor-search" className="form-label">
        Find a contributor
      </Label>
      {/* type="search" carries the searchbox role; the magnifier is the
          kit Input's decorative icon slot, not part of the accessible name. */}
      <Input
        id="contributor-search"
        type="search"
        icon={<SearchMark />}
        placeholder="Search by name, email, or username…"
        value={query}
        onValueChange={setQuery}
        autoComplete="off"
      />
      {results.length > 0 ? (
        <ul className="search-results">
          {results.map((result) => (
            <li key={result.hash}>
              <Link href={`/contributors/${result.hash}`} className="search-result-link">
                <span>
                  {result.name}
                  {result.company ? <span className="search-result-company"> · {result.company}</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : query.trim().length >= MIN_QUERY_LENGTH ? (
        <p className="search-empty">No matches.</p>
      ) : null}
    </div>
  )
}
