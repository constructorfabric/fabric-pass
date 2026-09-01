'use client'

import { Button, Card, CardContent, CardHeader, CardTitle, Field, FieldLabel, Input } from '@gears-frontx/ui-kit'
import { useState } from 'react'
import { ActionMessage } from '@/app/action-message'
import { ApiKeyControl, type StoredApiKey } from '@/app/api-key-control'
import { ApiUsageHint } from '@/app/api-usage-hint'
import { createApplicationAction, regenerateApplicationApiKeyAction } from './actions'

interface ApplicationRow {
  id: string
  name: string
  contactName: string
  contactEmail: string
  apiKey: StoredApiKey | null
}

/**
 * IDEA-121/126 — the list and the registration form are two distinct
 * views, never rendered together: "Add new application" swaps the list out
 * for a standalone form (Register commits, Cancel discards, both returning
 * to the list), rather than a form permanently pinned above the list it
 * adds to. The form's fields use `.profile-form`'s stacked-gap shape, the
 * same spacing Profile's own form (`form.tsx`) uses, in place of the kit
 * Fields' default cramped-together spacing inside a plain `CardContent`.
 * A newly created application is appended to local state directly from the
 * action's own response — no reload needed, matching this app's usual
 * optimistic-update pattern elsewhere (e.g. track-membership-review.tsx).
 */
export function ApplicationsView({
  applications: initialApplications,
  apiOrigin,
}: {
  applications: ApplicationRow[]
  apiOrigin: string
}) {
  const [applications, setApplications] = useState(initialApplications)
  const [mode, setMode] = useState<'list' | 'register'>('list')
  const [name, setName] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string>()

  function startRegistering() {
    setMessage(undefined)
    setMode('register')
  }

  function cancelRegistering() {
    setName('')
    setContactName('')
    setContactEmail('')
    setMessage(undefined)
    setMode('list')
  }

  async function create() {
    setPending(true)
    setMessage(undefined)
    try {
      const result = await createApplicationAction(name, contactName, contactEmail)
      if (!result.ok || !result.application) {
        setMessage(result.message ?? 'Could not create this application right now. Please try again in a moment.')
        return
      }

      setApplications((current) => [...current, { ...result.application!, apiKey: null }])
      setName('')
      setContactName('')
      setContactEmail('')
      setMode('list')
    } finally {
      setPending(false)
    }
  }

  if (mode === 'register') {
    return (
      <Card size="sm">
        <CardHeader>
          <CardTitle>
            <h3 className="card-heading">Register an application</h3>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form className="profile-form" onSubmit={(e) => e.preventDefault()}>
            <Field name="application-name">
              <FieldLabel>Name</FieldLabel>
              <Input value={name} onValueChange={setName} placeholder="e.g. Insight" />
            </Field>
            <Field name="application-contact-name">
              <FieldLabel>Contact name</FieldLabel>
              <Input value={contactName} onValueChange={setContactName} placeholder="Who to reach about this application" />
            </Field>
            <Field name="application-contact-email">
              <FieldLabel>Contact email</FieldLabel>
              <Input type="email" value={contactEmail} onValueChange={setContactEmail} placeholder="contact@example.com" />
            </Field>
          </form>
          <div className="form-actions">
            <Button onClick={create} loading={pending}>
              Register
            </Button>
            <Button variant="outline" onClick={cancelRegistering} disabled={pending}>
              Cancel
            </Button>
          </div>
          <ActionMessage message={message} />
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <div className="applications-list-actions">
        <Button onClick={startRegistering}>Add new application</Button>
      </div>

      {applications.length === 0 ? (
        <p className="search-empty">No applications registered yet.</p>
      ) : (
        <div className="admin-tiles">
          {applications.map((application) => (
            <Card size="sm" key={application.id}>
              <CardHeader>
                <CardTitle>
                  <h3 className="card-heading">{application.name}</h3>
                </CardTitle>
                <div className="admin-tile-properties">
                  <span className="admin-tile-property">{application.contactName}</span>
                  <span className="admin-tile-property">{application.contactEmail}</span>
                </div>
              </CardHeader>
              <CardContent>
                <ApiKeyControl
                  initialKey={application.apiKey}
                  onRegenerate={() => regenerateApplicationApiKeyAction(application.id)}
                  noKeyMessage="No API key yet."
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ApiUsageHint origin={apiOrigin} exampleLabel="list the Fabric member directory" examplePath="/api/members" />
    </>
  )
}
