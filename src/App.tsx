import React, { useEffect, useState } from 'react'
import Header from './components/Header'
import FileUpload from './components/FileUpload'
import ModelSelector from './components/ModelSelector'
import RubricPanel from './components/RubricPanel'
import RubricGeneratorPanel from './components/RubricGeneratorPanel'
import AnalysisCenter from './components/AnalysisCenter'
import LogConsole from './components/LogConsole'
import SourcesPanel from './components/SourcesPanel'
import ModelJournal from './components/ModelJournal'
import StatsHistory from './components/StatsHistory'
import KnowledgeBasePanel from './components/KnowledgeBasePanel'
import ResultsModal from './components/ResultsModal'
import SettingsModal from './components/SettingsModal'
import RubricBuilderModal from './components/RubricBuilderModal'
import { useStore } from './store/useStore'
import { fetchModels } from './services/llamaApi'

type CenterTab = 'analysis' | 'sources' | 'journal'
type RightTab = 'history' | 'knowledge'

const CENTER_TABS: { id: CenterTab; label: string; icon: string }[] = [
  { id: 'analysis', label: 'Проверка', icon: 'fa-magnifying-glass' },
  { id: 'sources', label: 'Источники', icon: 'fa-book-open' },
  { id: 'journal', label: 'Журнал запросов', icon: 'fa-code' }
]

const RIGHT_TABS: { id: RightTab; label: string; icon: string }[] = [
  { id: 'history', label: 'История', icon: 'fa-clock-rotate-left' },
  { id: 'knowledge', label: 'База знаний', icon: 'fa-database' }
]

export default function App() {
  const { config, setConnected, setModels, addLog, requestLogs } = useStore()
  const [centerTab, setCenterTab] = useState<CenterTab>('analysis')
  const [rightTab, setRightTab] = useState<RightTab>('history')

  useEffect(() => {
    const api = window.electronAPI
    if (!api) return

    // On startup just check if llama-server is already running
    setTimeout(async () => {
      try {
        const models = await fetchModels(config.llamaUrl)
        setModels(models)
        setConnected(true)
        addLog(`Подключено к llama-server. Моделей: ${models.length}`, 'success')
      } catch {
        setConnected(false)
        addLog('llama-server не запущен. Модели загрузятся автоматически при проверке.', 'info')
      }
    }, 800)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-slate-50 to-blue-50/40 overflow-hidden">
      <Header />

      <main className="flex-1 overflow-hidden p-4 lg:p-5">
        <div className="max-w-[1400px] mx-auto h-full grid grid-cols-1 lg:grid-cols-12 gap-4">

          {/* Left column — independent scroll */}
          <div className="lg:col-span-3 overflow-y-auto space-y-4 pb-4 min-h-0">
            <FileUpload />
            <ModelSelector />
            <RubricPanel />
            <RubricGeneratorPanel />
          </div>

          {/* Center column — tab bar fixed, content scrolls */}
          <div className="lg:col-span-6 flex flex-col min-h-0">
            {/* Tabs — never scroll */}
            <div className="flex gap-1 p-1 bg-white/70 backdrop-blur rounded-xl border border-slate-200 shadow-sm flex-shrink-0 mb-3">
              {CENTER_TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setCenterTab(tab.id)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all ${
                    centerTab === tab.id
                      ? 'bg-blue-600 text-white shadow'
                      : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <i className={`fa-solid ${tab.icon} text-[10px]`} />
                  {tab.label}
                  {tab.id === 'journal' && requestLogs.length > 0 && (
                    <span className={`text-[9px] font-bold px-1 rounded-full ${centerTab === 'journal' ? 'bg-white/30' : 'bg-indigo-100 text-indigo-600'}`}>
                      {requestLogs.length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Scrollable tab content — keep ALL tabs mounted to preserve local state */}
            <div className="flex-1 overflow-y-auto pb-4 min-h-0">
              <div className={`space-y-3 ${centerTab !== 'analysis' ? 'hidden' : ''}`}>
                <AnalysisCenter />
                <LogConsole />
              </div>
              <div className={centerTab !== 'sources' ? 'hidden' : ''}>
                <SourcesPanel />
              </div>
              <div className={centerTab !== 'journal' ? 'hidden' : ''}>
                <ModelJournal />
              </div>
            </div>
          </div>

          {/* Right column — tab bar fixed, content scrolls */}
          <div className="lg:col-span-3 flex flex-col min-h-0">
            {/* Right tabs — never scroll */}
            <div className="flex gap-1 p-1 bg-white/70 backdrop-blur rounded-xl border border-slate-200 shadow-sm flex-shrink-0 mb-3">
              {RIGHT_TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setRightTab(tab.id)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all ${
                    rightTab === tab.id
                      ? 'bg-slate-700 text-white shadow'
                      : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <i className={`fa-solid ${tab.icon} text-[10px]`} />
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Scrollable right content */}
            <div className="flex-1 overflow-y-auto pb-4 min-h-0">
              {rightTab === 'history' && <StatsHistory />}
              {rightTab === 'knowledge' && <KnowledgeBasePanel />}
            </div>
          </div>
        </div>
      </main>

      {/* Modals */}
      <ResultsModal />
      <SettingsModal />
      <RubricBuilderModal />
    </div>
  )
}
