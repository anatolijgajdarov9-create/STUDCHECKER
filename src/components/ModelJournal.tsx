import React, { useState, useEffect, useRef } from 'react'
import { useStore } from '../store/useStore'
import type { ModelRequestLog, UrlCheck } from '../types'

type JournalTab = 'requests' | 'plagiarism'

export default function ModelJournal() {
  const { requestLogs, clearRequestLogs, plagiarismReport } = useStore()
  const [activeTab, setActiveTab] = useState<JournalTab>('requests')
  const [selected, setSelected] = useState<ModelRequestLog | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-select latest log and scroll
  useEffect(() => {
    if (requestLogs.length > 0) {
      setSelected(requestLogs[requestLogs.length - 1])
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [requestLogs.length])

  // Switch to plagiarism tab when report arrives
  useEffect(() => {
    if (plagiarismReport) setActiveTab('plagiarism')
  }, [plagiarismReport])

  const statusColor = (s: ModelRequestLog['status']) =>
    s === 'ok' ? 'text-emerald-600' : s === 'timeout' ? 'text-amber-600' : 'text-red-600'

  const statusIcon = (s: ModelRequestLog['status']) =>
    s === 'ok' ? 'fa-circle-check' : s === 'timeout' ? 'fa-clock' : 'fa-circle-exclamation'

  const formatMs = (ms: number) =>
    ms >= 60000 ? `${(ms / 60000).toFixed(1)} мин` : ms >= 1000 ? `${(ms / 1000).toFixed(1)} с` : `${ms} мс`

  return (
    <div className="space-y-3">
      {/* Header + sub-tabs */}
      <div className="glass-card px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-slate-600 uppercase tracking-wide flex items-center gap-1.5">
            <i className="fa-solid fa-code text-indigo-400" />
            Журнал
          </span>
          {/* Sub-tab switcher */}
          <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
            <button
              onClick={() => setActiveTab('requests')}
              className={`text-[10px] font-semibold px-2.5 py-1 rounded-md transition-all ${
                activeTab === 'requests'
                  ? 'bg-white text-indigo-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <i className="fa-solid fa-code mr-1" />
              Запросы
              {requestLogs.length > 0 && (
                <span className="ml-1 bg-indigo-100 text-indigo-600 text-[9px] font-bold px-1 rounded-full">
                  {requestLogs.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('plagiarism')}
              className={`text-[10px] font-semibold px-2.5 py-1 rounded-md transition-all ${
                activeTab === 'plagiarism'
                  ? 'bg-white text-violet-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <i className="fa-solid fa-shield-halved mr-1" />
              Антиплагиат
              {plagiarismReport && (
                <span className="ml-1 bg-violet-100 text-violet-600 text-[9px] font-bold px-1 rounded-full">
                  {plagiarismReport.checkedUrls.filter(u => !u.url.startsWith('kb://')).length}
                  {plagiarismReport.checkedUrls.some(u => u.url.startsWith('kb://')) && '+КБ'}
                </span>
              )}
            </button>
          </div>
        </div>
        {activeTab === 'requests' && requestLogs.length > 0 && (
          <button
            onClick={() => { clearRequestLogs(); setSelected(null) }}
            className="text-[10px] text-slate-400 hover:text-red-500 transition-colors"
          >
            Очистить
          </button>
        )}
      </div>

      {/* ── Requests tab ── */}
      {activeTab === 'requests' && (
        requestLogs.length === 0 ? (
          <div className="glass-card p-8 text-center">
            <i className="fa-solid fa-inbox text-3xl text-slate-200 mb-3 block" />
            <p className="text-xs text-slate-400">Журнал пуст — запросы появятся во время проверки</p>
          </div>
        ) : (
          <div className="grid grid-cols-12 gap-3">
            {/* Left: log list */}
            <div className="col-span-4 glass-card overflow-hidden flex flex-col" style={{ maxHeight: '520px' }}>
              <div className="px-3 py-2 border-b border-slate-100 text-[10px] font-semibold text-slate-400 uppercase tracking-wide shrink-0">
                Запросы
              </div>
              <div className="flex-1 overflow-y-auto">
                {requestLogs.map((log) => (
                  <button
                    key={log.id}
                    onClick={() => setSelected(log)}
                    className={`w-full text-left px-3 py-2.5 border-b border-slate-50 transition-colors hover:bg-slate-50 ${
                      selected?.id === log.id ? 'bg-indigo-50 border-l-2 border-l-indigo-400' : ''
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <i className={`fa-solid ${statusIcon(log.status)} ${statusColor(log.status)} text-[10px]`} />
                      <span className="text-[10px] font-semibold text-slate-700 truncate flex-1">
                        {log.criterion}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-slate-400">{log.time}</span>
                      {log.durationMs > 0 && (
                        <span className="text-[9px] text-slate-400">{formatMs(log.durationMs)}</span>
                      )}
                    </div>
                  </button>
                ))}
                <div ref={bottomRef} />
              </div>
            </div>

            {/* Right: detail view */}
            <div className="col-span-8 space-y-3">
              {selected ? (
                <>
                  <div className="glass-card px-4 py-3 flex items-center gap-4">
                    <i className={`fa-solid ${statusIcon(selected.status)} ${statusColor(selected.status)} text-lg`} />
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{selected.criterion}</p>
                      <p className="text-[10px] text-slate-400">
                        {selected.time}
                        {selected.durationMs > 0 && ` · ${formatMs(selected.durationMs)}`}
                      </p>
                    </div>
                  </div>

                  <div className="glass-card overflow-hidden">
                    <div className="px-4 py-2 border-b border-slate-100 flex items-center gap-2">
                      <i className="fa-solid fa-arrow-up-from-bracket text-blue-400 text-xs" />
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Промт</span>
                      <span className="ml-auto text-[9px] text-slate-300">{selected.prompt.length} символов</span>
                    </div>
                    <pre className="px-4 py-3 text-[10px] text-slate-600 whitespace-pre-wrap leading-relaxed overflow-y-auto font-mono"
                      style={{ maxHeight: '180px' }}>
                      {selected.prompt}
                    </pre>
                  </div>

                  <div className="glass-card overflow-hidden">
                    <div className="px-4 py-2 border-b border-slate-100 flex items-center gap-2">
                      <i className="fa-solid fa-arrow-down-to-bracket text-emerald-400 text-xs" />
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Ответ модели</span>
                      <span className="ml-auto text-[9px] text-slate-300">{selected.response.length} символов</span>
                    </div>
                    <pre className="px-4 py-3 text-[10px] text-slate-600 whitespace-pre-wrap leading-relaxed overflow-y-auto font-mono"
                      style={{ maxHeight: '180px' }}>
                      {selected.response}
                    </pre>
                  </div>
                </>
              ) : (
                <div className="glass-card p-8 text-center">
                  <p className="text-xs text-slate-400">Выберите запрос слева для просмотра деталей</p>
                </div>
              )}
            </div>
          </div>
        )
      )}

      {/* ── Plagiarism tab ── */}
      {activeTab === 'plagiarism' && (
        !plagiarismReport ? (
          <div className="glass-card p-8 text-center">
            <i className="fa-solid fa-shield-halved text-3xl text-slate-200 mb-3 block" />
            <p className="text-xs text-slate-400">Результаты антиплагиата появятся после проверки критерия «Оригинальность»</p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Summary card */}
            <div className="glass-card px-5 py-4 flex items-center gap-5">
              <div className="text-center">
                <p className={`text-4xl font-extrabold ${
                  plagiarismReport.originalityScore >= 80 ? 'text-emerald-600'
                  : plagiarismReport.originalityScore >= 60 ? 'text-amber-600'
                  : 'text-red-600'
                }`}>
                  {plagiarismReport.originalityScore}%
                </p>
                <p className="text-[10px] text-slate-500 font-medium mt-0.5">оригинальность</p>
              </div>
              <div className="h-10 w-px bg-slate-200" />
              <div className="flex-1 text-xs text-slate-500 space-y-0.5">
                <p>
                  <span className="font-medium text-slate-700">Интернет:</span>{' '}
                  {plagiarismReport.checkedUrls.filter(u => !u.url.startsWith('kb://')).length} источников
                </p>
                <p>
                  <span className="font-medium text-slate-700">База знаний:</span>{' '}
                  {plagiarismReport.checkedUrls.filter(u => u.url.startsWith('kb://')).length} работ
                </p>
                <p><span className="font-medium text-slate-700">Макс. совпадение:</span> {Math.max(0, ...plagiarismReport.checkedUrls.map(u => u.matchPercent))}%</p>
              </div>
            </div>

            {/* URL list */}
            <div className="glass-card overflow-hidden">
              <div className="px-4 py-2 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                Проверенные источники
              </div>
              <div className="overflow-y-auto" style={{ maxHeight: '420px' }}>
                {plagiarismReport.checkedUrls.map((check, i) => (
                  <UrlCheckRow key={i} check={check} />
                ))}
              </div>
            </div>
          </div>
        )
      )}
    </div>
  )
}

function UrlCheckRow({ check }: { check: UrlCheck }) {
  const [expanded, setExpanded] = useState(false)

  const matchColor =
    check.matchPercent >= 30 ? 'text-red-600 bg-red-50'
    : check.matchPercent > 0 ? 'text-amber-600 bg-amber-50'
    : 'text-emerald-600 bg-emerald-50'

  const statusIcon =
    check.status === 'checked' ? 'fa-circle-check text-emerald-400'
    : check.status === 'fetching' ? 'fa-circle-notch fa-spin text-blue-400'
    : check.status === 'error' ? 'fa-circle-exclamation text-slate-300'
    : 'fa-clock text-slate-300'

  return (
    <div className="border-b border-slate-50 last:border-0">
      <button
        onClick={() => check.borrowings.length > 0 && setExpanded((v) => !v)}
        className={`w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50 transition-colors ${
          check.borrowings.length > 0 ? 'cursor-pointer' : 'cursor-default'
        }`}
      >
        <i className={`fa-solid ${statusIcon} text-[10px] shrink-0`} />

        <div className="flex-1 min-w-0">
          {check.url.startsWith('kb://') ? (
            <>
              <p className="text-[10px] font-medium text-indigo-700 truncate flex items-center gap-1">
                <i className="fa-solid fa-database text-[8px]" />
                {check.title.replace('[База знаний] ', '')}
              </p>
              <p className="text-[9px] text-slate-400">из базы знаний</p>
            </>
          ) : (
            <>
              <p className="text-[10px] font-medium text-slate-700 truncate">{check.url}</p>
              {check.title && (
                <p className="text-[9px] text-slate-400 truncate">{check.title}</p>
              )}
            </>
          )}
          {check.errorMsg && (
            <p className="text-[9px] text-red-400 truncate">{check.errorMsg}</p>
          )}
        </div>

        {check.status === 'checked' && (
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${matchColor}`}>
            {check.matchPercent}%
          </span>
        )}

        {check.borrowings.length > 0 && (
          <i className={`fa-solid fa-chevron-${expanded ? 'up' : 'down'} text-[9px] text-slate-400 shrink-0`} />
        )}
      </button>

      {/* Borrowing details */}
      {expanded && check.borrowings.length > 0 && (
        <div className="px-4 pb-3 space-y-1 bg-red-50/50">
          <p className="text-[9px] font-bold text-red-600 uppercase tracking-wide mb-1.5">Найденные заимствования:</p>
          {check.borrowings.map((b, i) => (
            <p key={i} className="text-[10px] text-slate-600 italic bg-white rounded px-2 py-1 border border-red-100">
              «{b}»
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
