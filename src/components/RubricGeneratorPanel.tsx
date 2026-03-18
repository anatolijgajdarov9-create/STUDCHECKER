import React, { useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { extractText, formatFileSize } from '../services/fileParser'
import { generateRubricFromWork } from '../services/llamaApi'
import { parseModels } from '../services/modelSelector'
import type { Rubric } from '../types'

const WORK_TYPES = [
  'Курсовая работа', 'Реферат', 'Лабораторная работа', 'Практическая работа',
  'Контрольная работа', 'Дипломная работа', 'Эссе', 'Отчёт', 'Доклад', 'Другое'
]

export default function RubricGeneratorPanel() {
  const { config, selectedModelId, addLog, addRubric, setSelectedRubric } = useStore()
  const isElectron = !!window.electronAPI

  const [file, setFile] = useState<{ name: string; content: string } | null>(null)
  const [workType, setWorkType] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatingStatus, setGeneratingStatus] = useState('')
  const [generatedRubric, setGeneratedRubric] = useState<Rubric | null>(null)
  const [saved, setSaved] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const canGenerate = !!file && !isGenerating && (isElectron || !!selectedModelId)

  const processFile = async (f: File) => {
    setError('')
    addLog(`Генератор рубрик: загрузка ${f.name} (${formatFileSize(f.size)})`, 'info')
    try {
      const content = await extractText(f)
      setFile({ name: f.name, content })
      setGeneratedRubric(null)
      setSaved(false)
      addLog(`Файл загружен: ${f.name} — ${content.length} символов`, 'success')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      addLog(`Ошибка загрузки: ${msg}`, 'error')
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) processFile(f)
  }

  const generate = async () => {
    if (!file || !canGenerate) return
    setIsGenerating(true)
    setSaved(false)
    setGeneratedRubric(null)
    setError('')

    let apiUrl = config.llamaUrl
    let modelId = selectedModelId ?? ''
    let modelLoaded = false

    try {
      // ── Electron: load a model from aimodels ──────────────────────────────
      if (isElectron) {
        setGeneratingStatus('Поиск моделей...')
        const listResult = await window.electronAPI!.listAiModels()

        if (!listResult.success || listResult.models.length === 0) {
          const reason = listResult.error ?? 'Папка aimodels пуста'
          setError(`Нет доступных моделей: ${reason}`)
          addLog(`Генератор рубрик: ${reason}`, 'error')
          return
        }

        const aiModels = parseModels(listResult.models)
        const model = aiModels[0]
        addLog(`Генератор рубрик: загрузка модели «${model.displayName}»...`, 'info')
        setGeneratingStatus(`Загрузка модели «${model.displayName}»...`)

        const sw = await window.electronAPI!.switchLlamaModel(model.path, config.llamaPort)
        if (!sw.success) {
          setError(`Не удалось загрузить модель: ${sw.error}`)
          addLog(`Генератор рубрик: ошибка загрузки модели: ${sw.error}`, 'error')
          return
        }

        addLog('Генератор рубрик: модель загружена', 'success')
        modelLoaded = true
        apiUrl = `http://127.0.0.1:${config.llamaPort}`
        modelId = 'local'
      }

      const apiConfig = {
        url: apiUrl,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        modelId,
        onLog: addLog
      }

      setGeneratingStatus(`Анализ текста «${file.name}»...`)
      addLog(`Генерация рубрики для «${file.name}»${workType ? ` (${workType})` : ''}...`, 'info')

      const rubric = await generateRubricFromWork(apiConfig, file.content, workType || undefined)
      setGeneratedRubric(rubric)
      addLog(`Рубрика сгенерирована: «${rubric.name}» (${rubric.criteria.length} критериев)`, 'success')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      addLog(`Ошибка генерации рубрики: ${msg}`, 'error')
    } finally {
      // ── Electron: unload model ────────────────────────────────────────────
      if (isElectron && modelLoaded) {
        await window.electronAPI!.stopLlamaServer()
        addLog('Генератор рубрик: модель выгружена', 'info')
      }
      setIsGenerating(false)
      setGeneratingStatus('')
    }
  }

  const saveRubric = () => {
    if (!generatedRubric) return
    addRubric(generatedRubric)
    setSelectedRubric(generatedRubric.id)
    setSaved(true)
    addLog(`Рубрика «${generatedRubric.name}» сохранена и выбрана`, 'success')
  }

  const totalWeight = generatedRubric?.criteria.reduce((s, c) => s + c.weight, 0) ?? 0

  return (
    <div className="glass-card p-5">
      <h2 className="text-sm font-semibold text-slate-700 mb-1 flex items-center gap-2">
        <i className="fa-solid fa-wand-magic-sparkles text-violet-500 text-base" />
        Генератор рубрик
      </h2>
      <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
        Загрузите работу — ИИ проанализирует её и создаст подходящую рубрику с критериями.
      </p>

      {/* File drop zone */}
      <div
        className={`drop-zone mb-3 ${isDragging ? 'dragover' : ''} ${file ? 'border-violet-300 bg-violet-50' : ''}`}
        style={{ padding: '12px', minHeight: 'unset' }}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".pdf,.docx,.doc,.txt,.md"
          onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])}
        />
        {file ? (
          <div className="flex items-center gap-2">
            <i className="fa-solid fa-file-lines text-violet-500 text-lg shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-slate-700 truncate">{file.name}</p>
              <p className="text-[10px] text-slate-400">{file.content.length.toLocaleString()} символов</p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); setFile(null); setGeneratedRubric(null); setError('') }}
              className="text-slate-300 hover:text-red-400 transition-colors p-1"
            >
              <i className="fa-solid fa-xmark text-xs" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 justify-center py-1">
            <i className="fa-solid fa-upload text-slate-300 text-lg" />
            <p className="text-xs text-slate-400">Перетащите работу или нажмите</p>
          </div>
        )}
      </div>

      {/* Work type selector */}
      <div className="mb-3">
        <label className="text-[11px] font-medium text-slate-600 block mb-1">
          Тип работы <span className="text-slate-400">(необязательно)</span>
        </label>
        <select
          value={workType}
          onChange={(e) => setWorkType(e.target.value)}
          className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-violet-400 focus:border-violet-400"
        >
          <option value="">— Определить автоматически —</option>
          {WORK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* Error message */}
      {error && (
        <div className="mb-3 p-2.5 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
          <i className="fa-solid fa-circle-exclamation text-red-500 text-xs mt-0.5 shrink-0" />
          <p className="text-[11px] text-red-600 leading-relaxed">{error}</p>
        </div>
      )}

      {/* Generate button */}
      <button
        onClick={generate}
        disabled={!canGenerate}
        className={`w-full py-2.5 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
          canGenerate
            ? 'bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 text-white shadow-md shadow-violet-500/20'
            : 'bg-slate-100 text-slate-400 cursor-not-allowed'
        }`}
      >
        {isGenerating ? (
          <>
            <i className="fa-solid fa-circle-notch fa-spin text-sm" />
            {generatingStatus || 'Генерация...'}
          </>
        ) : (
          <>
            <i className="fa-solid fa-wand-magic-sparkles text-sm" />
            Сгенерировать рубрику
          </>
        )}
      </button>

      {!file && !isGenerating && (
        <p className="text-[10px] text-amber-600 mt-1.5 text-center">Загрузите файл работы</p>
      )}
      {file && !isElectron && !selectedModelId && !isGenerating && (
        <p className="text-[10px] text-amber-600 mt-1.5 text-center">Выберите модель ИИ</p>
      )}

      {/* Generated rubric preview */}
      {generatedRubric && (
        <div className="mt-4 border border-violet-200 bg-violet-50/60 rounded-xl p-3.5 animate-slide-in">
          <div className="flex items-start justify-between gap-2 mb-2.5">
            <div>
              <p className="text-xs font-bold text-slate-800">{generatedRubric.name}</p>
              <p className="text-[10px] text-slate-500">{generatedRubric.criteria.length} критериев · сумма весов {totalWeight}%</p>
            </div>
            {!saved ? (
              <button
                onClick={saveRubric}
                className="shrink-0 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-[11px] font-semibold rounded-lg transition-colors flex items-center gap-1.5"
              >
                <i className="fa-solid fa-floppy-disk text-[10px]" />
                Сохранить
              </button>
            ) : (
              <span className="shrink-0 px-3 py-1.5 bg-emerald-100 text-emerald-700 text-[11px] font-semibold rounded-lg flex items-center gap-1.5">
                <i className="fa-solid fa-check text-[10px]" />
                Сохранено
              </span>
            )}
          </div>

          <div className="space-y-1.5">
            {generatedRubric.criteria.map((c) => (
              <div key={c.id} className="flex items-start gap-2 p-2 bg-white rounded-lg border border-violet-100">
                <div className="w-8 h-8 rounded-md bg-violet-100 text-violet-700 flex items-center justify-center text-[10px] font-bold shrink-0">
                  {c.weight}%
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-slate-700">{c.name}</p>
                  <p className="text-[10px] text-slate-400 leading-relaxed">{c.description}</p>
                </div>
                <span className="text-[10px] font-medium text-slate-400 shrink-0">/{c.maxScore}б</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
