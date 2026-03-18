import React, { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import { fetchModels } from '../services/llamaApi'
import { parseModels } from '../services/modelSelector'
import type { AiModel } from '../types'
import TutorialModal from './TutorialModal'
import type { TutorialStep } from './TutorialModal'

const ELECTRON_TUTORIAL: TutorialStep[] = [
  {
    icon: 'fa-brain', iconColor: 'text-indigo-500', iconBg: 'bg-indigo-100',
    title: 'Модели искусственного интеллекта',
    description: 'Языковые модели анализируют текст работы и оценивают каждый критерий рубрики с обоснованием',
  },
  {
    icon: 'fa-folder-open', iconColor: 'text-indigo-500', iconBg: 'bg-indigo-100',
    title: 'Папка aimodels',
    description: 'Поместите .gguf файлы моделей в папку aimodels/ рядом с приложением — они определятся автоматически',
    tip: 'Рекомендуемый минимум — 7B+ параметров для точных оценок',
  },
  {
    icon: 'fa-wand-magic-sparkles', iconColor: 'text-indigo-500', iconBg: 'bg-indigo-100',
    title: 'Автоматическое назначение',
    description: 'Система распределяет модели по критериям: более мощные — для сложных критериев, компактные — для простых',
    tip: 'Нажмите «Обновить» если добавили новые модели в папку',
  },
]

const SERVER_TUTORIAL: TutorialStep[] = [
  {
    icon: 'fa-brain', iconColor: 'text-indigo-500', iconBg: 'bg-indigo-100',
    title: 'Модель через llama-server',
    description: 'Подключите внешний llama-server для использования любых GGUF-совместимых моделей на вашем компьютере',
  },
  {
    icon: 'fa-terminal', iconColor: 'text-indigo-500', iconBg: 'bg-indigo-100',
    title: 'Запуск сервера',
    description: 'В терминале выполните команду: llama-server -m ваша_модель.gguf --port 8080',
    tip: 'Порт можно изменить в настройках приложения (шестерёнка вверху)',
  },
  {
    icon: 'fa-plug', iconColor: 'text-indigo-500', iconBg: 'bg-indigo-100',
    title: 'Подключение и выбор',
    description: 'Нажмите «Обновить» для подключения к серверу. В списке появятся доступные модели — выберите нужную',
  },
]

export default function ModelSelector() {
  const { config, models, selectedModelId, setSelectedModel, setModels, setConnected, addLog } = useStore()
  const isElectron = !!window.electronAPI
  const [aiModels, setAiModels] = useState<AiModel[]>([])
  const [loading, setLoading] = useState(false)
  const [showInfo, setShowInfo] = useState(false)

  // On mount in Electron mode — scan aimodels folder automatically
  useEffect(() => {
    if (isElectron) scanAiModels() // eslint-disable-line react-hooks/exhaustive-deps
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const scanAiModels = async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI!.listAiModels()
      if (result.success && result.models.length > 0) {
        const parsed = parseModels(result.models)
        setAiModels(parsed)
        // Also expose to store as Model[] for compatibility
        setModels(parsed.map((m) => ({ id: m.path, name: m.displayName })))
        setConnected(true)
        addLog(`Найдено моделей в aimodels: ${parsed.length}`, 'success')
      } else {
        setAiModels([])
        addLog(result.error ?? 'Папка aimodels пуста — добавьте .gguf файлы', 'warning')
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      addLog(`Ошибка сканирования aimodels: ${msg}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  const refreshServer = async () => {
    setLoading(true)
    addLog('Обновление списка моделей...', 'info')
    try {
      const list = await fetchModels(config.llamaUrl)
      setModels(list)
      setConnected(true)
      addLog(`Найдено моделей: ${list.length}`, 'success')
    } catch (e: unknown) {
      setConnected(false)
      const msg = e instanceof Error ? e.message : String(e)
      addLog(`Ошибка подключения: ${msg}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  // ── Electron mode: show .gguf files ────────────────────────────────────────
  if (isElectron) {
    return (
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <i className="fa-solid fa-brain text-indigo-500 text-base" />
            Модели ИИ
            {aiModels.length > 0 && (
              <span className="bg-indigo-100 text-indigo-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {aiModels.length}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowInfo(!showInfo)}
              title="Справка по моделям"
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] transition-all ${
                showInfo ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-400 hover:bg-indigo-100 hover:text-indigo-500'
              }`}
            >
              <i className="fa-solid fa-info" />
            </button>
            <button
              onClick={scanAiModels}
              disabled={loading}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 transition-colors disabled:opacity-50"
            >
              <i className={`fa-solid fa-rotate text-[10px] ${loading ? 'fa-spin' : ''}`} />
              Обновить
            </button>
          </div>
        </div>

        <TutorialModal open={showInfo} onClose={() => setShowInfo(false)} title="Модели ИИ" steps={ELECTRON_TUTORIAL} color="indigo" />

        <p className="text-[11px] text-slate-400 mb-2.5 leading-relaxed">
          Папка <code className="bg-slate-100 px-1 rounded text-slate-600">aimodels/</code> рядом с приложением.
          Модели назначаются критериям автоматически.
        </p>

        <div className="space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
          {loading ? (
            <div className="text-center py-5 text-slate-400 text-xs">
              <i className="fa-solid fa-circle-notch fa-spin mb-1.5 text-base block" />
              Сканирование...
            </div>
          ) : aiModels.length === 0 ? (
            <div className="text-center py-5 text-slate-400 text-xs">
              <i className="fa-solid fa-folder-open mb-1.5 text-base block opacity-50" />
              Нет моделей. Добавьте .gguf файлы в папку <strong>aimodels/</strong>
            </div>
          ) : (
            aiModels.map((model) => (
              <div
                key={model.path}
                className="flex items-center gap-2.5 p-2.5 rounded-lg border bg-indigo-50 border-indigo-200"
              >
                <div className="w-8 h-8 rounded-md bg-indigo-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                  {model.capability >= 7 ? 'XL' : model.capability >= 4 ? 'M' : 'S'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-700 truncate">{model.displayName}</p>
                  <p className="text-[10px] text-slate-400">{model.sizeLabel}</p>
                </div>
                <i className="fa-solid fa-circle-check text-indigo-500 text-sm shrink-0" />
              </div>
            ))
          )}
        </div>

        {aiModels.length > 0 && (
          <p className="mt-2.5 text-[10px] text-emerald-600 font-medium text-center">
            <i className="fa-solid fa-check mr-1" />
            Автоматическое назначение по критериям
          </p>
        )}
      </div>
    )
  }

  // ── llama-server mode: show API models ─────────────────────────────────────
  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <i className="fa-solid fa-brain text-indigo-500 text-base" />
          Модель ИИ
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowInfo(!showInfo)}
            title="Справка по моделям"
            className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] transition-all ${
              showInfo ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-400 hover:bg-indigo-100 hover:text-indigo-500'
            }`}
          >
            <i className="fa-solid fa-info" />
          </button>
          <button
            onClick={refreshServer}
            disabled={loading}
            className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 transition-colors disabled:opacity-50"
          >
            <i className={`fa-solid fa-rotate text-[10px] ${loading ? 'fa-spin' : ''}`} />
            Обновить
          </button>
        </div>
      </div>

      <TutorialModal open={showInfo} onClose={() => setShowInfo(false)} title="Модель ИИ" steps={SERVER_TUTORIAL} color="indigo" />

      <div className="space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
        {models.length === 0 ? (
          <div className="text-center py-5 text-slate-400 text-xs">
            <i className="fa-solid fa-circle-info mb-1.5 text-base block" />
            Нет моделей. Запустите llama-server и нажмите «Обновить»
          </div>
        ) : (
          models.map((model) => {
            const selected = selectedModelId === model.id
            return (
              <button
                key={model.id}
                onClick={() => {
                  setSelectedModel(model.id)
                  addLog(`Выбрана модель: ${model.id}`, 'info')
                }}
                className={`w-full flex items-center gap-2.5 p-2.5 rounded-lg border text-left transition-all ${
                  selected
                    ? 'bg-blue-50 border-blue-400 ring-1 ring-blue-400'
                    : 'bg-white border-slate-200 hover:border-blue-300 hover:bg-slate-50'
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold shrink-0 ${
                    selected ? 'bg-blue-600 text-white' : 'bg-indigo-100 text-indigo-600'
                  }`}
                >
                  AI
                </div>
                <span className="text-xs font-medium text-slate-700 truncate flex-1">{model.id}</span>
                {selected && (
                  <i className="fa-solid fa-circle-check text-blue-600 text-sm shrink-0" />
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
