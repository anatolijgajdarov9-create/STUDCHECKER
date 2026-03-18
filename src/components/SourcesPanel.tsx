import React, { useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { extractText, formatFileSize, getFileExt } from '../services/fileParser'

const FILE_ICONS: Record<string, string> = {
  pdf: 'fa-file-pdf text-red-500',
  docx: 'fa-file-word text-blue-600',
  text: 'fa-file-lines text-slate-500'
}

export default function SourcesPanel() {
  const { sources, addSource, removeSource, clearSources, addLog } = useStore()
  const [isDragging, setIsDragging] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const processFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files)
    if (!arr.length) return
    setIsLoading(true)
    for (const file of arr) {
      addLog(`Источник: загрузка ${file.name} (${formatFileSize(file.size)})`, 'info')
      try {
        const content = await extractText(file)
        addSource({ name: file.name, content })
        addLog(`Источник добавлен: ${file.name} — ${content.length} символов`, 'success')
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        addLog(`Ошибка источника ${file.name}: ${msg}`, 'error')
      }
    }
    setIsLoading(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files.length) processFiles(e.dataTransfer.files)
  }

  return (
    <div className="space-y-4">
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <i className="fa-solid fa-book-open text-violet-500 text-base" />
            Источники для контекста
            {sources.length > 0 && (
              <span className="bg-violet-100 text-violet-700 text-[10px] font-bold px-2 py-0.5 rounded-full">
                {sources.length}
              </span>
            )}
          </h2>
          {sources.length > 0 && (
            <button
              onClick={clearSources}
              className="text-[10px] text-slate-400 hover:text-red-500 transition-colors"
            >
              Очистить всё
            </button>
          )}
        </div>

        <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
          Загрузите методичку, задание, эталонную работу или любой справочный документ.
          Контент будет подшит в запрос к модели как дополнительный контекст.
        </p>

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
            accept=".pdf,.docx,.doc,.txt,.md"
            onChange={(e) => e.target.files?.length && processFiles(e.target.files)}
          />
          {isLoading ? (
            <div className="flex flex-col items-center gap-2 py-2">
              <i className="fa-solid fa-circle-notch fa-spin text-violet-500 text-2xl" />
              <p className="text-xs text-slate-500">Загрузка источника...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <div className="w-10 h-10 bg-violet-100 text-violet-600 rounded-full flex items-center justify-center">
                <i className="fa-solid fa-file-circle-plus text-lg" />
              </div>
              <p className="text-sm font-medium text-slate-600">Перетащите источники или нажмите</p>
              <p className="text-xs text-slate-400">PDF · DOCX · TXT · MD</p>
            </div>
          )}
        </div>

        {/* Sources list */}
        {sources.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {sources.map((src, i) => {
              const ext = getFileExt(src.name)
              const iconClass = FILE_ICONS[ext] ?? 'fa-file text-slate-400'
              const preview = src.content.substring(0, 120).replace(/\n/g, ' ')
              return (
                <div key={src.name + i} className="p-2.5 bg-violet-50 rounded-lg border border-violet-100">
                  <div className="flex items-center gap-2">
                    <i className={`fa-solid ${iconClass} text-sm shrink-0`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-800 truncate">{src.name}</p>
                      <p className="text-[10px] text-slate-400">{src.content.length.toLocaleString()} символов</p>
                    </div>
                    <button
                      onClick={() => removeSource(i)}
                      className="text-slate-300 hover:text-red-500 transition-colors shrink-0 p-0.5"
                    >
                      <i className="fa-solid fa-xmark text-xs" />
                    </button>
                  </div>
                  {preview && (
                    <p className="mt-1.5 text-[10px] text-slate-400 italic leading-relaxed line-clamp-2">
                      {preview}…
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {sources.length === 0 && (
          <p className="mt-3 text-center text-[11px] text-slate-300 italic">
            Источники не загружены — модель будет оценивать только текст работы
          </p>
        )}
      </div>
    </div>
  )
}
