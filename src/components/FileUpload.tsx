import React, { useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { extractText, formatFileSize, getFileExt } from '../services/fileParser'
import TutorialModal from './TutorialModal'
import type { TutorialStep } from './TutorialModal'

const FILE_TUTORIAL: TutorialStep[] = [
  {
    icon: 'fa-cloud-arrow-up', iconColor: 'text-blue-500', iconBg: 'bg-blue-100',
    title: 'Загрузка работ студентов',
    description: 'Перетащите файлы прямо в зону загрузки или нажмите на неё для выбора через диалог',
    tip: 'Файлы обрабатываются локально — данные не покидают компьютер',
  },
  {
    icon: 'fa-layer-group', iconColor: 'text-blue-500', iconBg: 'bg-blue-100',
    title: 'Пакетная проверка',
    description: 'Загрузите сразу несколько работ — система проверит каждую по очереди и сохранит все результаты в историю',
    tip: 'Удобно для проверки целой группы студентов за один раз',
  },
  {
    icon: 'fa-file-lines', iconColor: 'text-blue-500', iconBg: 'bg-blue-100',
    title: 'Поддерживаемые форматы',
    description: 'PDF, DOCX, TXT, Markdown и файлы исходного кода: Python, JavaScript, Java, C++ и другие',
  },
  {
    icon: 'fa-arrow-right-to-bracket', iconColor: 'text-blue-500', iconBg: 'bg-blue-100',
    title: 'Следующий шаг',
    description: 'После загрузки файлов выберите модель ИИ и рубрику оценки, затем нажмите «Начать проверку»',
  },
]

const FILE_ICONS: Record<string, string> = {
  pdf: 'fa-file-pdf text-red-500',
  docx: 'fa-file-word text-blue-600',
  text: 'fa-file-code text-emerald-600'
}

export default function FileUpload() {
  const { fileQueue, addFilesToQueue, removeFromQueue, clearQueue, addLog } = useStore()
  const [isDragging, setIsDragging] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const processFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files)
    if (arr.length === 0) return
    setIsLoading(true)
    const loaded: Array<{ name: string; content: string }> = []
    for (const file of arr) {
      addLog(`Загрузка: ${file.name} (${formatFileSize(file.size)})`, 'info')
      try {
        const content = await extractText(file)
        loaded.push({ name: file.name, content })
        addLog(`Загружен: ${file.name} — ${content.length} символов`, 'success')
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        addLog(`Ошибка загрузки ${file.name}: ${msg}`, 'error')
      }
    }
    addFilesToQueue(loaded)
    setIsLoading(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files.length) processFiles(e.dataTransfer.files)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) processFiles(e.target.files)
  }

  return (
    <div className="glass-card p-5">
      <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
        <i className="fa-solid fa-cloud-arrow-up text-blue-500 text-base" />
        Загрузка работ
        {fileQueue.length > 0 && (
          <span className="bg-blue-100 text-blue-700 text-[10px] font-bold px-2 py-0.5 rounded-full">
            {fileQueue.length}
          </span>
        )}
        <button
          onClick={() => setShowInfo(!showInfo)}
          title="Справка по загрузке"
          className={`ml-auto w-5 h-5 rounded-full flex items-center justify-center text-[10px] transition-all ${
            showInfo ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-400 hover:bg-blue-100 hover:text-blue-500'
          }`}
        >
          <i className="fa-solid fa-info" />
        </button>
      </h2>

      <TutorialModal open={showInfo} onClose={() => setShowInfo(false)} title="Загрузка работ" steps={FILE_TUTORIAL} color="blue" />

      {/* Drop zone */}
      <div
        className={`drop-zone ${isDragging ? 'dragover' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          accept=".pdf,.docx,.doc,.txt,.md,.py,.js,.ts,.jsx,.tsx,.html,.css,.json,.java,.cpp,.c,.h"
          onChange={handleChange}
        />
        {isLoading ? (
          <div className="flex flex-col items-center gap-2 py-2">
            <i className="fa-solid fa-circle-notch fa-spin text-blue-500 text-2xl" />
            <p className="text-xs text-slate-500">Извлечение текста...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="w-11 h-11 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center">
              <i className="fa-solid fa-file-arrow-up text-xl" />
            </div>
            <p className="text-sm font-medium text-slate-600">Перетащите файлы или нажмите</p>
            <p className="text-xs text-slate-400">PDF · DOCX · TXT · MD · Код · несколько файлов</p>
          </div>
        )}
      </div>

      {/* File queue */}
      {fileQueue.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {fileQueue.map((f, i) => {
            const ext = getFileExt(f.name)
            const iconClass = FILE_ICONS[ext] ?? 'fa-file text-slate-400'
            return (
              <div key={f.name} className="flex items-center gap-2 p-2 bg-blue-50 rounded-lg border border-blue-100">
                <i className={`fa-solid ${iconClass} text-sm shrink-0`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-800 truncate">{f.name}</p>
                  <p className="text-[10px] text-slate-400">{f.content.length.toLocaleString()} символов</p>
                </div>
                <button
                  onClick={() => removeFromQueue(i)}
                  className="text-slate-300 hover:text-red-500 transition-colors shrink-0 p-0.5"
                >
                  <i className="fa-solid fa-xmark text-xs" />
                </button>
              </div>
            )
          })}
          {fileQueue.length > 1 && (
            <button
              onClick={clearQueue}
              className="w-full text-[10px] text-slate-400 hover:text-red-500 transition-colors py-1"
            >
              Очистить всё
            </button>
          )}
        </div>
      )}
    </div>
  )
}
