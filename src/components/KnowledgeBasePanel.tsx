import React, { useState, useEffect } from 'react'
import {
  getKnowledgeBase,
  getKnowledgeBaseStats,
  deleteEntry,
  clearKnowledgeBase
} from '../services/ragService'
import type { RagEntry } from '../types'

export default function KnowledgeBasePanel() {
  const [entries, setEntries] = useState<RagEntry[]>([])
  const [confirmClear, setConfirmClear] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const reload = () => setEntries(getKnowledgeBase())

  useEffect(() => { reload() }, [])

  const stats = getKnowledgeBaseStats()

  const handleDelete = (id: string) => {
    deleteEntry(id)
    reload()
  }

  const handleClear = () => {
    clearKnowledgeBase()
    reload()
    setConfirmClear(false)
  }

  const gradeColor = (score: number) =>
    score >= 80 ? 'text-emerald-600' : score >= 60 ? 'text-amber-600' : 'text-red-600'

  const gradeBarColor = (score: number) =>
    score >= 80 ? 'bg-emerald-500' : score >= 60 ? 'bg-amber-500' : 'bg-red-500'

  return (
    <div className="space-y-4">
      {/* Stats card */}
      <div className="glass-card p-5">
        <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <i className="fa-solid fa-database text-blue-500 text-base" />
          База знаний RAG
          {entries.length > 0 && (
            <span className="bg-blue-100 text-blue-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-auto">
              {entries.length}
            </span>
          )}
        </h2>

        {entries.length === 0 ? (
          <div className="text-center py-6 text-slate-400 text-xs">
            <i className="fa-solid fa-database text-3xl mb-2 opacity-20 block" />
            <p>База знаний пуста.</p>
            <p className="mt-0.5 opacity-70">Проверьте хотя бы одну работу — она автоматически попадёт сюда.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="bg-slate-50 p-3 rounded-xl text-center border border-slate-100">
                <p className="text-xl font-bold text-slate-800">{stats.total}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">Работ в базе</p>
              </div>
              <div className="bg-slate-50 p-3 rounded-xl text-center border border-slate-100">
                <p className="text-xl font-bold text-slate-800">{stats.avgScore}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">Средний балл</p>
              </div>
            </div>

            {/* Work types */}
            {Object.keys(stats.workTypes).length > 0 && (
              <div className="mb-3">
                <p className="text-[10px] text-slate-500 font-medium mb-1.5">Типы работ:</p>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(stats.workTypes).map(([type, count]) => (
                    <span key={type} className="text-[10px] bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-full">
                      {type} ({count})
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Grade distribution */}
            <div className="mb-3">
              <p className="text-[10px] text-slate-500 font-medium mb-1.5">Оценки:</p>
              <div className="flex gap-1.5">
                {['A', 'B', 'C', 'D', 'E', 'F'].map((g) => {
                  const count = stats.byGrade[g] || 0
                  if (count === 0) return null
                  const colors: Record<string, string> = {
                    A: 'bg-emerald-100 text-emerald-700 border-emerald-200',
                    B: 'bg-green-100 text-green-700 border-green-200',
                    C: 'bg-amber-100 text-amber-700 border-amber-200',
                    D: 'bg-orange-100 text-orange-700 border-orange-200',
                    E: 'bg-red-100 text-red-600 border-red-200',
                    F: 'bg-red-200 text-red-700 border-red-300'
                  }
                  return (
                    <div key={g} className={`flex-1 text-center py-1 rounded-lg border text-[10px] font-bold ${colors[g]}`}>
                      {g}<br /><span className="font-normal opacity-70">{count}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Clear button */}
            {!confirmClear ? (
              <button
                onClick={() => setConfirmClear(true)}
                className="w-full py-1.5 text-[11px] text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg border border-transparent hover:border-red-100 transition-all flex items-center justify-center gap-1.5"
              >
                <i className="fa-solid fa-trash-can text-[10px]" />
                Очистить базу знаний
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={handleClear}
                  className="flex-1 py-1.5 text-[11px] font-semibold text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
                >
                  Удалить всё
                </button>
                <button
                  onClick={() => setConfirmClear(false)}
                  className="flex-1 py-1.5 text-[11px] text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                >
                  Отмена
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Entries list */}
      {entries.length > 0 && (
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <i className="fa-solid fa-list text-slate-500 text-sm" />
            Записи
          </h3>
          <div className="space-y-2 max-h-[480px] overflow-y-auto pr-0.5">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="border border-slate-100 rounded-xl overflow-hidden"
              >
                <div className="flex items-center gap-2.5 p-2.5 bg-slate-50 hover:bg-slate-100 transition-colors">
                  <button
                    onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-semibold text-slate-800 truncate">{entry.fileName}</p>
                        <p className="text-[10px] text-slate-400">
                          {entry.workType} · {new Date(entry.timestamp).toLocaleDateString('ru-RU')}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={`text-sm font-bold ${gradeColor(entry.finalScore)}`}>{entry.finalScore}</span>
                        <span className="text-[10px] font-bold text-slate-400 ml-1">{entry.grade}</span>
                      </div>
                    </div>
                    {/* Mini progress bar */}
                    <div className="mt-1.5 w-full bg-slate-200 rounded-full h-1">
                      <div
                        className={`h-1 rounded-full transition-all ${gradeBarColor(entry.finalScore)}`}
                        style={{ width: `${entry.finalScore}%` }}
                      />
                    </div>
                  </button>
                  <button
                    onClick={() => handleDelete(entry.id)}
                    className="shrink-0 p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-all"
                    title="Удалить из базы"
                  >
                    <i className="fa-solid fa-xmark text-[10px]" />
                  </button>
                </div>

                {/* Expanded details */}
                {expanded === entry.id && (
                  <div className="p-2.5 border-t border-slate-100 bg-white">
                    <p className="text-[10px] font-medium text-slate-500 mb-1.5">Рубрика: {entry.rubricName}</p>
                    <div className="space-y-1">
                      {entry.criteriaResults.map((c, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <div className="w-full">
                            <div className="flex justify-between text-[10px] text-slate-500 mb-0.5">
                              <span className="truncate flex-1 mr-2">{c.name}</span>
                              <span className="shrink-0 font-medium">{c.score}/{c.maxScore}</span>
                            </div>
                            <div className="w-full bg-slate-100 rounded-full h-1">
                              <div
                                className={`h-1 rounded-full ${gradeBarColor((c.score / c.maxScore) * 100)}`}
                                style={{ width: `${(c.score / c.maxScore) * 100}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    {entry.contentSummary && (
                      <p className="mt-2 text-[10px] text-slate-400 italic leading-relaxed line-clamp-3">
                        {entry.contentSummary}...
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
