import React from 'react'
import { useStore } from '../store/useStore'
import { fetchModels } from '../services/llamaApi'
import logoUrl from '../../logo_studchecker.png'

export default function Header() {
  const { config, isConnected, setConnected, setModels, addLog, setShowSettingsModal } = useStore()

  const checkConnection = async () => {
    addLog('Проверка подключения к llama-server...', 'info')
    try {
      const models = await fetchModels(config.llamaUrl)
      setModels(models)
      setConnected(true)
      addLog(`Подключено к llama-server. Доступно моделей: ${models.length}`, 'success')
    } catch (e: unknown) {
      setConnected(false)
      setModels([])
      const msg = e instanceof Error ? e.message : String(e)
      addLog(`Ошибка подключения: ${msg}`, 'error')
    }
  }

  return (
    <header className="glass-panel sticky top-0 z-40">
      <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <img src={logoUrl} alt="Logo" className="w-9 h-9 rounded-xl object-contain" />
          <div>
            <h1 className="text-base font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-700 to-indigo-600 leading-tight">
              Автоматизированная Система проверки студенческих работ
            </h1>
          </div>
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-3">
          {/* Connection status */}
          <button
            onClick={checkConnection}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
              isConnected
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isConnected ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]' : 'bg-slate-400'
              }`}
            />
            <span>{isConnected ? 'llama-server подключен' : 'Не подключено'}</span>
            <i className="fa-solid fa-rotate text-[10px] opacity-60" />
          </button>

          {/* Settings */}
          <button
            onClick={() => setShowSettingsModal(true)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-blue-600 transition-colors"
          >
            <i className="fa-solid fa-gear" />
          </button>
        </div>
      </div>
    </header>
  )
}
