/**
 * Popup — quickly adding a name for a login visible on the currently open GitHub page.
 *
 * Shortens the path "saw an unfamiliar login in a PR → went to settings → opened the
 * editor → recalled the login" down to two clicks: open the popup, see the logins
 * without a name right from the page, type in the name, save. The name appearing on
 * the page without a reload is thanks to the content script (`onStateChanged` in
 * `content/index.ts`) — the popup doesn't send anything extra for that.
 */

import { useEffect, useState } from 'react'

import { PASS_ORIGIN } from '../../core/config'
import { t } from '../../core/i18n'
import type { CollectLoginsResponse, PassStatusRequest, PassStatusResponse } from '../../core/messages'
import { getRecords, listSources, upsertSource } from '../../core/sources'
import { readIdx } from '../../core/store'
import { MANUAL_SOURCE_ID } from '../../core/types'
import {
  buildManualContributor,
  buildUpdatedManualSource,
  isGithubUrl,
  shouldShowPassSignedOutHint,
  splitLogins,
  statusForSilentContentScript,
  upsertIntoRecords,
  type SplitLoginsResult,
} from './logic'
import './popup.css'

type Status = 'loading' | 'not-github' | 'no-content-script' | 'ready'

export default function App() {
  const [status, setStatus] = useState<Status>('loading')
  const [split, setSplit] = useState<SplitLoginsResult>({ named: [], unnamed: [] })
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set())
  const [namedExpanded, setNamedExpanded] = useState(false)
  /**
   * `undefined` when the status message rejected (service worker asleep) — treated
   * the same as "don't show the hint", not as an error state.
   */
  const [passStatus, setPassStatus] = useState<PassStatusResponse['lastStatus'] | undefined>(undefined)

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setStatus('loading')

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
    if (!tab || tab.id === undefined) {
      setStatus('not-github')
      return
    }

    // Only a URL we can actually read and that is NOT GitHub is a reason to stop early.
    // `tab.url` comes back `undefined` without a host permission for the tab, and treating
    // that as "not GitHub" is exactly the bug that made the popup unusable on github.com.
    // The content script — declared on `https://github.com/*` and nowhere else — is the
    // authoritative answer, so when the URL is unknown we ask it instead of guessing.
    if (tab.url !== undefined && !isGithubUrl(tab.url)) {
      setStatus('not-github')
      return
    }

    let response: CollectLoginsResponse
    try {
      response = await browser.tabs.sendMessage(tab.id, { type: 'ghname:collect-logins' })
    } catch {
      setStatus(statusForSilentContentScript(tab.url))
      return
    }

    const idx = await readIdx()
    setSplit(splitLogins(response, idx))

    try {
      const request: PassStatusRequest = { type: 'ghname:pass-status' }
      const passResponse: PassStatusResponse = await browser.runtime.sendMessage(request)
      setPassStatus(passResponse.lastStatus)
    } catch {
      setPassStatus(undefined)
    }

    setStatus('ready')
  }

  async function handleSave(loginKey: string, login: string) {
    const name = drafts[loginKey]?.trim()
    if (!name) return

    const contributor = buildManualContributor(login, name)
    const records = await getRecords(MANUAL_SOURCE_ID)
    const nextRecords = upsertIntoRecords(records, contributor)

    const sources = await listSources()
    const manualSource = sources.find((s) => s.id === MANUAL_SOURCE_ID)
    if (!manualSource) return

    // `buildUpdatedManualSource` keeps `rawText`/`stats` consistent with `records` —
    // otherwise the editor (`EditorTab.loadLayer` treats `rawText` as the source of
    // truth) would keep showing the layer without the records added here.
    await upsertSource(buildUpdatedManualSource(manualSource, nextRecords), nextRecords)

    setSavedKeys((prev) => new Set(prev).add(loginKey))
    setSplit((prev) => ({
      named: [...prev.named, { login, loginKey, displayName: contributor.display_name }],
      unnamed: prev.unnamed.filter((u) => u.loginKey !== loginKey),
    }))
  }

  function handleOpenOptions() {
    browser.runtime.openOptionsPage()
  }

  if (status === 'loading') {
    return (
      <div className="popup">
        <div className="popup-loading">{t('popupLoading')}</div>
      </div>
    )
  }

  if (status === 'not-github') {
    return (
      <div className="popup">
        <p className="popup-hint">
          {t('popupNotGithubPrefix')} <strong>github.com</strong>
          {t('popupNotGithubSuffix')}
        </p>
        <button type="button" className="btn" onClick={handleOpenOptions}>
          {t('popupOpenSettingsButton')}
        </button>
      </div>
    )
  }

  if (status === 'no-content-script') {
    return (
      <div className="popup">
        <p className="popup-hint">{t('popupNoContentScriptHint')}</p>
        <button type="button" className="btn" onClick={handleOpenOptions}>
          {t('popupOpenSettingsButton')}
        </button>
      </div>
    )
  }

  const total = split.named.length + split.unnamed.length

  return (
    <div className="popup">
      <div className="popup-counter">
        {t('popupCounter', [
          String(split.named.length),
          split.named.length === 1 ? t('popupNameOne') : t('popupNameOther'),
          String(total),
        ])}
      </div>

      {shouldShowPassSignedOutHint(passStatus, split.unnamed.length) && (
        <p className="popup-hint">
          {t('popupPassSignedOutHint')}{' '}
          <button type="button" className="btn" onClick={() => browser.tabs.create({ url: PASS_ORIGIN })}>
            {t('sourcesPassOpenButton')}
          </button>
        </p>
      )}

      {split.unnamed.length === 0 ? (
        <p className="popup-hint">{t('popupAllNamedHint')}</p>
      ) : (
        <ul className="popup-list">
          {split.unnamed.map((entry) => (
            <li key={entry.loginKey} className="popup-row">
              <span className="popup-login">{entry.login}</span>
              <input
                type="text"
                className="popup-input"
                placeholder={t('popupNamePlaceholder')}
                value={drafts[entry.loginKey] ?? ''}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [entry.loginKey]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSave(entry.loginKey, entry.login)
                }}
              />
              <button
                type="button"
                className="btn btn-save"
                disabled={!drafts[entry.loginKey]?.trim()}
                onClick={() => void handleSave(entry.loginKey, entry.login)}
              >
                {t('popupSaveButton')}
              </button>
            </li>
          ))}
        </ul>
      )}

      {split.named.length > 0 && (
        <details className="popup-named" open={namedExpanded} onToggle={(e) => setNamedExpanded(e.currentTarget.open)}>
          <summary>{t('popupAlreadyNamedSummary', String(split.named.length))}</summary>
          <ul className="popup-list popup-list--named">
            {split.named.map((entry) => (
              <li key={entry.loginKey} className="popup-row popup-row--named">
                <span className="popup-login">{entry.login}</span>
                <span className="popup-name">
                  {entry.displayName}
                  {savedKeys.has(entry.loginKey) ? ' ✓' : ''}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <button type="button" className="btn popup-settings-link" onClick={handleOpenOptions}>
        {t('popupOpenSettingsButton')}
      </button>
    </div>
  )
}
