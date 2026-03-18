import React, { useState } from 'react'
import { useStore } from '../store/useStore'

export default function StatsHistory() {
  const { history, setCurrentResult, setShowResultsModal, deleteFromHistory, clearHistory } = useStore()
  const [confirmClear, setConfirmClear] = useState(false)
  const [hoverDelete, setHoverDelete] = useState<string | null>(null)

  const avg = history.length
    ? Math.round(history.reduce((s, h) => s + h.finalScore, 0) / history.length)
    : null

  const best = history.length
    ? Math.max(...history.map((h) => h.finalScore))
    : null

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="glass-card p-5">
        <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <i className="fa-solid fa-chart-pie text-orange-500 text-base" />
          Статистика
        </h2>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div className="bg-slate-50 p-3 rounded-xl text-center border border-slate-100">
            <p className="text-2xl font-bold text-slate-800">{history.length}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Проверено</p>
          </div>
          <div className="bg-slate-50 p-3 rounded-xl text-center border border-slate-100">
            <p className="text-2xl font-bold text-slate-800">{avg ?? '—'}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Средний балл</p>
          </div>
        </div>
        {best !== null && (
          <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-2.5 text-center">
            <p className="text-sm font-bold text-emerald-700">{best}<span className="text-xs font-normal text-emerald-500">/100</span></p>
            <p className="text-[10px] text-emerald-600">Лучший результат</p>
          </div>
        )}
        {history.length > 0 && (
          <div className="mt-3">
            {!confirmClear ? (
              <button
                onClick={() => setConfirmClear(true)}
                className="w-full py-1.5 text-[11px] text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg border border-transparent hover:border-red-100 transition-all flex items-center justify-center gap-1.5"
              >
                <i className="fa-solid fa-trash-can text-[10px]" />
                Очистить всю статистику
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => { clearHistory(); setConfirmClear(false) }}
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
          </div>
        )}
      </div>

      {/* History */}
      <div className="glass-card p-5 flex-1">
        <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <i className="fa-solid fa-clock-rotate-left text-slate-500 text-base" />
          История
          {history.length > 0 && (
            <span className="bg-slate-100 text-slate-500 text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-auto">
              {history.length}
            </span>
          )}
        </h2>
        <div className="space-y-2 max-h-[380px] overflow-y-auto pr-0.5">
          {history.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-xs">
              <i className="fa-regular fa-folder-open text-2xl mb-2 opacity-50 block" />
              История пуста
            </div>
          ) : (
            history.map((item) => {
              const gradeColor =
                item.finalScore >= 80
                  ? 'text-emerald-600'
                  : item.finalScore >= 60
                  ? 'text-amber-600'
                  : 'text-red-600'
              const isHovering = hoverDelete === item.id
              return (
                <div
                  key={item.id}
                  className="relative group"
                  onMouseLeave={() => setHoverDelete(null)}
                >
                  <button
                    onClick={() => {
                      setCurrentResult(item)
                      setShowResultsModal(true)
                    }}
                    className="w-full p-3 bg-slate-50 hover:bg-blue-50 rounded-xl border border-slate-100 hover:border-blue-200 transition-all text-left"
                  >
                    <div className="flex justify-between items-start">
                      <div className="min-w-0 pr-6">
                        <p className="text-xs font-medium text-slate-800 truncate">{item.fileName}</p>
                        <p className="text-[10px] text-slate-500">
                          {new Date(item.timestamp).toLocaleDateString('ru-RU')} · {item.rubricName}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={`text-base font-bold ${gradeColor}`}>{item.finalScore}</span>
                        <p className="text-[10px] font-bold text-slate-500 bg-white border border-slate-200 px-1.5 rounded-full text-center">
                          {item.grade}
                        </p>
                      </div>
                    </div>
                  </button>
                  {/* Delete button */}
                  <button
                    title="Удалить запись"
                    onMouseEnter={() => setHoverDelete(item.id)}
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteFromHistory(item.id)
                    }}
                    className={`absolute top-2 right-8 p-1 rounded-md transition-all ${
                      isHovering
                        ? 'opacity-100 bg-red-100 text-red-500'
                        : 'opacity-0 group-hover:opacity-60 text-slate-400 hover:text-red-500'
                    }`}
                  >
                    <i className="fa-solid fa-xmark text-[10px]" />
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
