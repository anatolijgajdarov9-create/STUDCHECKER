import React, { useState } from 'react'
import { useStore } from '../store/useStore'
import { fetchModels } from '../services/llamaApi'

export default function SettingsModal() {
  const { config, setConfig, setConnected, setModels, addLog, showSettingsModal, setShowSettingsModal } = useStore()
  const [url, setUrl] = useState(config.llamaUrl)
  const [temp, setTemp] = useState(config.temperature)
  const [tokens, setTokens] = useState(config.maxTokens)
  const [modelPath, setModelPath] = useState(config.modelPath)
  const [port, setPort] = useState(config.llamaPort)
  const [serverStatus, setServerStatus] = useState<'idle' | 'starting' | 'running' | 'error'>('idle')
  const [serverError, setServerError] = useState('')

  if (!showSettingsModal) return null

  const save = async () => {
    const newUrl = `http://localhost:${port}`
    setConfig({ llamaUrl: newUrl, temperature: temp, maxTokens: tokens, modelPath, llamaPort: port })
    setUrl(newUrl)
    setShowSettingsModal(false)
    addLog('Настройки сохранены', 'success')
    try {
      const models = await fetchModels(newUrl)
      setModels(models)
      setConnected(true)
      addLog(`Переподключено. Моделей: ${models.length}`, 'success')
    } catch {
      setConnected(false)
      setModels([])
    }
  }

  const browseModel = async () => {
    if (!window.electronAPI) return
    const path = await window.electronAPI.openModelFileDialog()
    if (path) setModelPath(path)
  }

  const startServer = async () => {
    if (!window.electronAPI) return
    if (!modelPath) {
      setServerError('Выберите файл модели (.gguf)')
      return
    }
    setServerStatus('starting')
    setServerError('')
    const result = await window.electronAPI.startLlamaServer(modelPath, port)
    if (result.success) {
      setServerStatus('running')
      addLog(`llama-server запущен на порту ${port}`, 'success')
      const newUrl = `http://localhost:${port}`
      setConfig({ llamaUrl: newUrl, modelPath, llamaPort: port })
      // Check connection
      setTimeout(async () => {
        try {
          const models = await fetchModels(newUrl)
          setModels(models)
          setConnected(true)
          addLog(`Подключено. Моделей: ${models.length}`, 'success')
        } catch {
          setConnected(false)
        }
      }, 2000)
    } else {
      setServerStatus('error')
      setServerError(result.error ?? 'Не удалось запустить сервер')
      addLog(`Ошибка запуска llama-server: ${result.error}`, 'error')
    }
  }

  const stopServer = async () => {
    if (!window.electronAPI) return
    await window.electronAPI.stopLlamaServer()
    setServerStatus('idle')
    setConnected(false)
    setModels([])
    addLog('llama-server остановлен', 'warning')
  }

  const isElectron = !!window.electronAPI

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        onClick={() => setShowSettingsModal(false)}
      />
      <div className="relative bg-white rounded-2xl w-full max-w-md shadow-2xl animate-slide-in">
        <div className="p-5 border-b border-slate-100 flex justify-between items-center">
          <h2 className="text-lg font-bold text-slate-800">Настройки</h2>
          <button
            onClick={() => setShowSettingsModal(false)}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <i className="fa-solid fa-xmark text-lg" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Model path (Electron only) */}
          {isElectron && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Модель (.gguf)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={modelPath}
                  onChange={(e) => setModelPath(e.target.value)}
                  placeholder="Выберите файл модели..."
                  className="flex-1 p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-400 focus:border-blue-400 outline-none font-mono truncate"
                />
                <button
                  onClick={browseModel}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm rounded-lg transition-colors whitespace-nowrap"
                >
                  <i className="fa-solid fa-folder-open mr-1.5" />
                  Обзор
                </button>
              </div>
            </div>
          )}

          {/* Port */}
          {isElectron && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Порт сервера</label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(parseInt(e.target.value) || 8080)}
                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-400 outline-none font-mono"
              />
            </div>
          )}

          {/* Server controls (Electron only) */}
          {isElectron && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Сервер</label>
              <div className="flex gap-2 items-center">
                <button
                  onClick={startServer}
                  disabled={serverStatus === 'starting' || serverStatus === 'running'}
                  className="flex-1 flex items-center justify-center gap-2 py-2 px-3 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors"
                >
                  {serverStatus === 'starting' ? (
                    <><i className="fa-solid fa-spinner fa-spin" /> Запуск...</>
                  ) : (
                    <><i className="fa-solid fa-play" /> Запустить</>
                  )}
                </button>
                <button
                  onClick={stopServer}
                  disabled={serverStatus !== 'running'}
                  className="flex-1 flex items-center justify-center gap-2 py-2 px-3 bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors"
                >
                  <i className="fa-solid fa-stop" /> Остановить
                </button>
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                  serverStatus === 'running' ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]' :
                  serverStatus === 'starting' ? 'bg-yellow-400 animate-pulse' :
                  serverStatus === 'error' ? 'bg-red-500' : 'bg-slate-300'
                }`} />
              </div>
              {serverError && (
                <p className="text-xs text-red-500 mt-1.5">{serverError}</p>
              )}
            </div>
          )}

          {/* URL (manual, shown when not Electron or as fallback) */}
          {!isElectron && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                llama-server URL
              </label>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://localhost:8080"
                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-400 focus:border-blue-400 outline-none font-mono"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                Запустите: <code className="bg-slate-100 px-1 rounded">llama-server.exe -m model.gguf --port 8080</code>
              </p>
            </div>
          )}

          {/* Temperature */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Температура — <span className="text-blue-600 font-bold">{temp}</span>
            </label>
            <input
              type="range"
              min={0} max={1} step={0.05}
              value={temp}
              onChange={(e) => setTemp(parseFloat(e.target.value))}
              className="w-full accent-blue-600"
            />
            <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
              <span>Точнее (0)</span>
              <span>Креативнее (1)</span>
            </div>
          </div>

          {/* Max tokens */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Max Tokens</label>
            <select
              value={tokens}
              onChange={(e) => setTokens(parseInt(e.target.value))}
              className="w-full p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-400 outline-none bg-white"
            >
              <option value={1024}>1024 (быстро)</option>
              <option value={2048}>2048 (стандарт)</option>
              <option value={4096}>4096 (подробно)</option>
              <option value={8192}>8192 (максимум)</option>
            </select>
          </div>
        </div>

        <div className="p-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={() => setShowSettingsModal(false)} className="btn-secondary text-sm">
            Отмена
          </button>
          <button onClick={save} className="btn-primary text-sm">
            Сохранить
          </button>
        </div>
      </div>
    </div>
  )
}
