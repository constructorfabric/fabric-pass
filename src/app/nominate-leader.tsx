'use client'

import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
} from '@gears-frontx/ui-kit'
import { useEffect, useRef, useState } from 'react'
import { ActionMessage } from '@/app/action-message'
import { SearchMark } from '@/app/marks'
import { nominateLeaderAction, searchTrackMembersAction } from '@/app/tracks/[slug]/actions'
import type { NominatableMember } from '@/lib/leader-nominations'

/** Same read-as-you-type cadence as the People screen's ContributorSearch —
 * this picker is that search restricted to one track's members. */
const DEBOUNCE_MS = 250
const MIN_QUERY_LENGTH = 3

/**
 * IDEA-018's "Nominate" action — one dialog, two surfaces: the track page
 * (next to the "no leaders yet" message there, or always-on for Admins) and
 * each track's section on the Track Leaders page. The flow is pick →
 * confirm → nominate: search the track's members (yourself included —
 * self-nomination is the same flow, picking yourself), then confirm the
 * person is being nominated *for a leader position*. A nomination is not an
 * appointment: deciding them is IDEA-150, and an Admin's own nomination
 * goes through that same review like anyone else's.
 */
export function NominateLeaderButton({
  trackSlug,
  trackName,
  variant = 'outline',
  size,
}: {
  trackSlug: string
  trackName: string
  variant?: 'default' | 'outline' | 'ghost' | 'destructive'
  size?: 'sm' | 'default' | 'lg'
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<NominatableMember[]>([])
  const [picked, setPicked] = useState<NominatableMember | null>(null)
  const [nominated, setNominated] = useState<NominatableMember | null>(null)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string>()
  const [reauthRequired, setReauthRequired] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Same stale-response race guard as ContributorSearch's latestQuery.
  const latestQuery = useRef('')

  // Controlled open so a closed dialog resets to the picker — reopening
  // after a completed nomination starts fresh rather than showing the
  // previous person's success screen.
  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setPicked(null)
      setNominated(null)
      setMessage(undefined)
      setReauthRequired(false)
    }
  }

  useEffect(() => {
    clearTimeout(timer.current)
    const trimmed = query.trim()
    if (!open || picked || trimmed.length < MIN_QUERY_LENGTH) {
      setResults([])
      return
    }
    timer.current = setTimeout(() => {
      latestQuery.current = trimmed
      searchTrackMembersAction(trackSlug, trimmed).then((found) => {
        if (latestQuery.current === trimmed) setResults(found)
      })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer.current)
  }, [query, open, picked, trackSlug])

  async function nominate() {
    if (!picked) return
    setPending(true)
    setMessage(undefined)
    setReauthRequired(false)
    const result = await nominateLeaderAction(trackSlug, picked.githubId)
    setPending(false)
    if (!result.ok) {
      setMessage(result.message)
      setReauthRequired(Boolean(result.reauthRequired))
      return
    }
    setNominated(picked)
    setPicked(null)
    setQuery('')
    setMessage(result.message)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button
            variant={variant}
            size={size}
            title={`Nominate a contributor for ${trackName}'s leadership`} />
        }
      >
        Nominate
      </DialogTrigger>
      <DialogContent>
        {nominated ? (
          <>
            <DialogHeader>
              <DialogTitle>Nomination recorded</DialogTitle>
              <DialogDescription>
                {nominated.name} (@{nominated.githubLogin}) is now a candidate for {trackName}'s leadership. An Admin
                will decide (IDEA-150) — a nomination is a candidate, not an appointment.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
            </DialogFooter>
          </>
        ) : picked ? (
          <>
            <DialogHeader>
              <DialogTitle>Nominate {picked.name} (@{picked.githubLogin})?</DialogTitle>
              <DialogDescription>
                You are nominating them for a leader position of {trackName}. Nominations from several people
                accumulate, and an Admin reviews each candidate before appointing.
              </DialogDescription>
            </DialogHeader>
            <ActionMessage message={message} reauthRequired={reauthRequired} />
            <DialogFooter>
              <DialogClose render={<Button variant="outline" disabled={pending} />}>Cancel</DialogClose>
              <Button loading={pending} onClick={nominate}>
                Nominate
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Nominate a leader for {trackName}</DialogTitle>
              <DialogDescription>
                Search this track's members and pick the contributor to nominate — picking yourself nominates
                yourself.
              </DialogDescription>
            </DialogHeader>
            <Input
              type="search"
              icon={<SearchMark />}
              placeholder="Search members by name, email, or username…"
              value={query}
              onValueChange={setQuery}
              autoComplete="off"
              autoFocus
            />
            {results.length > 0 ? (
              <ul className="search-results">
                {results.map((member) => (
                  <li key={member.githubId}>
                    <button type="button" className="search-result-link nomination-pick" onClick={() => setPicked(member)}>
                      <span>{member.name}</span>
                      <span className="search-result-company"> @{member.githubLogin}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : query.trim().length >= MIN_QUERY_LENGTH ? (
              <p className="search-empty">No members match.</p>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
