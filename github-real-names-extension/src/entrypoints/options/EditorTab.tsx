/**
 * Editor for the hand-written mapping (PLAN.md §5.5): two projections of the same
 * layer — JSON view (textarea + live validation) and Table view (login/name/company/email).
 *
 * All parsing, validation, and conversion logic is factored out into `editor-logic.ts` —
 * this component only holds the form state and calls the ready-made pure functions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { pluralize, t } from '../../core/i18n'
import { getRecords, listSources, upsertSource } from '../../core/sources'
import { readState } from '../../core/store'
import { MANUAL_SOURCE_ID } from '../../core/types'
import type { Source } from '../../core/types'
import {
  exampleSkeleton,
  exportMapping,
  jsonTextToRows,
  mergeAllRecords,
  resolveEditorText,
  rowsToJsonText,
  validateJsonText,
  type EditorRow,
  type ValidationResult,
} from './editor-logic'
import { downloadJson } from './logic'
import './editor.css'

interface EditorTabProps {
  onChanged?: () => void
}

type ViewMode = 'json' | 'table'

const VALIDATION_DEBOUNCE_MS = 400

export default function EditorTab({ onChanged }: EditorTabProps) {
  const [sources, setSources] = useState<Source[]>([])
  const [layerId, setLayerId] = useState<string>(MANUAL_SOURCE_ID)
  const [rawText, setRawText] = useState('')
  const [savedText, setSavedText] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('json')
  const [rows, setRows] = useState<EditorRow[]>([])
  const [search, setSearch] = useState('')
  const [validation, setValidation] = useState<ValidationResult>(() => validateJsonText(''))
  const [pendingLayerId, setPendingLayerId] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dirty = rawText !== savedText

  /** Editable layers: `manual` always, plus any source that has a saved `rawText`. */
  const editableSources = useMemo(
    () => sources.filter((s) => s.id === MANUAL_SOURCE_ID || s.rawText !== undefined),
    [sources],
  )

  const loadLayer = useCallback(async (id: string) => {
    const state = await readState()
    const source = state.sources.find((s) => s.id === id)
    const text = source?.rawText ?? ''
    setLayerId(id)
    setRawText(text)
    setSavedText(text)
    setValidation(validateJsonText(text))
    setViewMode('json')
    setSaveMessage(null)
  }, [])

  useEffect(() => {
    void (async () => {
      const list = await listSources()
      setSources(list)
      await loadLayer(MANUAL_SOURCE_ID)
    })()
  }, [loadLayer])

  // Live validation with debounce — the status line shouldn't jitter on every keystroke.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setValidation(validateJsonText(rawText))
    }, VALIDATION_DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [rawText])

  // Guard against closing/reloading the page with unsaved changes.
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirty) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [dirty])

  function handleValidateClick() {
    setValidation(validateJsonText(rawText))
  }

  function jsonParses(): boolean {
    try {
      JSON.parse(rawText)
      return true
    } catch {
      return false
    }
  }

  function handleFormat() {
    try {
      const parsed = JSON.parse(rawText)
      setRawText(JSON.stringify(parsed, null, 2))
    } catch {
      // The button is disabled for invalid JSON — we shouldn't be able to get here.
    }
  }

  function handleInsertExample() {
    setRawText(exampleSkeleton())
  }

  async function handleSave() {
    const parsed = resolveEditorText(rawText)
    if (!parsed.ok) return

    const source = sources.find((s) => s.id === layerId)

    await upsertSource(
      {
        id: layerId,
        kind: source?.kind ?? 'manual',
        label: source?.label ?? t('sourcesManualDefaultLabel'),
        enabled: source?.enabled ?? true,
        importedAt: new Date().toISOString(),
        rawText,
        stats: parsed.stats,
      },
      parsed.records,
    )

    setSavedText(rawText)
    setSaveMessage(t('editorSaveMessage', [String(parsed.stats.imported), String(parsed.stats.total)]))
    setSources(await listSources())
    onChanged?.()
  }

  /**
   * `validation` in state is delayed by 400ms (see live validation above) and so may
   * describe text that has already been REPLACED. Switching to the table is destructive:
   * `jsonTextToRows` on invalid text silently returns `[]`, and switching back "To JSON"
   * would then overwrite `rawText` with an empty array. So the decision to switch is made
   * based on a fresh, synchronous validation of the CURRENT text, not on stale state
   * (code review Defect 1).
   */
  function handleSwitchToTable() {
    const fresh = validateJsonText(rawText)
    setValidation(fresh)
    if (!fresh.ok) return
    setRows(jsonTextToRows(rawText))
    setViewMode('table')
  }

  function handleSwitchToJson() {
    const text = rowsToJsonText(rows)
    setRawText(text)
    setValidation(validateJsonText(text))
    setViewMode('json')
  }

  function updateRow(index: number, field: keyof EditorRow, value: string) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)))
  }

  function addRow() {
    setRows((prev) => [...prev, { github_login: '', name: '', company: '', email: '', extra: {} }])
  }

  function deleteRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleLayerChange(id: string) {
    if (id === layerId) return
    if (dirty) {
      setPendingLayerId(id)
      return
    }
    await loadLayer(id)
  }

  async function confirmLayerChange() {
    const id = pendingLayerId
    setPendingLayerId(null)
    if (id) await loadLayer(id)
  }

  function cancelLayerChange() {
    setPendingLayerId(null)
  }

  async function handleExportLayer() {
    const records = await getRecords(layerId)
    downloadJson(exportMapping(records), `${layerId}.json`)
  }

  async function handleExportMerged() {
    const state = await readState()
    downloadJson(exportMapping(mergeAllRecords(state.sources, state.records, state.settings)), 'mapping-merged.json')
  }

  function handleDownloadSkipped() {
    downloadJson(JSON.stringify(validation.recordIssues, null, 2), 'skipped-records.json')
  }

  const filteredRows = rows.filter((row) => {
    const q = search.trim().toLowerCase()
    if (q === '') return true
    return (
      row.github_login.toLowerCase().includes(q) ||
      row.name.toLowerCase().includes(q) ||
      row.company.toLowerCase().includes(q) ||
      row.email.toLowerCase().includes(q)
    )
  })

  const isEmptyText = rawText.trim() === ''

  // An empty layer isn't "0 records · 0 issues" either — that reads like a file that
  // got parsed and turned out empty. Say plainly that there's nothing here yet.
  const statusLine = isEmptyText
    ? t('editorStatusEmpty')
    : validation.ok
    ? `${validation.recordCount} ${pluralize(validation.recordCount, {
        one: t('editorRecordOne'),
        few: t('editorRecordFew'),
        many: t('editorRecordMany'),
      })} · ` +
      `${validation.recordIssues.length} ${pluralize(validation.recordIssues.length, {
        one: t('editorIssueOne'),
        few: t('editorIssueFew'),
        many: t('editorIssueMany'),
      })}`
    : t('editorStatusNotParsed')

  return (
    <div className="ghe-root">
      <div className="ghe-toolbar">
        <label className="ghe-layer-select">
          {t('editorLayerLabel')}
          <select value={layerId} onChange={(e) => void handleLayerChange(e.target.value)}>
            {editableSources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <div className="ghe-view-toggle">
          <button type="button" disabled={viewMode === 'json'} onClick={() => setViewMode('json')}>
            JSON
          </button>
          <button
            type="button"
            disabled={viewMode === 'table' || !validation.ok}
            title={!validation.ok ? validation.syntaxError?.message : undefined}
            onClick={handleSwitchToTable}
          >
            {t('editorTableViewButton')}
          </button>
        </div>
      </div>

      {viewMode === 'json' ? (
        <div className="ghe-json-view">
          <div className="ghe-json-toolbar">
            <button type="button" onClick={handleValidateClick}>
              {t('editorValidateButton')}
            </button>
            <button type="button" onClick={() => void handleSave()} disabled={!validation.ok || isEmptyText}>
              {t('editorSaveButton')}
            </button>
            <button type="button" onClick={handleFormat} disabled={!jsonParses()}>
              {t('editorFormatButton')}
            </button>
            <button type="button" onClick={handleInsertExample}>
              {t('editorInsertExampleButton')}
            </button>
          </div>

          <textarea
            className="ghe-textarea"
            spellCheck={false}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
          />

          <div className="ghe-status-line">{statusLine}</div>

          {saveMessage && <div className="ghe-save-message">{saveMessage}</div>}

          {!validation.ok && validation.syntaxError && (
            <div className="ghe-issue ghe-issue--error">
              {validation.syntaxError.line !== undefined
                ? t('errorLineColumn', [String(validation.syntaxError.line), String(validation.syntaxError.column ?? '?')])
                : ''}
              {validation.syntaxError.message}
            </div>
          )}

          {validation.recordIssues.length > 0 && (
            <details className="ghe-issues">
              <summary>{t('editorSkippedSummary', String(validation.recordIssues.length))}</summary>
              <ul>
                {validation.recordIssues.map((issue, i) => (
                  <li key={i}>
                    #{issue.index}
                    {issue.login ? ` (${issue.login})` : ''} — {issue.reason}
                    {issue.detail ? `: ${issue.detail}` : ''}
                  </li>
                ))}
              </ul>
              <button type="button" onClick={handleDownloadSkipped}>
                {t('actionDownloadSkipped')}
              </button>
            </details>
          )}

          {validation.unknownFields.length > 0 && (
            <details className="ghe-issues ghe-issues--warning">
              <summary>{t('editorUnknownFieldsSummary', String(validation.unknownFields.length))}</summary>
              <ul>
                {validation.unknownFields.map((f, i) => (
                  <li key={i}>
                    {f.suggestion
                      ? t('editorUnknownFieldItemWithSuggestion', [String(f.index), f.field, f.suggestion])
                      : t('editorUnknownFieldItem', [String(f.index), f.field])}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      ) : (
        <div className="ghe-table-view">
          <div className="ghe-table-toolbar">
            <input
              type="search"
              placeholder={t('editorTableSearchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button type="button" onClick={addRow}>
              {t('actionAddRow')}
            </button>
            <button type="button" onClick={handleSwitchToJson}>
              {t('editorToJsonButton')}
            </button>
          </div>

          <table className="ghe-table">
            <thead>
              <tr>
                <th>{t('editorTableHeaderLogin')}</th>
                <th>{t('editorTableHeaderName')}</th>
                <th>{t('editorTableHeaderCompany')}</th>
                <th>{t('editorTableHeaderEmail')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const index = rows.indexOf(row)
                return (
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
                    <td>
                      <button type="button" onClick={() => deleteRow(index)}>
                        {t('actionDelete')}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="ghe-export">
        <button type="button" onClick={() => void handleExportLayer()}>
          {t('editorDownloadLayerButton')}
        </button>
        <button type="button" onClick={() => void handleExportMerged()}>
          {t('editorDownloadMergedButton')}
        </button>
      </div>

      {pendingLayerId && (
        <div className="ghe-modal-backdrop">
          <div className="ghe-modal">
            <p>{t('editorUnsavedChangesPrompt')}</p>
            <div className="ghe-modal-actions">
              <button type="button" onClick={cancelLayerChange}>
                {t('modalCancel')}
              </button>
              <button type="button" onClick={() => void confirmLayerChange()}>
                {t('editorSwitchWithoutSavingButton')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
