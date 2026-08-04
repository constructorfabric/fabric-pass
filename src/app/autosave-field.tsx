'use client'

import { useRef } from 'react'
import { EmailMark } from '@/app/marks'
import { useAutosaveField, type AutosaveStatus } from '@/app/use-autosave-field'
import type { DetailField } from '@/lib/contributors'

const EMAIL_CONFIRMATION_TTL_MS = 24 * 60 * 60 * 1000

/** The only feedback a contributor gets that a keystroke was actually kept —
 * there is no Save button any more, so this is where "was that stored?" gets
 * answered. `guidance` reads the same greyed-out, unhurried style as 'idle'
 * and 'saving' (never the red of 'error', never mistakable for 'saved') —
 * it's mid-typing progress, not a mistake. `reauthRequired` adds a link
 * straight back into GitHub sign-in right next to the error that caused it,
 * rather than leaving the contributor on a page with no way out (see
 * README's "session outlives its row"). */
function AutosaveStatusLabel({
  status,
  message,
  reauthRequired,
}: {
  status: AutosaveStatus
  message?: string
  reauthRequired?: boolean
}) {
  const text =
    status === 'saving'
      ? 'Saving…'
      : status === 'saved'
        ? 'Saved'
        : status === 'guidance'
          ? (message ?? '')
          : status === 'error'
            ? (message ?? 'Could not save')
            : ''
  return (
    <span className={`autosave-status ${status}`} aria-live="polite">
      {text}
      {reauthRequired ? (
        <>
          {' '}
          <a href="/auth/github">Sign in again</a>
        </>
      ) : null}
    </span>
  )
}

interface FieldProps {
  id: string
  field: DetailField
  label: string
  type?: string
  placeholder?: string
  defaultValue: string
  /** View mode's gate: a disabled input receives no change/blur events, so
   * autosave never fires — view mode is a lock on this same field, not a
   * separate rendering of it. */
  disabled?: boolean
  /** Mirrors every keystroke up to the parent, purely so the Save button can
   * check the current value against `missingMandatoryFields` — this never
   * touches persistence, which still happens only through `onChange`/`onBlur`
   * below. */
  onValueChange?: (value: string) => void
}

export function AutosaveField({ id, field, label, type = 'text', placeholder, defaultValue, disabled, onValueChange }: FieldProps) {
  const { value, status, message, reauthRequired, onChange, onBlur } = useAutosaveField(field, defaultValue)

  return (
    <>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={field}
        type={type}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value)
          onValueChange?.(e.target.value)
        }}
        onBlur={onBlur}
      />
      <AutosaveStatusLabel status={status} message={message} reauthRequired={reauthRequired} />
    </>
  )
}

/**
 * Email autosaves like any other typed field, but also carries the
 * confirmation flow: a Confirm/Re-confirm button lives inside the same
 * bordered box as the input itself — the same field shape as the Telegram
 * and Discord links below (see globals.css's `.provider-field`), just with
 * an editable input on the left instead of a static value. Sending is a
 * deliberate click (see contributors.ts's saveEmail), never automatic. Once
 * confirmed, that same spot shows a plain "Confirmed" status instead — text,
 * not a button, since there's nothing left to click.
 * `confirmedAt`/`sentAt` come from the server and don't update until the
 * page reloads — a save that changes the address won't flip this status or
 * the pending message below until then, consistent with the rest of this
 * page's confirmation status.
 */
export function EmailField({
  id,
  defaultValue,
  confirmedAt,
  sentAt,
  disabled,
  onValueChange,
}: {
  id: string
  defaultValue: string
  confirmedAt: Date | null
  sentAt: Date | null
  disabled?: boolean
  onValueChange?: (value: string) => void
}) {
  const { value, status, message, reauthRequired, onChange, onBlur } = useAutosaveField('email', defaultValue)

  const expired = sentAt ? Date.now() - sentAt.getTime() > EMAIL_CONFIRMATION_TTL_MS : false
  const showPending = Boolean(sentAt) && !confirmedAt

  return (
    <>
      <label htmlFor={id}>Email</label>
      <div className="provider-field">
        <input
          id={id}
          name="email"
          type="email"
          value={value}
          disabled={disabled}
          onChange={(e) => {
            onChange(e.target.value)
            onValueChange?.(e.target.value)
          }}
          onBlur={onBlur}
        />
        {confirmedAt ? (
          <span className="email-confirmed-status">✓ Confirmed</span>
        ) : value ? (
          <a className="link-button brand email" href="/auth/resend-confirmation">
            <EmailMark size={16} />
            {sentAt ? 'Re-confirm' : 'Confirm'}
          </a>
        ) : null}
      </div>
      <AutosaveStatusLabel status={status} message={message} reauthRequired={reauthRequired} />
      {showPending ? (
        <p className="email-status">
          {expired
            ? 'That confirmation link has expired.'
            : `Check your inbox at ${value} and click the confirmation link we sent.`}
        </p>
      ) : null}
    </>
  )
}

/**
 * Company keeps the datalist-plus-clear-button UX from the earlier, Save-button
 * form: the three common answers as suggestions, but free text still works,
 * and unlike a <select> this degrades without JavaScript. Autosave only
 * changes how the value reaches the database, not this field's shape.
 */
export function CompanyField({ defaultValue, disabled }: { defaultValue: string; disabled?: boolean }) {
  const { value, status, message, reauthRequired, onChange, onBlur, commit } = useAutosaveField('company', defaultValue)
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <>
      <label htmlFor="company">Company</label>
      <div className={value ? 'clearable filled' : 'clearable'}>
        <input
          id="company"
          name="company"
          // The datalist is what makes the browser draw its own dropdown
          // arrow, and no CSS hides that arrow across browsers. Dropping the
          // attribute once the field holds a value removes it outright; the
          // suggestions are there for an empty field, which is when they help.
          list={value ? undefined : 'companies'}
          ref={inputRef}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
        />
        {/* Hidden in view mode, same as the field itself: a clear commits
            immediately, bypassing the debounce, so it must be unavailable
            wherever autosave is. */}
        {!disabled && value ? (
          <button
            type="button"
            className="clear"
            aria-label="Clear company"
            onClick={() => {
              commit('')
              inputRef.current?.focus()
            }}
          >
            ×
          </button>
        ) : null}
      </div>
      <datalist id="companies">
        <option value="Constructor" />
        <option value="Acronis" />
        <option value="Virtuozzo" />
      </datalist>
      <AutosaveStatusLabel status={status} message={message} reauthRequired={reauthRequired} />
    </>
  )
}
