import { useEffect, useRef, useState } from 'react'

import { PASS_ORIGIN } from '../../core/config'
import { pluralize, t } from '../../core/i18n'
import type {
  ClearPassCacheRequest,
  FetchUrlSourceRequest,
  FetchUrlSourceResponse,
  PassStatusRequest,
  PassStatusResponse,
} from '../../core/messages'
import {
  explain,
  findExistingSource,
  getRecords,
  isFilteredByPreference,
  listSources,
  removeSource,
  reorder,
  setEnabled,
  upsertSource,
} from '../../core/sources'
import { readSettings } from '../../core/store'
import {
  MANUAL_SOURCE_ID,
  PASS_SOURCE_ID,
  type ConflictExplanation,
  type Contributor,
  type Settings,
  type Source,
} from '../../core/types'
import {
  buildSkippedExport,
  downloadJson,
  formatDate,
  formatImportSummary,
  formatParseErrors,
  importFailed,
  importPipeline,
  passStatusLabel,
  skipReasonLabel,
  type ImportPipelineResult,
} from './logic'
import { filenameFromUrl, formatFetchError, originPattern, parseFilenameHint, validateUrl } from '../../core/url-source'

/**
 * Asks background to fetch the text at the given URL. Wrapped separately so that
 * errors from `sendMessage` itself (e.g. the channel closed before the response)
 * are formatted with the same `formatFetchError` as network errors inside background.
 */
async function fetchViaBackground(url: string): Promise<FetchUrlSourceResponse> {
  try {
    const request: FetchUrlSourceRequest = { type: 'ghname:fetch-url', url }
    return await browser.runtime.sendMessage(request)
  } catch (e) {
    return { ok: false, error: formatFetchError(e) }
  }
}

/** Name for `parseAny`: a hint from Content-Type/extension, or the last path segment itself if there's none. */
function resolveParseFilename(url: URL, contentType: string | undefined): string {
  return parseFilenameHint(contentType, url) ?? filenameFromUrl(url)
}

interface Props {
  onChanged?: () => void
}

interface PendingImport {
  filename: string
  result: ImportPipelineResult
  existing: Source
}

export default function SourcesTab({ onChanged }: Props) {
  const [sources, setSources] = useState<Source[] | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [dragging, setDragging] = useState(false)
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
  const [lastImport, setLastImport] = useState<{ label: string; result: ImportPipelineResult } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [expandedSkipped, setExpandedSkipped] = useState<Set<string>>(new Set())
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [conflictQuery, setConflictQuery] = useState('')
  const [conflictResult, setConflictResult] = useState<ConflictExplanation | null>(null)
  /** Layer records by id — needed only for the "hidden by settings" counter, not for import. */
  const [recordsBySource, setRecordsBySource] = useState<Record<string, Contributor[]>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [urlInput, setUrlInput] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)
  const [urlBusy, setUrlBusy] = useState(false)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  /**
   * The last refresh error by layer id. Lives only in component state, not in
   * storage: the layer itself and its records don't change on a failed refresh, and
   * the error is momentary feedback to the user, not part of the data.
   */
  const [refreshErrors, setRefreshErrors] = useState<Record<string, string>>({})

  /**
   * The pass layer's status, fetched from background (the only context with the
   * pass session). `null` means either "not loaded yet" or "the service worker was
   * asleep and the message rejected" — either way the card renders without the
   * status block rather than breaking the whole tab (spec, phase 5).
   */
  const [passStatus, setPassStatus] = useState<PassStatusResponse | null>(null)
  const [clearingPassCache, setClearingPassCache] = useState(false)

  async function loadPassStatus() {
    try {
      const request: PassStatusRequest = { type: 'ghname:pass-status' }
      setPassStatus(await browser.runtime.sendMessage(request))
    } catch {
      setPassStatus(null)
    }
  }

  async function load() {
    const [nextSources, nextSettings] = await Promise.all([listSources(), readSettings()])
    setSources(nextSources)
    setSettings(nextSettings)
    const entries = await Promise.all(nextSources.map(async (s) => [s.id, await getRecords(s.id)] as const))
    setRecordsBySource(Object.fromEntries(entries))
    await loadPassStatus()
  }

  /**
   * "Clear cache" for the pass layer: unlike `refreshUrlSource`, there's nothing to
   * refetch on demand — this only forgets what's cached, and names refill lazily the
   * next time a GitHub page asks about them (background handles that, phase 3/4).
   * `load()` re-reads both the layer's records (now empty) and the fresh status.
   */
  async function handleClearPassCache() {
    setClearingPassCache(true)
    try {
      const request: ClearPassCacheRequest = { type: 'ghname:clear-pass-cache' }
      await browser.runtime.sendMessage(request)
      await load()
      onChanged?.()
    } catch {
      // Same guard as loadPassStatus — a sleeping service worker must not break the tab.
    } finally {
      setClearingPassCache(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  /** How many layer records don't make it into `idx` because of `showDraft`/`is_agent` — computed from current records, not from import stats. */
  function hiddenByPreferenceCount(source: Source): number {
    if (!settings) return 0
    const records = recordsBySource[source.id] ?? []
    return records.filter((r) => isFilteredByPreference(r, settings)).length
  }

  async function processFile(file: File) {
    setImportError(null)
    let text: string
    try {
      text = await file.text()
    } catch {
      setImportError(t('sourcesReadFileFailed', file.name))
      return
    }

    const result = importPipeline(text, file.name)
    if (importFailed(result)) {
      setImportError(t('sourcesParseFileFailed', [file.name, formatParseErrors(result.errors)]))
      return
    }

    const existing = sources ? findExistingSource(sources, file.name, result.format) : undefined

    if (existing) {
      setPendingImport({ filename: file.name, result, existing })
    } else {
      await commitImport(file.name, result)
    }
  }

  async function commitImport(filename: string, result: ImportPipelineResult, existing?: Source) {
    await upsertSource(
      {
        id: existing?.id,
        kind: result.format,
        label: filename,
        enabled: existing?.enabled ?? true,
        importedAt: new Date().toISOString(),
        rawText: existing?.rawText,
        url: existing?.url,
        stats: { total: result.stats.total, imported: result.stats.imported, skipped: result.stats.skipped },
      },
      result.records,
    )
    setLastImport({ label: filename, result })
    setPendingImport(null)
    await load()
    onChanged?.()
  }

  function handleFileList(files: FileList | null) {
    const file = files?.[0]
    if (file) processFile(file)
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    handleFileList(e.dataTransfer.files)
  }

  async function moveSource(id: string, direction: -1 | 1) {
    if (!sources) return
    const index = sources.findIndex((s) => s.id === id)
    const target = index + direction
    if (index === -1 || target < 0 || target >= sources.length) return

    const ids = sources.map((s) => s.id)
    const swapped = [...ids]
    const tmp = swapped[index]!
    swapped[index] = swapped[target]!
    swapped[target] = tmp

    await reorder(swapped)
    await load()
    onChanged?.()
  }

  async function toggleEnabled(id: string, enabled: boolean) {
    await setEnabled(id, enabled)
    await load()
    onChanged?.()
  }

  async function confirmRemove() {
    if (!removingId) return
    await removeSource(removingId)
    setRemovingId(null)
    await load()
    onChanged?.()
  }

  function toggleSkipExpanded(id: string) {
    setExpandedSkipped((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function downloadSkipped(source: Source) {
    downloadJson(buildSkippedExport(source), `${source.label}.skipped.json`)
  }

  async function runExplain() {
    const login = conflictQuery.trim()
    if (!login) {
      setConflictResult(null)
      return
    }
    setConflictResult(await explain(login))
  }

  /**
   * Adding a URL source. `browser.permissions.request` is called synchronously
   * relative to the click (the first thing the handler does after purely synchronous
   * validation) — browsers reject the permission request if it doesn't surface as a
   * direct consequence of a user gesture.
   */
  async function handleAddUrlSource() {
    setUrlError(null)
    const validation = validateUrl(urlInput)
    if (!validation.ok || !validation.url) {
      setUrlError(validation.error ?? t('sourcesUrlInvalidDefault'))
      return
    }
    const url = validation.url
    const origin = originPattern(url)

    let granted: boolean
    try {
      granted = await browser.permissions.request({ origins: [origin] })
    } catch {
      granted = false
    }
    if (!granted) {
      setUrlError(t('sourcesUrlPermissionDenied', origin))
      return
    }

    setUrlBusy(true)
    try {
      const response = await fetchViaBackground(url.href)
      if (!response.ok || response.text === undefined) {
        setUrlError(response.error ?? t('sourcesUrlLoadFailedDefault'))
        return
      }

      const filename = resolveParseFilename(url, response.contentType)
      const result = importPipeline(response.text, filename)
      if (importFailed(result)) {
        setUrlError(t('sourcesUrlParseFailed', formatParseErrors(result.errors)))
        return
      }

      await upsertSource(
        {
          kind: 'url',
          label: filenameFromUrl(url) || url.hostname,
          enabled: true,
          importedAt: new Date().toISOString(),
          url: url.href,
          stats: { total: result.stats.total, imported: result.stats.imported, skipped: result.stats.skipped },
        },
        result.records,
      )
      setUrlInput('')
      await load()
      onChanged?.()
    } finally {
      setUrlBusy(false)
    }
  }

  /**
   * Refreshing a layer with the same address. If something went wrong — network,
   * 404, revoked permission, broken response — the layer's old records and `stats`
   * stay as they were: `upsertSource` simply isn't called, the error lands in
   * `refreshErrors` to be shown next to the layer.
   */
  async function refreshUrlSource(source: Source) {
    if (!source.url) return
    setRefreshingId(source.id)
    try {
      const url = new URL(source.url)
      const hasPermission = await browser.permissions.contains({ origins: [originPattern(url)] })
      if (!hasPermission) {
        setRefreshErrors((prev) => ({
          ...prev,
          [source.id]: t('sourcesUrlPermissionRevoked'),
        }))
        return
      }

      const response = await fetchViaBackground(source.url)
      if (!response.ok || response.text === undefined) {
        setRefreshErrors((prev) => ({ ...prev, [source.id]: response.error ?? t('sourcesUrlRefreshFailedDefault') }))
        return
      }

      const filename = resolveParseFilename(url, response.contentType)
      const result = importPipeline(response.text, filename)
      if (importFailed(result)) {
        setRefreshErrors((prev) => ({
          ...prev,
          [source.id]: t('sourcesUrlParseFailed', formatParseErrors(result.errors)),
        }))
        return
      }

      await upsertSource(
        {
          id: source.id,
          kind: 'url',
          label: source.label,
          enabled: source.enabled,
          importedAt: new Date().toISOString(),
          url: source.url,
          stats: { total: result.stats.total, imported: result.stats.imported, skipped: result.stats.skipped },
        },
        result.records,
      )
      setRefreshErrors((prev) => {
        const next = { ...prev }
        delete next[source.id]
        return next
      })
      await load()
      onChanged?.()
    } catch (e) {
      setRefreshErrors((prev) => ({ ...prev, [source.id]: formatFetchError(e) }))
    } finally {
      setRefreshingId(null)
    }
  }

  if (!sources || !settings) {
    return <div className="app-loading">{t('sourcesLoadingLayers')}</div>
  }

  return (
    <div>
      <section>
        <h2>{t('sourcesImportTitle')}</h2>
        <div
          className={dragging ? 'dropzone dragging' : 'dropzone'}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          {t('sourcesDropzoneHint')}{' '}
          <button type="button" className="btn" onClick={() => fileInputRef.current?.click()}>
            {t('sourcesChooseFileButton')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".yaml,.yml,.json,.csv"
            style={{ display: 'none' }}
            onChange={(e) => {
              handleFileList(e.target.files)
              e.target.value = ''
            }}
          />
        </div>

        {importError && <div className="warning">{importError}</div>}

        {lastImport && (
          <div className="import-summary">
            <div>
              {t('sourcesImportResultLabel', [
                lastImport.label,
                formatImportSummary(lastImport.result.stats, lastImport.result.errors),
              ])}
            </div>
            {lastImport.result.errors.length > 0 && (
              <ul className="errors-list">
                {lastImport.result.errors.map((err, i) => (
                  <li key={i}>
                    {err.line !== undefined
                      ? err.column !== undefined
                        ? t('errorLineColumn', [String(err.line), String(err.column)])
                        : t('errorLineOnly', String(err.line))
                      : ''}
                    {err.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section>
        <h2>{t('sourcesUrlSectionTitle')}</h2>
        <p>{t('sourcesUrlSectionDescription')}</p>
        <div className="field">
          <input
            type="url"
            placeholder="https://example.com/contributors.yaml"
            value={urlInput}
            disabled={urlBusy}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddUrlSource()
            }}
          />{' '}
          <button type="button" className="btn" disabled={urlBusy} onClick={handleAddUrlSource}>
            {urlBusy ? t('sourcesUrlLoading') : t('sourcesUrlAddButton')}
          </button>
        </div>
        {urlError && <div className="warning">{urlError}</div>}
      </section>

      <section>
        <h2>{t('sourcesLayersTitle')}</h2>
        <div className="source-list">
          {sources.map((source, index) => (
            <div className={source.enabled ? 'source-card' : 'source-card disabled'} key={source.id}>
              <div className="source-header">
                <input
                  type="checkbox"
                  checked={source.enabled}
                  title={t('sourcesToggleLayerTitle')}
                  onChange={(e) => toggleEnabled(source.id, e.target.checked)}
                />
                <span className="title">{source.label}</span>
                <span className="source-actions">
                  {source.kind === 'url' && (
                    <button
                      type="button"
                      className="btn-icon"
                      disabled={refreshingId === source.id}
                      title={t('sourcesRefreshUrlTitle')}
                      onClick={() => refreshUrlSource(source)}
                    >
                      {refreshingId === source.id ? '…' : '⟳'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-icon"
                    disabled={index === 0}
                    title={t('sourcesMoveUpTitle')}
                    onClick={() => moveSource(source.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn-icon"
                    disabled={index === sources.length - 1}
                    title={t('sourcesMoveDownTitle')}
                    onClick={() => moveSource(source.id, 1)}
                  >
                    ↓
                  </button>
                  {source.id === MANUAL_SOURCE_ID || source.id === PASS_SOURCE_ID ? (
                    <button
                      type="button"
                      className="btn-icon"
                      disabled
                      title={
                        source.id === MANUAL_SOURCE_ID
                          ? t('sourcesManualLockedTitle')
                          : t('sourcesPassLockedTitle')
                      }
                    >
                      🔒
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-icon"
                      title={t('sourcesDeleteLayerTitle')}
                      onClick={() => setRemovingId(source.id)}
                    >
                      ✕
                    </button>
                  )}
                </span>
              </div>
              <div className="source-meta">
                {source.kind} ·{' '}
                {source.kind === 'url' || source.kind === 'pass'
                  ? t('sourcesMetaUpdatedVerb')
                  : t('sourcesMetaImportedVerb')}{' '}
                {formatDate(source.importedAt)} · {t('sourcesMetaRecordsLabel')} {source.stats.imported}
                {source.stats.total !== source.stats.imported && ` ${t('sourcesMetaOutOf', String(source.stats.total))}`}
              </div>

              {source.kind === 'url' && refreshErrors[source.id] && (
                <div className="warning">{t('sourcesRefreshErrorMessage', refreshErrors[source.id]!)}</div>
              )}

              {source.kind === 'pass' && passStatus && (
                <>
                  <div className="source-meta">
                    {t('sourcesPassCachedNames', [
                      String(passStatus.cachedNames),
                      pluralize(passStatus.cachedNames, {
                        one: t('sourcesPassNameOne'),
                        few: t('sourcesPassNameFew'),
                        many: t('sourcesPassNameMany'),
                      }),
                    ])}{' '}
                    {passStatus.lastAuthOkAt
                      ? t('sourcesPassLastOk', formatDate(passStatus.lastAuthOkAt))
                      : t('sourcesPassNeverOk')}
                  </div>
                  <div className="source-meta">{passStatusLabel(passStatus)}</div>
                  <div className="source-meta">
                    {passStatus.lastStatus === 'unauthenticated' && (
                      <>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => browser.tabs.create({ url: PASS_ORIGIN })}
                        >
                          {t('sourcesPassOpenButton')}
                        </button>{' '}
                      </>
                    )}
                    {/* Only forgets what's cached — names refill lazily on the next GitHub
                        visit, so this isn't the destructive action it might look like. */}
                    <button type="button" className="btn" disabled={clearingPassCache} onClick={handleClearPassCache}>
                      {clearingPassCache ? '…' : t('sourcesPassClearCacheButton')}
                    </button>
                  </div>
                </>
              )}

              {hiddenByPreferenceCount(source) > 0 && (
                <div className="source-meta">
                  {t('sourcesHiddenByPreference', String(hiddenByPreferenceCount(source)))}
                </div>
              )}

              {source.stats.skipped.length > 0 && (
                <div className="skip-list">
                  <button type="button" className="btn" onClick={() => toggleSkipExpanded(source.id)}>
                    {expandedSkipped.has(source.id)
                      ? t('sourcesSkipHideN', String(source.stats.skipped.length))
                      : t('sourcesSkipShowN', String(source.stats.skipped.length))}
                  </button>{' '}
                  <button type="button" className="btn" onClick={() => downloadSkipped(source)}>
                    {t('actionDownloadSkipped')}
                  </button>
                  {expandedSkipped.has(source.id) && (
                    <ul>
                      {source.stats.skipped.map((skip, i) => (
                        <li key={i}>
                          #{skip.index + 1} {skip.login ? skip.login : t('sourcesSkipNoLogin')} — {skipReasonLabel(skip.reason)}
                          {skip.detail ? `: ${skip.detail}` : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>{t('sourcesConflictTitle')}</h2>
        <p>{t('sourcesConflictDescription')}</p>
        <div className="field">
          <input
            type="search"
            placeholder={t('sourcesConflictInputPlaceholder')}
            value={conflictQuery}
            onChange={(e) => setConflictQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runExplain()
            }}
          />{' '}
          <button type="button" className="btn" onClick={runExplain}>
            {t('sourcesConflictSearchButton')}
          </button>
        </div>

        {conflictResult && (
          <div className="conflict-result">
            {conflictResult.winner ? (
              <div className="winner">
                {t('sourcesConflictWinner', [
                  conflictResult.winner.contributor.display_name,
                  conflictResult.winner.sourceLabel,
                ])}
              </div>
            ) : (
              <div>{t('sourcesConflictNotFound', conflictResult.login_key)}</div>
            )}

            {conflictResult.losers.length > 0 && (
              <>
                <div>{t('sourcesConflictLosersTitle')}</div>
                <ul className="loser-list">
                  {conflictResult.losers.map((l) => (
                    <li key={l.sourceId}>
                      {t('sourcesConflictLayerNameItem', [l.contributor.display_name, l.sourceLabel])}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {conflictResult.disabled.length > 0 && (
              <>
                <div>{t('sourcesConflictDisabledTitle')}</div>
                <ul className="disabled-list">
                  {conflictResult.disabled.map((l) => (
                    <li key={l.sourceId}>
                      {t('sourcesConflictLayerNameItem', [l.contributor.display_name, l.sourceLabel])}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </section>

      {pendingImport && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>{t('sourcesModalLayerExistsTitle')}</h3>
            <p>
              {t('sourcesModalLayerExistsBody', [pendingImport.existing.label, pendingImport.existing.kind])}
            </p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setPendingImport(null)}>
                {t('modalCancel')}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => commitImport(`${pendingImport.filename}${t('sourcesCopySuffix')}`, pendingImport.result)}
              >
                {t('sourcesModalCreateNew')}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => commitImport(pendingImport.filename, pendingImport.result, pendingImport.existing)}
              >
                {t('sourcesModalUpdateExisting')}
              </button>
            </div>
          </div>
        </div>
      )}

      {removingId && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>{t('sourcesModalDeleteTitle')}</h3>
            <p>{t('sourcesModalDeleteBody')}</p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setRemovingId(null)}>
                {t('modalCancel')}
              </button>
              <button type="button" className="btn btn-danger" onClick={confirmRemove}>
                {t('sourcesModalDeleteConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
