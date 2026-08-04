'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { AutosaveField, CompanyField, EmailField } from './autosave-field'
import type { Notice } from './auth/notice'
import { Collected } from './collected'
import { missingMandatoryFields } from './form-schema'
import { DiscordMark, PencilMark, TelegramMark } from './marks'

interface Props {
  telegramLabel: string | null
  discordLabel: string | null
  defaults: { name: string; email: string; company: string }
  emailConfirmedAt: Date | null
  emailConfirmationSentAt: Date | null
  notice?: Notice
}

/**
 * Telegram and Discord aren't typed text, so they can't be an <input> — this
 * gives them the same label-above-field shape as the autosaving fields below
 * instead (see globals.css's `.provider-field`), rather than the separate,
 * differently-styled button row this used to be.
 */
function ProviderField({
  label,
  value,
  href,
  brand,
  mark,
  editable,
}: {
  label: string
  value: string | null
  href: string
  brand: 'telegram' | 'discord'
  mark: ReactNode
  /** View mode's gate on Link/Re-link: the action is left out of the markup
   * entirely rather than rendered disabled, since there's nothing to click
   * through to in view mode anyway. */
  editable: boolean
}) {
  return (
    <>
      <label>{label}</label>
      <div className="provider-field">
        <span className={value ? 'provider-value' : 'provider-value muted'}>{value ?? 'Not linked'}</span>
        {editable ? (
          <a className={`link-button brand ${brand}`} href={href}>
            {mark}
            {value ? 'Re-link' : 'Link'}
          </a>
        ) : null}
      </div>
    </>
  )
}

export function ContributorForm({
  telegramLabel,
  discordLabel,
  defaults,
  emailConfirmedAt,
  emailConfirmationSentAt,
  notice,
}: Props) {
  // View-only on load, so a returning contributor can't change anything by
  // accident — Edit switches this on, Save switches it back off. `name`/
  // `email` mirror the two mandatory fields' live values, kept only so Save
  // can check them; they never drive persistence themselves (each field's
  // own autosave does that, unchanged).
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(defaults.name)
  const [email, setEmail] = useState(defaults.email)
  const [saveMessage, setSaveMessage] = useState<string>()

  function handleSave() {
    const missing = missingMandatoryFields({ name, email })
    if (missing.length > 0) {
      setSaveMessage(`Please fill in: ${missing.join(', ')}.`)
      return
    }
    setSaveMessage(undefined)
    setEditing(false)
  }

  return (
    <>
      <div className="profile-header">
        <h2>Contributor Profile</h2>
        {editing ? (
          <button type="button" className="icon-button" onClick={handleSave}>
            Save
          </button>
        ) : (
          <button type="button" className="icon-button" title="Modify profile" onClick={() => setEditing(true)}>
            <PencilMark size={16} />
            Edit
          </button>
        )}
      </div>
      <p className="subtitle">Please share your contact details below to make it easier for other community members to reach you and for us to grant you access to relevant community resources.</p>

      {notice ? <p className={notice.kind}>{notice.message}</p> : null}
      {saveMessage ? <p className="error">{saveMessage}</p> : null}

      {/* No submit button: every field autosaves on its own (Telegram and
          Discord navigate to their own OAuth flow instead), so this isn't a
          form that gets submitted — it's grouped markup for its labels. */}
      <form onSubmit={(e) => e.preventDefault()}>
        <AutosaveField
          id="name"
          field="name"
          label="Name"
          placeholder="e.g. John Doe"
          defaultValue={defaults.name}
          disabled={!editing}
          onValueChange={setName}
        />
        <EmailField
          id="email"
          defaultValue={defaults.email}
          confirmedAt={emailConfirmedAt}
          sentAt={emailConfirmationSentAt}
          disabled={!editing}
          onValueChange={setEmail}
        />
        <CompanyField defaultValue={defaults.company} disabled={!editing} />
        <ProviderField
          label="Discord"
          value={discordLabel}
          href="/auth/discord"
          brand="discord"
          mark={<DiscordMark size={16} />}
          editable={editing}
        />
        <ProviderField
          label="Telegram"
          value={telegramLabel}
          href="/auth/telegram"
          brand="telegram"
          mark={<TelegramMark size={16} />}
          editable={editing}
        />
      </form>

      <Collected />
    </>
  )
}
