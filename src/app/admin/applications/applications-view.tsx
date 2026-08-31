'use client'

import { Button, Card, CardContent, CardHeader, CardTitle, Field, FieldLabel, Input } from '@gears-frontx/ui-kit'
import { useState } from 'react'
import { ActionMessage } from '@/app/action-message'
import { ApiKeyControl, type StoredApiKey } from '@/app/api-key-control'
import { createApplicationAction, regenerateApplicationApiKeyAction } from './actions'

interface ApplicationRow {
  id: string
  name: string
  contactName: string
  contactEmail: string
  apiKey: StoredApiKey | null
}

/**
 * IDEA-121 — a registration form (name + free-text admin contact, not
 * linked to any fabric-pass contributor account) above the list of
 * already-registered applications, each with its own `ApiKeyControl`
 * (the same generate/mask/regenerate control IDEA-119's own screen uses).
 * A newly created application is appended to local state directly from
 * the action's own response — no reload needed, matches this app's usual
 * optimistic-update pattern elsewhere (e.g. track-membership-review.tsx).
 */
export function ApplicationsView({ applications: initialApplications }: { applications: ApplicationRow[] }) {
  const [applications, setApplications] = useState(initialApplications)
  const [name, setName] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string>()

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
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <Card size="sm">
        <CardHeader>
          <CardTitle>
            <h3 className="card-heading">Register an application</h3>
          </CardTitle>
        </CardHeader>
        <CardContent>
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
          <Button onClick={create} loading={pending}>
            Register
          </Button>
          <ActionMessage message={message} />
        </CardContent>
      </Card>

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
    </>
  )
}
