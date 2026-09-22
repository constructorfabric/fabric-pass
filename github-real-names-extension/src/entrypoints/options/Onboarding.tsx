/**
 * The first screen of the options page (PLAN.md §5.2): shown when no records are
 * loaded yet. Three doors, none of them a dead end — each ends with an actual write
 * to storage, not just a hint to "go somewhere else".
 */

import { useState } from 'react'
import { t } from '../../core/i18n'
import { parseAny } from '../../core/parsers/index'
import { resolveRecords } from '../../core/resolve'
import { upsertSource } from '../../core/sources'
import { MANUAL_SOURCE_ID } from '../../core/types'
import type { ImportStats } from '../../core/types'
import { resolveEditorText, rowsToJsonText, type EditorRow } from './editor-logic'
import './editor.css'

interface OnboardingProps {
  onChanged?: () => void
  /** Switches the options page to the "Records" tab (the full EditorTab). */
  onGoToEditor?: () => void
}

type Door = 'yaml' | 'own' | 'scratch' | null

const EMPTY_ROW: EditorRow = { github_login: '', name: '', company: '', email: '', extra: {} }

export default function Onboarding({ onChanged, onGoToEditor }: OnboardingProps) {
  const [door, setDoor] = useState<Door>(null)
  const [rows, setRows] = useState<EditorRow[]>([{ ...EMPTY_ROW }])
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function reportImport(stats: ImportStats) {
    setError(null)
    setStatus(
      t('onboardingImportedSummary', [String(stats.imported), String(stats.total)]) +
        (stats.skipped.length > 0 ? t('onboardingSkippedNote', String(stats.skipped.length)) : ''),
    )
  }

  /**
   * Doors 1 and 2 (file): a regular file import, creates a new layer — same as
   * SourcesTab does. Onboarding is the first thing the person sees, so a file read
   * error or a storage failure (e.g. quota exceeded) must be shown, not silently
   * leave the screen unchanged (code review Defect 6).
   */
  async function importFile(file: File) {
    setError(null)
    setStatus(null)

    try {
      const text = await file.text()
      const parsed = parseAny(text, file.name)

      if (parsed.records.length === 0 && parsed.errors.length > 0) {
        setError(parsed.errors[0]?.message ?? t('onboardingParseFailedDefault'))
        return
      }

      const { records, stats } = resolveRecords(parsed.records)

      await upsertSource(
        { kind: parsed.format, label: file.name, enabled: true, importedAt: new Date().toISOString(), stats },
        records,
      )

      reportImport(stats)
      onChanged?.()
    } catch (e) {
      setError(t('onboardingReadFileFailed', [file.name, e instanceof Error ? e.message : String(e)]))
    }
  }

  /** Door 2 (pasting text) and door 3 (table from scratch) write directly into the `manual` layer. */
  async function saveToManualLayer(text: string) {
    const parsed = resolveEditorText(text)
    if (!parsed.ok) {
      setError(parsed.syntaxError.message)
      return
    }

    // Writing to storage can fail (quota, revoked access). Onboarding is the first
    // thing the person sees, and a silent failure here is the most costly.
    try {
      await upsertSource(
        {
          id: MANUAL_SOURCE_ID,
          kind: 'manual',
          label: t('sourcesManualDefaultLabel'),
          enabled: true,
          importedAt: new Date().toISOString(),
          rawText: text,
          stats: parsed.stats,
        },
        parsed.records,
      )
    } catch (e) {
      setError(t('onboardingSaveFailed', e instanceof Error ? e.message : String(e)))
      return
    }

    reportImport(parsed.stats)
    onChanged?.()
  }

  function updateRow(index: number, field: keyof EditorRow, value: string) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)))
  }

  function addRow() {
    setRows((prev) => [...prev, { ...EMPTY_ROW }])
  }

  return (
    <div className="ghe-root ghe-onboarding">
      <p className="ghe-onboarding-intro">{t('onboardingIntro')}</p>

      <div className="ghe-doors">
        <button
          type="button"
          className={door === 'yaml' ? 'ghe-door ghe-door--active' : 'ghe-door'}
          onClick={() => setDoor('yaml')}
        >
          {t('onboardingDoorYaml')}
        </button>
        <button
          type="button"
          className={door === 'own' ? 'ghe-door ghe-door--active' : 'ghe-door'}
          onClick={() => setDoor('own')}
        >
          {t('onboardingDoorOwn')}
        </button>
        <button
          type="button"
          className={door === 'scratch' ? 'ghe-door ghe-door--active' : 'ghe-door'}
          onClick={() => setDoor('scratch')}
        >
          {t('onboardingDoorScratch')}
        </button>
      </div>

      {door === 'yaml' && (
        <div className="ghe-door-content">
          <p>{t('onboardingYamlPrompt')}</p>
          <input
            type="file"
            accept=".yaml,.yml"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void importFile(file)
            }}
          />
        </div>
      )}

      {door === 'own' && (
        <div className="ghe-door-content">
          <input
            type="file"
            accept=".json,.csv"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void importFile(file)
            }}
          />
          <div className="ghe-json-toolbar">
            <button type="button" onClick={() => onGoToEditor?.()}>
              {t('onboardingInsertTextButton')}
            </button>
          </div>
        </div>
      )}

      {door === 'scratch' && (
        <div className="ghe-door-content">
          <table className="ghe-table">
            <thead>
              <tr>
                <th>{t('editorTableHeaderLogin')}</th>
                <th>{t('editorTableHeaderName')}</th>
                <th>{t('editorTableHeaderCompany')}</th>
                <th>{t('editorTableHeaderEmail')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  <td>
                    <input value={row.github_login} onChange={(e) => updateRow(index, 'github_login', e.target.value)} />
                  </td>
                  <td>
                    <input value={row.name} onChange={(e) => updateRow(index, 'name', e.target.value)} />
                  </td>
                  <td>
                    <input value={row.company} onChange={(e) => updateRow(index, 'company', e.target.value)} />
                  </td>
                  <td>
                    <input value={row.email} onChange={(e) => updateRow(index, 'email', e.target.value)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="ghe-json-toolbar">
            <button type="button" onClick={addRow}>
              {t('actionAddRow')}
            </button>
            <button type="button" onClick={() => void saveToManualLayer(rowsToJsonText(rows))}>
              {t('onboardingStartButton')}
            </button>
          </div>
        </div>
      )}

      {status && <div className="ghe-save-message">{status}</div>}
      {error && <div className="ghe-issue ghe-issue--error">{error}</div>}
    </div>
  )
}
