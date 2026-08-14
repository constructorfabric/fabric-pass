'use client'

import { Badge, Button, Field, FieldDescription, FieldError, FieldLabel, Input } from '@gears-frontx/ui-kit'
import { useRef } from 'react'
import { CloseMark, EmailMark } from '@/app/marks'
import { useAutosaveField, type AutosaveStatus } from '@/app/use-autosave-field'
import type { DetailField } from '@/lib/contributors'

const EMAIL_CONFIRMATION_TTL_MS = 24 * 60 * 60 * 1000

/** The only feedback a contributor gets that a keystroke was actually kept —
 * there is no Save button any more, so this is where "was that stored?" gets
 * answered. Lives at the right end of the label's own line (see
 * `.field-label-row`), so it costs the form no vertical space at all: the
 * fields sit at the same rhythm whether a status is showing or not, in edit
 * mode and view mode alike. Errors go through the kit's FieldError (the
 * surrounding Field is marked `invalid` by the caller whenever status is
 * 'error'); everything else — 'saving', 'saved', 'guidance' — reads as an
 * unhurried FieldDescription, never mistakable for a mistake.
 * `reauthRequired` adds a link straight back into GitHub sign-in right next
 * to the error that caused it, rather than leaving the contributor on a page
 * with no way out (see README's "session outlives its row"). `disabled`
 * (view mode) renders nothing — a locked field can't autosave. */
function AutosaveStatusLine({
  status,
  message,
  reauthRequired,
  disabled,
}: {
  status: AutosaveStatus
  message?: string
  reauthRequired?: boolean
  disabled?: boolean
}) {
  if (disabled) return null
  if (status === 'error') {
    return (
      <FieldError match className="autosave-status">
        {message ?? 'Could not save'}
        {reauthRequired ? (
          <>
            {' '}
            <a href="/auth/github">Sign in again</a>
          </>
        ) : null}
      </FieldError>
    )
  }
  const text = status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : status === 'guidance' ? (message ?? '') : ''
  return (
    <FieldDescription className="autosave-status" aria-live="polite">
      {text}
    </FieldDescription>
  )
}

interface FieldProps {
  field: DetailField
  label: string
  type?: string
  placeholder?: string
  defaultValue: string
  /** View mode's gate: the kit Field's `disabled` lands on the real input,
   * which then receives no change/blur events, so autosave never fires —
   * view mode is a lock on this same field, not a separate rendering of it. */
  disabled?: boolean
  /** Mirrors every keystroke up to the parent, purely so the Save button can
   * check the current value against `missingMandatoryFields` — this never
   * touches persistence, which still happens only through `onChange`/`onBlur`
   * below. */
  onValueChange?: (value: string) => void
}

export function AutosaveField({ field, label, type = 'text', placeholder, defaultValue, disabled, onValueChange }: FieldProps) {
  const { value, status, message, reauthRequired, onChange, onBlur } = useAutosaveField(field, defaultValue)

  return (
    <Field name={field} invalid={status === 'error'} disabled={disabled}>
      <div className="field-label-row">
        <FieldLabel>{label}</FieldLabel>
        <AutosaveStatusLine status={status} message={message} reauthRequired={reauthRequired} disabled={disabled} />
      </div>
      <Input
        type={type}
        placeholder={placeholder}
        value={value}
        onValueChange={(next) => {
          onChange(next)
          onValueChange?.(next)
        }}
        onBlur={onBlur}
      />
    </Field>
  )
}

/**
 * Email autosaves like any other typed field, but also carries the
 * confirmation flow: a Confirm/Re-confirm action sits beside the input on
 * the same row (`.field-row` — the kit Input's `end` slot is sized for an
 * icon-only button, not a labelled one). Sending is a deliberate click (see
 * contributors.ts's saveEmail), never automatic. Once confirmed, that same
 * spot shows a plain "Confirmed" badge instead — a label, not a button,
 * since there's nothing left to click. IDEA-038 — the same button is also
 * swapped for a static "Confirmation required" badge whenever `disabled` is
 * true (view mode): the input being read-only shouldn't leave a live,
 * real-resend-triggering button sitting next to it. Edit mode keeps the
 * actionable button either way.
 * `confirmedAt`/`sentAt` come from the server and don't update until the
 * page reloads — a save that changes the address won't flip this status or
 * the pending message below until then, consistent with the rest of this
 * page's confirmation status.
 */
export function EmailField({
  defaultValue,
  confirmedAt,
  sentAt,
  disabled,
  onValueChange,
}: {
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
    <Field name="email" invalid={status === 'error'} disabled={disabled}>
      <div className="field-label-row">
        <FieldLabel>Email</FieldLabel>
        <AutosaveStatusLine status={status} message={message} reauthRequired={reauthRequired} disabled={disabled} />
      </div>
      <div className="field-row">
        <Input
          type="email"
          value={value}
          onValueChange={(next) => {
            onChange(next)
            onValueChange?.(next)
          }}
          onBlur={onBlur}
        />
        {confirmedAt ? (
          <Badge variant="success" shape="plain" dot>
            Confirmed
          </Badge>
        ) : value && disabled ? (
          <Badge variant="danger" shape="plain">
            Confirmation required
          </Badge>
        ) : value ? (
          <Button
            render={<a href="/auth/resend-confirmation" />}
            nativeButton={false}
            icon={<EmailMark />}
            className="button-brand-email"
          >
            {sentAt ? 'Re-confirm' : 'Confirm'}
          </Button>
        ) : null}
      </div>
      {showPending ? (
        <FieldDescription>
          {expired
            ? 'That confirmation link has expired.'
            : `Check your inbox at ${value} and click the confirmation link we sent.`}
        </FieldDescription>
      ) : null}
    </Field>
  )
}

/**
 * Company keeps the datalist-plus-clear-button UX from the earlier, Save-button
 * form: the three common answers as suggestions, but free text still works,
 * and unlike a <select> this degrades without JavaScript. The clear button
 * lives in the kit Input's `end` slot — exactly the icon-only ghost button
 * that slot is sized for. Autosave only changes how the value reaches the
 * database, not this field's shape.
 */
export function CompanyField({
  defaultValue,
  disabled,
  onValueChange,
}: {
  defaultValue: string
  disabled?: boolean
  /** Mirrors every keystroke up to the parent, same as AutosaveField's own
   * `onValueChange` — Company is now mandatory too, so the Save gate needs
   * its live value alongside Name and Email's. */
  onValueChange?: (value: string) => void
}) {
  const { value, status, message, reauthRequired, onChange, onBlur, commit } = useAutosaveField('company', defaultValue)
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <Field name="company" invalid={status === 'error'} disabled={disabled}>
      <div className="field-label-row">
        <FieldLabel>Company</FieldLabel>
        <AutosaveStatusLine status={status} message={message} reauthRequired={reauthRequired} disabled={disabled} />
      </div>
      <Input
        // The datalist is what makes the browser draw its own dropdown
        // arrow, and no CSS hides that arrow across browsers. Dropping the
        // attribute once the field holds a value removes it outright; the
        // suggestions are there for an empty field, which is when they help.
        list={value ? undefined : 'companies'}
        ref={inputRef}
        value={value}
        onValueChange={(next) => {
          onChange(next)
          onValueChange?.(next)
        }}
        onBlur={onBlur}
        // Hidden in view mode, same as the field itself: a clear commits
        // immediately, bypassing the debounce, so it must be unavailable
        // wherever autosave is. While editing, the slot itself must stay
        // present even with no value — the kit only wraps the input when a
        // slot exists, so a slot appearing on the first keystroke would
        // remount the input and drop focus mid-word (the empty span is that
        // keystroke's placeholder, not decoration).
        end={
          disabled ? undefined : value ? (
            <Button
              variant="ghost"
              size="sm"
              icon={<CloseMark />}
              aria-label="Clear company"
              onClick={() => {
                commit('')
                onValueChange?.('')
                inputRef.current?.focus()
              }}
            />
          ) : (
            <span aria-hidden="true" />
          )
        }
      />
      <datalist id="companies">
        <option value="Constructor" />
        <option value="Acronis" />
        <option value="Virtuozzo" />
      </datalist>
    </Field>
  )
}
