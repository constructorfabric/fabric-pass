'use client'

import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@gears-frontx/ui-kit'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { ActionMessage } from '@/app/action-message'
import { CrownMark, ExternalLinkMark, GitHubMark, SearchMark, StarMark } from '@/app/marks'
import { LAB_ROLE_LABELS, LAB_ROLES, type LabCandidate, type LabRole } from '@/lib/lab-input'
import {
  deleteLabAction,
  removeLabPersonAction,
  searchLabCandidatesAction,
  setLabPersonAction,
  updateLabAction,
  type LabActionResult,
} from './actions'
import { formValuesFrom, LabDetailsForm, type LabFormValues } from './lab-details-form'
import type { LabPersonView, LabView } from './lab-view'

const ROLE_ITEMS = LAB_ROLES.map((role) => ({ value: role, label: LAB_ROLE_LABELS[role] }))

/** Same debounce and minimum as the header's contributor search
 * (contributor-search.tsx), minus one character: logins are short. */
const DEBOUNCE_MS = 250
const MIN_QUERY_LENGTH = 2

function displayName(person: { name?: string | null; githubLogin: string }) {
  return person.name || `@${person.githubLogin}`
}

function sameValues(a: LabFormValues, b: LabFormValues) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * IDEA-156 — one Lab's editor. Three independent parts, each saving on its
 * own: the details form (Save/Reset), the people (each add, role switch or
 * removal is its own action, applied immediately), and Delete. Every action
 * returns the Lab as it now stands, which replaces local state — no reload.
 */
export function LabEditor({ lab: initialLab }: { lab: LabView }) {
  const router = useRouter()
  const [lab, setLab] = useState(initialLab)
  const [values, setValues] = useState(() => formValuesFrom(initialLab))
  const [message, setMessage] = useState<string>()
  const [reauthRequired, setReauthRequired] = useState(false)
  const [notice, setNotice] = useState<string>()
  // 'details' | 'delete' | `${githubId}:${action}` — the clicked control
  // alone spins while its siblings only disable, the same shape as the
  // Track Leaders page.
  const [pendingKey, setPendingKey] = useState<string>()

  const dirty = !sameValues(values, formValuesFrom(lab))

  async function run(key: string, action: () => Promise<LabActionResult>, onOk?: (result: LabActionResult) => void) {
    setPendingKey(key)
    setMessage(undefined)
    setNotice(undefined)
    setReauthRequired(false)
    try {
      const result = await action()
      if (!result.ok) {
        setMessage(result.message ?? 'Something went wrong. Please try again in a moment.')
        setReauthRequired(Boolean(result.reauthRequired))
        return
      }
      if (result.lab) setLab(result.lab)
      onOk?.(result)
    } finally {
      setPendingKey(undefined)
    }
  }

  function save() {
    run('details', () => updateLabAction(lab.slug, values), (result) => {
      if (result.lab) setValues(formValuesFrom(result.lab))
      setNotice('Saved.')
    })
  }

  const leaders = lab.people.filter((person) => person.role === 'leader')
  const maintainers = lab.people.filter((person) => person.role === 'maintainer')
  const busy = pendingKey !== undefined

  return (
    <div className="lab-editor">
      <ActionMessage message={message} reauthRequired={reauthRequired} />

      <Card size="sm">
        <CardHeader>
          <CardTitle>
            <h3 className="card-heading">Details</h3>
          </CardTitle>
          <div className="admin-tile-properties">
            <span className="admin-tile-property" title="Slug — fixed once the Lab exists">
              {lab.slug}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <form className="profile-form" onSubmit={(e) => e.preventDefault()}>
            <LabDetailsForm values={values} onChange={setValues} disabled={pendingKey === 'details'} />
          </form>
          <div className="form-actions">
            <Button onClick={save} loading={pendingKey === 'details'} disabled={!dirty || (busy && pendingKey !== 'details')}>
              Save
            </Button>
            <Button variant="outline" onClick={() => setValues(formValuesFrom(lab))} disabled={!dirty || busy}>
              Reset
            </Button>
          </div>
          {notice && !dirty ? <p className="subtitle">{notice}</p> : null}
        </CardContent>
      </Card>

      <section className="track-review-section">
        <div className="track-review-section-header">
          <h3>People</h3>
        </div>
        <p className="subtitle">
          Leaders get Maintain on every Lab repository through the <code>{lab.slug}-leaders</code> GitHub team;
          Maintainers get Write through <code>{lab.slug}-maintainers</code>.
        </p>
        <AddPerson
          existing={lab.people}
          busy={busy}
          pending={pendingKey === 'add'}
          onAdd={(candidate, role) => run('add', () => setLabPersonAction(lab.slug, candidate.githubId, role))}
        />

        <p className="subtitle">Leaders</p>
        {leaders.length === 0 ? (
          <p className="track-leaders-warning track-leaders-warning-in-section">
            No leader yet. Nobody is accountable for this Lab until one is added.
          </p>
        ) : (
          <PeopleTiles
            people={leaders}
            labName={lab.name}
            pendingKey={pendingKey}
            busy={busy}
            onSwitchRole={(person) => run(`${person.githubId}:role`, () => setLabPersonAction(lab.slug, person.githubId, 'maintainer'))}
            onRemove={(person) => run(`${person.githubId}:remove`, () => removeLabPersonAction(lab.slug, person.githubId))}
          />
        )}

        <p className="subtitle">Maintainers</p>
        {maintainers.length === 0 ? (
          <p className="search-empty">No maintainers yet.</p>
        ) : (
          <PeopleTiles
            people={maintainers}
            labName={lab.name}
            pendingKey={pendingKey}
            busy={busy}
            onSwitchRole={(person) => run(`${person.githubId}:role`, () => setLabPersonAction(lab.slug, person.githubId, 'leader'))}
            onRemove={(person) => run(`${person.githubId}:remove`, () => removeLabPersonAction(lab.slug, person.githubId))}
          />
        )}
      </section>

      <section className="track-review-section">
        <div className="track-review-section-header">
          <h3>Delete this Lab</h3>
          <DeleteLabDialog
            lab={lab}
            busy={busy}
            pending={pendingKey === 'delete'}
            onConfirm={() => run('delete', () => deleteLabAction(lab.slug), () => router.push('/admin/labs'))}
          />
        </div>
      </section>
    </div>
  )
}

/** The people picker: type part of a login or name, pick one of the
 * confirmed contributors it matches, choose the role, Add. Someone already
 * on the Lab is listed but can't be picked — their tile's own action
 * switches their role instead. */
function AddPerson({
  existing,
  busy,
  pending,
  onAdd,
}: {
  existing: LabPersonView[]
  busy: boolean
  pending: boolean
  onAdd: (candidate: LabCandidate, role: LabRole) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LabCandidate[]>([])
  const [selected, setSelected] = useState<LabCandidate | null>(null)
  const [role, setRole] = useState<LabRole>('maintainer')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Drops a slower, earlier response that lands after a later one — the
  // same guard contributor-search.tsx keeps.
  const latestQuery = useRef('')

  useEffect(() => {
    clearTimeout(timer.current)
    const trimmed = query.trim()
    if (selected || trimmed.length < MIN_QUERY_LENGTH) {
      setResults([])
      return
    }
    timer.current = setTimeout(() => {
      latestQuery.current = trimmed
      searchLabCandidatesAction(trimmed).then((found) => {
        if (latestQuery.current === trimmed) setResults(found)
      })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer.current)
  }, [query, selected])

  // Once the add lands, the person shows up in `existing` — clear the
  // picker then, rather than optimistically on click, so a failed add keeps
  // the choice for a retry.
  useEffect(() => {
    if (selected && existing.some((person) => person.githubId === selected.githubId)) {
      setSelected(null)
      setQuery('')
    }
  }, [existing, selected])

  const onLab = new Set(existing.map((person) => person.githubId))

  return (
    <div className="lab-add-person">
      <div className="contributor-search">
        <Label htmlFor="lab-person-search" className="form-label">
          Add a person
        </Label>
        <Input
          id="lab-person-search"
          type="search"
          icon={<SearchMark />}
          placeholder="Search confirmed contributors by login or name…"
          value={selected ? `${displayName(selected)} (@${selected.githubLogin})` : query}
          onValueChange={(next) => {
            setSelected(null)
            setQuery(next)
          }}
          autoComplete="off"
          disabled={pending}
        />
        {results.length > 0 ? (
          <ul className="search-results">
            {results.map((candidate) => (
              <li key={candidate.githubId}>
                <button
                  type="button"
                  className="nomination-pick"
                  disabled={onLab.has(candidate.githubId)}
                  onClick={() => {
                    setSelected(candidate)
                    setResults([])
                  }}
                >
                  <span>
                    {displayName(candidate)}
                    <span className="search-result-company"> · @{candidate.githubLogin}</span>
                    {onLab.has(candidate.githubId) ? <span className="search-result-company"> · already on this Lab</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : !selected && query.trim().length >= MIN_QUERY_LENGTH ? (
          <p className="search-empty">No matches.</p>
        ) : null}
      </div>
      <div className="lab-add-person-controls">
        <Select items={ROLE_ITEMS} value={role} onValueChange={(next) => setRole(next as LabRole)}>
          <SelectTrigger aria-label="Role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLE_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          onClick={() => selected && onAdd(selected, role)}
          loading={pending}
          disabled={!selected || (busy && !pending)}
          title={selected ? `Add ${displayName(selected)} as ${LAB_ROLE_LABELS[role]}` : 'Pick a contributor first'}
        >
          Add
        </Button>
      </div>
    </div>
  )
}

function PeopleTiles({
  people,
  labName,
  pendingKey,
  busy,
  onSwitchRole,
  onRemove,
}: {
  people: LabPersonView[]
  labName: string
  pendingKey: string | undefined
  busy: boolean
  onSwitchRole: (person: LabPersonView) => void
  onRemove: (person: LabPersonView) => void
}) {
  return (
    <div className="admin-tiles">
      {people.map((person) => {
        const otherRole: LabRole = person.role === 'leader' ? 'maintainer' : 'leader'
        const rolePending = pendingKey === `${person.githubId}:role`
        const removePending = pendingKey === `${person.githubId}:remove`
        return (
          <Card size="sm" key={person.githubId}>
            <CardHeader>
              <CardTitle>
                <h3 className="card-heading">{displayName(person)}</h3>
              </CardTitle>
              {person.profileHash ? (
                <CardAction>
                  <Button
                    render={<Link href={`/contributors/${person.profileHash}`} />}
                    nativeButton={false}
                    variant="outline"
                    size="sm"
                    icon={<ExternalLinkMark />}
                    title="Open public profile"
                    aria-label="Open public profile"
                  />
                </CardAction>
              ) : null}
            </CardHeader>
            <CardContent className="admin-tile-content">
              <div className="admin-tile-properties">
                <span className="admin-tile-property" title="GitHub">
                  <GitHubMark size={14} />@{person.githubLogin}
                </span>
              </div>
              <div className="profile-labels">
                {person.role === 'leader' ? (
                  <Badge variant="warning" icon={<CrownMark size={12} />}>
                    Leader
                  </Badge>
                ) : (
                  <Badge variant="info" icon={<StarMark size={12} />}>
                    Maintainer
                  </Badge>
                )}
              </div>
            </CardContent>
            <CardFooter className="admin-actions">
              <Button
                variant="outline"
                loading={rolePending}
                disabled={busy && !rolePending}
                onClick={() => onSwitchRole(person)}
                title={`Make ${displayName(person)} a ${LAB_ROLE_LABELS[otherRole]} of ${labName} instead`}
              >
                Make {LAB_ROLE_LABELS[otherRole]}
              </Button>
              <Dialog>
                <DialogTrigger
                  render={<Button variant="outline" loading={removePending} disabled={busy && !removePending} />}
                >
                  Remove
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>
                      Remove {displayName(person)} from {labName}?
                    </DialogTitle>
                    <DialogDescription>
                      {`They stop being a ${LAB_ROLE_LABELS[person.role]} of this Lab and leave its GitHub team, losing the access it gives on the Lab's repositories. They can be added again at any time.`}
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                    <DialogClose render={<Button variant="destructive" onClick={() => onRemove(person)} />}>
                      Remove
                    </DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardFooter>
          </Card>
        )
      })}
    </div>
  )
}

/** Delete asks for the slug to be typed back — the Lab, its people and
 * their roles all go at once, and only the audit log remembers it. */
function DeleteLabDialog({
  lab,
  busy,
  pending,
  onConfirm,
}: {
  lab: LabView
  busy: boolean
  pending: boolean
  onConfirm: () => void
}) {
  const [typed, setTyped] = useState('')

  return (
    <Dialog onOpenChange={(open) => !open && setTyped('')}>
      <DialogTrigger render={<Button variant="destructive" loading={pending} disabled={busy && !pending} />}>
        Delete Lab
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {lab.name}?</DialogTitle>
          <DialogDescription>
            The Lab and its {lab.people.length === 1 ? 'one Leader/Maintainer assignment' : `${lab.people.length} Leader/Maintainer assignments`}{' '}
            are removed for good, and the Lab&apos;s GitHub teams lose their members and their access to its
            repositories. The repositories themselves are not touched. Type <strong>{lab.slug}</strong> to confirm.
          </DialogDescription>
        </DialogHeader>
        <Input value={typed} onValueChange={setTyped} placeholder={lab.slug} aria-label="Type the Lab's slug to confirm" autoComplete="off" />
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <DialogClose render={<Button variant="destructive" disabled={typed !== lab.slug} onClick={onConfirm} />}>
            Delete
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
