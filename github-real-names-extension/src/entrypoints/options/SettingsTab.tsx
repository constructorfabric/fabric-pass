import { useEffect, useState } from 'react'

import { t } from '../../core/i18n'
import { listSources, rebuildIndex, removeSource, upsertSource } from '../../core/sources'
import { readSettings, writeState } from '../../core/store'
import { MANUAL_SOURCE_ID, PASS_SOURCE_ID, type DisplayFormat, type Settings } from '../../core/types'
import { FORMAT_PREVIEW } from './logic'

interface Props {
  onChanged?: () => void
}

function formatOptions(): Array<{ id: DisplayFormat; label: string }> {
  return [
    { id: 'parens', label: t('settingsFormatParens') },
    { id: 'brackets', label: t('settingsFormatBrackets') },
    { id: 'brackets-reversed', label: t('settingsFormatBracketsReversed') },
  ]
}

export default function SettingsTab({ onChanged }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    readSettings().then(setSettings)
  }, [])

  async function update(patch: Partial<Settings>) {
    if (!settings) return
    const next = { ...settings, ...patch }
    setSettings(next)
    await writeState({ settings: next })
    onChanged?.()
  }

  /**
   * `showDraft` is filtered in `mergeIntoIndex`, not at import time — so it's enough
   * to rebuild `idx` from the already-saved layer records, without re-importing.
   */
  async function handleShowDraftChange(value: boolean) {
    await update({ showDraft: value })
    await rebuildIndex()
    onChanged?.()
  }

  async function handleClearAll() {
    setClearing(true)
    try {
      const sources = await listSources()
      for (const source of sources) {
        // manual is not deleted and is cleared separately below; pass is also not
        // deleted and, unlike manual, isn't user data but a cache: "Clear all" doesn't
        // touch it, it refills itself lazily as the person browses GitHub.
        if (source.id === MANUAL_SOURCE_ID || source.id === PASS_SOURCE_ID) continue
        await removeSource(source.id)
      }
      const manual = sources.find((s) => s.id === MANUAL_SOURCE_ID)
      if (manual) {
        await upsertSource(
          { ...manual, rawText: '', stats: { total: 0, imported: 0, skipped: [] } },
          [],
        )
      }
      onChanged?.()
    } finally {
      setClearing(false)
      setConfirmingClear(false)
    }
  }

  if (!settings) {
    return <div className="app-loading">{t('settingsLoading')}</div>
  }

  return (
    <div>
      <section>
        <h2>{t('settingsFormatTitle')}</h2>
        {formatOptions().map((opt) => (
          <div className="radio-row" key={opt.id}>
            <input
              type="radio"
              id={`format-${opt.id}`}
              name="displayFormat"
              checked={settings.displayFormat === opt.id}
              onChange={() => update({ displayFormat: opt.id })}
            />
            <label htmlFor={`format-${opt.id}`}>{opt.label}</label>
            <span className="preview">{FORMAT_PREVIEW[opt.id]}</span>
          </div>
        ))}
      </section>

      <section>
        <h2>{t('settingsDraftsTitle')}</h2>
        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={settings.showDraft}
              onChange={(e) => handleShowDraftChange(e.target.checked)}
            />
            {' '}{t('settingsShowDraftLabel')}
          </label>
        </div>
      </section>

      <section>
        <h2>{t('settingsBadgesTitle')}</h2>
        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={settings.showAgentBadge}
              onChange={(e) => update({ showAgentBadge: e.target.checked })}
            />
            {' '}{t('settingsShowAgentBadgeLabel')}
          </label>
        </div>
        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={settings.showAdminBadge}
              onChange={(e) => update({ showAdminBadge: e.target.checked })}
            />
            {' '}{t('settingsShowAdminBadgeLabel')}
          </label>
        </div>
      </section>

      <section>
        <h2>{t('settingsGeneralTitle')}</h2>
        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => update({ enabled: e.target.checked })}
            />
            {' '}{t('settingsEnabledLabel')}
          </label>
        </div>
      </section>

      <section>
        <h2>{t('settingsDangerZoneTitle')}</h2>
        <button type="button" className="btn btn-danger" onClick={() => setConfirmingClear(true)}>
          {t('settingsClearAllButton')}
        </button>
      </section>

      {confirmingClear && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>{t('settingsClearModalTitle')}</h3>
            <p>{t('settingsClearModalBody')}</p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setConfirmingClear(false)} disabled={clearing}>
                {t('modalCancel')}
              </button>
              <button type="button" className="btn btn-danger" onClick={handleClearAll} disabled={clearing}>
                {clearing ? t('settingsClearing') : t('settingsClearConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
