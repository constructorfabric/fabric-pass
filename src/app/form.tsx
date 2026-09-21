'use client'

import { Badge, Button, Label } from '@gears-frontx/ui-kit'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { saveField, setFieldVisibilityAction } from '@/app/actions'
import { AutosaveField, CompanyField, EmailField } from './autosave-field'
import type { Notice } from './auth/notice'
import { Breadcrumb, HOME_BREADCRUMB } from './breadcrumb'
import { Collected } from './collected'
import {
  computeProfileCompleteness,
  missingForCompleteness,
  missingMandatoryFields,
  PROFILE_COMPLETENESS_LABELS,
  PROFILE_COMPLETENESS_VARIANTS,
} from '@/lib/profile-completeness'
import { VISIBILITY_LABELS, type OptionalProfileField } from '@/lib/profile-visibility'
import { Hint } from './hint'
import { DiscordMark, InfoMark, LinkedInMark, LockClosedMark, LockOpenMark, TelegramMark } from './marks'
import { TrackBadges, type TrackLabel } from './profile-labels'

interface Props {
  telegramLabel: string | null
  discordLabel: string | null
  linkedinLabel: string | null
  /** LinkedIn is this app's only optional provider (see lib/env.ts) — the
   * row is left out of the form entirely, not shown disabled, when it isn't
   * configured for this environment. */
  linkedinEnabled: boolean
  /** IDEA-110 — the current Admins-only state of each optional field, keyed
   * the same way OPTIONAL_PROFILE_FIELDS names them. */
  adminsOnly: Record<OptionalProfileField, boolean>
  defaults: { name: string; email: string; company: string }
  emailConfirmedAt: Date | null
  emailConfirmationSentAt: Date | null
  /** IDEA-064's track-participation labels. */
  tracks: TrackLabel[]
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
  lock,
}: {
  label: string
  value: string | null
  href: string
  brand: 'telegram' | 'discord' | 'linkedin'
  mark: ReactNode
  lock?: ReactNode
}) {
  return (
    // A static value with an action isn't a form control, so no kit Field
    // here — the kit Label and Button sit in the app's own field-shaped box
    // (.provider-block/.provider-field), which the kit has no part for.
    <div className="provider-block">
      <Label>{label}</Label>
      <div className="provider-field">
        <span className={value ? 'provider-value' : 'provider-value muted'}>{value ?? 'Not linked'}</span>
        {/* IDEA-110 — the lock sits with the Link/Re-link button in its own
            .provider-actions span so the two hug the right end of the box
            together, rather than the box's own justify-content:
            space-between spreading them apart the way it spreads the value
            span from a single trailing button. */}
        <span className="provider-actions">
          {lock}
          <Button render={<a href={href} />} nativeButton={false} size="sm" icon={mark} className={`button-brand-${brand}`}>
            {value ? 'Re-link' : 'Link'}
          </Button>
        </span>
      </div>
    </div>
  )
}

/**
 * IDEA-110's per-field Admins-only lock, next to ProviderField above since
 * that's where this file already groups this kind of local helper. Optimistic-
 * then-persisted, the same shape OnboardingChecklist's `hide` already uses
 * (flip local state immediately, fire the server action, done) — but unlike
 * hiding a checklist item, a wrong state shown here would misrepresent who
 * can actually see a handle, so a failed save reverts the click instead of
 * leaving the optimistic state stuck showing the wrong lock.
 */
function VisibilityLock({ field, initial }: { field: OptionalProfileField; initial: boolean }) {
  const [adminsOnly, setAdminsOnly] = useState(initial)
  const [pending, setPending] = useState(false)

  async function toggle() {
    const next = !adminsOnly
    setAdminsOnly(next)
    setPending(true)
    const result = await setFieldVisibilityAction(field, next)
    setPending(false)
    if (!result.ok) setAdminsOnly(adminsOnly)
  }

  const label = adminsOnly ? VISIBILITY_LABELS.adminsOnly : VISIBILITY_LABELS.everyone

  return (
    <Button
      variant="outline"
      size="sm"
      icon={adminsOnly ? <LockClosedMark size={14} /> : <LockOpenMark size={14} />}
      title={label}
      aria-label={label}
      aria-pressed={adminsOnly}
      disabled={pending}
      className={adminsOnly ? 'provider-lock provider-lock-closed' : 'provider-lock'}
      onClick={toggle}
    />
  )
}

export function ContributorForm({
  telegramLabel,
  discordLabel,
  linkedinLabel,
  linkedinEnabled,
  adminsOnly,
  defaults,
  emailConfirmedAt,
  emailConfirmationSentAt,
  tracks,
  notice,
}: Props) {
  // IDEA-069 — always editable now (Profile opens straight here from the
  // account menu; there's no separate view mode to default into or toggle
  // back to). `name`/`email` mirror the two mandatory fields' live values,
  // kept only so Save can check them; autosave persists each field as it's
  // typed independently of these.
  const router = useRouter()
  const [name, setName] = useState(defaults.name)
  const [email, setEmail] = useState(defaults.email)
  const [company, setCompany] = useState(defaults.company)
  const [saveMessage, setSaveMessage] = useState<string>()

  // IDEA-034 — recomputed on every render from the same live state Save's
  // gate already tracks, so the badge updates the instant a field autosaves
  // rather than only after the next page load. discordLabel/telegramLabel/
  // linkedinLabel and emailConfirmedAt aren't live state themselves (they
  // only change via a full-page redirect back to this page — a provider
  // OAuth flow, or the emailed confirmation link — same caveat already
  // documented on handleSave and EmailField's confirmedAt/sentAt props), but
  // that redirect always re-renders this component fresh, so they're never
  // stale for longer than that round trip.
  const completenessInput = {
    name,
    email,
    company,
    discordLinked: Boolean(discordLabel),
    emailConfirmed: Boolean(emailConfirmedAt),
    telegramLinked: Boolean(telegramLabel),
    linkedinLinked: Boolean(linkedinLabel),
    linkedinEnabled,
  }
  const completeness = computeProfileCompleteness(completenessInput)
  const missingForBadge = missingForCompleteness(completenessInput)

  // IDEA-069 — Save leaves Profile entirely, back to Home, same as Close;
  // the difference is Save also force-persists the three mandatory fields
  // via the same saveField server action autosave itself calls, rather than
  // trusting that each field's own debounce/blur already landed before
  // navigating away. Discord has no live client-side state of its own (it
  // only changes via a full-page OAuth redirect back to this same page), so
  // discordLabel — the prop, already current as of the last render —
  // stands in directly for the mandatory-field check.
  async function handleSave() {
    const missing = missingMandatoryFields({ name, email, company, discordUsername: discordLabel ?? undefined })
    if (missing.length > 0) {
      setSaveMessage(`Please fill in: ${missing.join(', ')}.`)
      return
    }
    setSaveMessage(undefined)
    await Promise.all([saveField('name', name, 'final'), saveField('email', email, 'final'), saveField('company', company, 'final')])
    router.push('/')
  }

  // Unlike Save, Close skips both missingMandatoryFields and the explicit
  // persistence step — every field already autosaves individually as it's
  // typed, so there is nothing Close needs to guarantee that a normal edit
  // session hasn't already covered.
  function handleClose() {
    setSaveMessage(undefined)
    router.push('/')
  }

  return (
    <>
      <Breadcrumb path={[HOME_BREADCRUMB]} />
      <h2>Contributor Profile</h2>
      <p className="subtitle">Please share your contact details below to make it easier for other community members to reach you and for us to grant you access to relevant community resources.</p>

      {/* IDEA-034/084 — owner-only (this form is never rendered for anyone
          but the signed-in contributor's own profile; the public read-only
          view is PublicProfileView, a separate component). Recomputed live
          from the same state Save's own gate tracks, shown in both modes,
          not just view, so it updates as fields autosave in edit mode
          rather than only after the next page load. Keeps the completeness
          badge and its "still needed" hint (per user confirmation) but drops
          the Stranger/Contributor identity badge every other surface also
          dropped — see profile-labels.tsx's own doc comments. */}
      <div className="profile-labels">
        <TrackBadges tracks={tracks} />
        <Badge
          variant={PROFILE_COMPLETENESS_VARIANTS[completeness]}
          title="Profile completeness — derived from what's filled in, not admin-set"
        >
          {PROFILE_COMPLETENESS_LABELS[completeness]}
        </Badge>
        {missingForBadge.length > 0 ? (
          <Hint className="completeness-info" label={<InfoMark size={14} />} detail={`Still needed: ${missingForBadge.join(', ')}.`} />
        ) : null}
      </div>

      {notice ? <p className={notice.kind}>{notice.message}</p> : null}
      {saveMessage ? <p className="error" role="alert">{saveMessage}</p> : null}

      {/* No submit button: every field autosaves on its own (Telegram and
          Discord navigate to their own OAuth flow instead), so this isn't a
          form that gets submitted — it's grouped markup for its labels. */}
      <form className="profile-form" onSubmit={(e) => e.preventDefault()}>
        <AutosaveField
          field="name"
          label="Full Name"
          placeholder="e.g. John Doe"
          defaultValue={defaults.name}
          onValueChange={setName}
        />
        <EmailField
          defaultValue={defaults.email}
          confirmedAt={emailConfirmedAt}
          sentAt={emailConfirmationSentAt}
          onValueChange={setEmail}
        />
        <CompanyField defaultValue={defaults.company} onValueChange={setCompany} />
        <ProviderField label="Discord" value={discordLabel} href="/auth/discord" brand="discord" mark={<DiscordMark size={16} />} />
        {/* IDEA-110 — only the two optional providers get a lock; Discord is
            mandatory and never gets one at all. The lock shows even while the
            field still reads "Not linked": IDEA-110 asks for the choice to be
            available "at registration or when editing the profile," and at
            registration these fields are empty by definition, so gating the
            control on a value already being there took it away in exactly the
            case the idea named first. Deciding "when I do link Telegram, show
            it to Admins only" before linking is the point, not an edge case —
            and the flag is stored on the row regardless of whether the handle
            is there yet (see setOptionalFieldVisibility), so a lock set now
            still governs the handle linked later. */}
        <ProviderField
          label="Telegram"
          value={telegramLabel}
          href="/auth/telegram"
          brand="telegram"
          mark={<TelegramMark size={16} />}
          lock={<VisibilityLock field="telegram" initial={adminsOnly.telegram} />}
        />
        {linkedinEnabled ? (
          <ProviderField
            label="LinkedIn"
            value={linkedinLabel}
            href="/auth/linkedin"
            brand="linkedin"
            mark={<LinkedInMark size={16} />}
            lock={<VisibilityLock field="linkedin" initial={adminsOnly.linkedin} />}
          />
        ) : null}
      </form>

      <div className="form-actions">
        <Button onClick={handleSave}>Save</Button>
        <Button variant="outline" onClick={handleClose}>
          Close
        </Button>
      </div>

      <Collected />
    </>
  )
}
