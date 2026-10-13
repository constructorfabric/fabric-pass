'use client'

import { Badge, Button, Card, CardAction, CardContent, CardHeader, CardTitle, Field, FieldDescription, FieldLabel, Input } from '@gears-frontx/ui-kit'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ActionMessage } from '@/app/action-message'
import { CrownMark, PencilMark, StarMark } from '@/app/marks'
import { slugifyLabName } from '@/lib/lab-input'
import { createLabAction } from './actions'
import { EMPTY_REPOSITORY, LabDetailsForm, type LabFormValues } from './lab-details-form'
import type { LabView } from './lab-view'

const EMPTY_FORM: LabFormValues = { name: '', description: '', repositories: [EMPTY_REPOSITORY] }

function peopleSummary(lab: LabView, role: 'leader' | 'maintainer') {
  const logins = lab.people.filter((person) => person.role === role).map((person) => `@${person.githubLogin}`)
  return logins.length > 0 ? logins.join(', ') : 'none'
}

/**
 * IDEA-156 — the Labs list and the create form, two views never rendered
 * together: the same list/register swap as the Applications page
 * (applications-view.tsx). Creating a Lab goes straight to its own page,
 * where people are added — a Lab has no people at creation time.
 *
 * The slug follows the name (slugifyLabName) until the Admin edits it by
 * hand; after that it's theirs. It can't change once the Lab exists, so
 * the form says so.
 */
export function LabsView({ labs }: { labs: LabView[] }) {
  const router = useRouter()
  const [mode, setMode] = useState<'list' | 'create'>('list')
  const [values, setValues] = useState<LabFormValues>(EMPTY_FORM)
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string>()
  const [reauthRequired, setReauthRequired] = useState(false)

  function changeValues(next: LabFormValues) {
    setValues(next)
    if (!slugEdited) setSlug(slugifyLabName(next.name))
  }

  function cancel() {
    setValues(EMPTY_FORM)
    setSlug('')
    setSlugEdited(false)
    setMessage(undefined)
    setMode('list')
  }

  async function create() {
    setPending(true)
    setMessage(undefined)
    setReauthRequired(false)
    try {
      const result = await createLabAction(slug, values)
      if (!result.ok || !result.lab) {
        setMessage(result.message ?? 'Could not create this Lab right now. Please try again in a moment.')
        setReauthRequired(Boolean(result.reauthRequired))
        return
      }
      router.push(`/admin/labs/${result.lab.slug}`)
    } finally {
      setPending(false)
    }
  }

  if (mode === 'create') {
    return (
      <Card size="sm">
        <CardHeader>
          <CardTitle>
            <h3 className="card-heading">New Lab</h3>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form className="profile-form" onSubmit={(e) => e.preventDefault()}>
            <LabDetailsForm values={values} onChange={changeValues} disabled={pending} />
            <Field name="lab-slug">
              <FieldLabel>Slug</FieldLabel>
              <Input
                value={slug}
                onValueChange={(next) => {
                  setSlug(next)
                  setSlugEdited(true)
                }}
                placeholder="agentic-search"
                disabled={pending}
              />
              <FieldDescription>
                Lowercase words joined by hyphens. Names the Lab&apos;s GitHub teams ({slug || 'slug'}-leaders,{' '}
                {slug || 'slug'}-maintainers), so it can&apos;t be changed later or match a track&apos;s slug.
              </FieldDescription>
            </Field>
          </form>
          <div className="form-actions">
            <Button onClick={create} loading={pending}>
              Create Lab
            </Button>
            <Button variant="outline" onClick={cancel} disabled={pending}>
              Cancel
            </Button>
          </div>
          <ActionMessage message={message} reauthRequired={reauthRequired} />
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <div className="applications-list-actions">
        <Button onClick={() => setMode('create')}>Add new Lab</Button>
      </div>

      {labs.length === 0 ? (
        <p className="search-empty">No Labs yet.</p>
      ) : (
        <div className="admin-tiles">
          {labs.map((lab) => {
            const leaderless = !lab.people.some((person) => person.role === 'leader')
            return (
              <Card size="sm" key={lab.slug}>
                <CardHeader>
                  <CardTitle>
                    <h3 className="card-heading">
                      <Link href={`/admin/labs/${lab.slug}`}>
                        {lab.name}
                      </Link>
                    </h3>
                  </CardTitle>
                  <CardAction>
                    <Button
                      render={<Link href={`/admin/labs/${lab.slug}`} />}
                      nativeButton={false}
                      variant="outline"
                      size="sm"
                      icon={<PencilMark />}
                      title={`Edit ${lab.name}`}
                      aria-label={`Edit ${lab.name}`}
                    />
                  </CardAction>
                </CardHeader>
                <CardContent className="admin-tile-content">
                  {lab.description ? <p className="lab-tile-description">{lab.description}</p> : null}
                  <div className="admin-tile-properties">
                    <span className="admin-tile-property">{lab.slug}</span>
                    <span className="admin-tile-property">
                      {lab.repositories.length === 1 ? '1 repository' : `${lab.repositories.length} repositories`}
                    </span>
                    <span className="admin-tile-property" title="Leaders">
                      <CrownMark size={14} />
                      {peopleSummary(lab, 'leader')}
                    </span>
                    <span className="admin-tile-property" title="Maintainers">
                      <StarMark size={14} />
                      {peopleSummary(lab, 'maintainer')}
                    </span>
                  </div>
                  {leaderless ? (
                    <div className="profile-labels">
                      <Badge variant="danger" title="Nobody is accountable for this Lab yet">
                        No leader
                      </Badge>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </>
  )
}
