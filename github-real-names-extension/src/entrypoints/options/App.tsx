import { useCallback, useEffect, useState } from 'react'

import { t } from '../../core/i18n'
import { readState } from '../../core/store'
import EditorTab from './EditorTab'
import Onboarding from './Onboarding'
import SettingsTab from './SettingsTab'
import SourcesTab from './SourcesTab'
import './style.css'

type Tab = 'sources' | 'records' | 'settings'

function tabs(): Array<{ id: Tab; label: string }> {
  return [
    { id: 'sources', label: t('tabSources') },
    { id: 'records', label: t('tabRecords') },
    { id: 'settings', label: t('tabSettings') },
  ]
}

export default function App() {
  const [tab, setTab] = useState<Tab>('sources')
  /** Empty until we've read `idx` at least once — undefined distinguishes "still loading" from "actually empty". */
  const [isEmpty, setIsEmpty] = useState<boolean | undefined>(undefined)
  /**
   * An explicit transition to the editor from onboarding (the "I have my own list" →
   * "Paste text" path) must keep the user in the editor, even while the index is
   * still empty — otherwise someone who hasn't saved anything yet would immediately
   * fall back into onboarding.
   */
  const [dismissedOnboarding, setDismissedOnboarding] = useState(false)

  const reload = useCallback(async () => {
    const state = await readState()
    setIsEmpty(Object.keys(state.idx).length === 0)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  if (isEmpty === undefined) {
    return <div className="app-loading">{t('appLoading')}</div>
  }

  if (isEmpty && !dismissedOnboarding) {
    return (
      <div className="app">
        <Onboarding
          onChanged={reload}
          onGoToEditor={() => {
            setDismissedOnboarding(true)
            setTab('records')
          }}
        />
      </div>
    )
  }

  return (
    <div className="app">
      <nav className="tabs">
        {tabs().map((tabDef) => (
          <button
            key={tabDef.id}
            type="button"
            className={tabDef.id === tab ? 'tab active' : 'tab'}
            onClick={() => setTab(tabDef.id)}
          >
            {tabDef.label}
          </button>
        ))}
      </nav>
      <main>
        {tab === 'sources' && <SourcesTab onChanged={reload} />}
        {tab === 'records' && <EditorTab onChanged={reload} />}
        {tab === 'settings' && <SettingsTab onChanged={reload} />}
      </main>
    </div>
  )
}
