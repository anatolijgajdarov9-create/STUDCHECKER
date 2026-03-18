import React, { useEffect, useRef } from 'react'
import { useStore } from '../store/useStore'
import type { LogType } from '../types'

const LOG_COLORS: Record<LogType, string> = {
  info: 'text-blue-600',
  success: 'text-emerald-600',
  error: 'text-red-600',
  warning: 'text-amber-600'
}

const LOG_ICONS: Record<LogType, string> = {
  info: 'fa-circle-info',
  success: 'fa-circle-check',
  error: 'fa-circle-exclamation',
  warning: 'fa-triangle-exclamation'
}

export default function LogConsole() {
  const { logs, clearLogs } = useStore()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs.length])

  return (
    <div className="glass-card flex flex-col" style={{ height: '240px' }}>
      <div className="flex items-center justify-between px-4 pt-4 pb-2 border-b border-slate-100 shrink-0">
        <span className="text-xs font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
          <i className="fa-solid fa-terminal text-slate-400" /> Журнал выполнения
        </span>
        <button
          onClick={clearLogs}
          className="text-[10px] text-slate-400 hover:text-red-500 transition-colors font-medium"
        >
          Очистить
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-0.5">
        {logs.length === 0 ? (
          <div className="text-xs text-slate-400 italic pt-2">Система готова к работе...</div>
        ) : (
          logs.map((entry) => (
            <div key={entry.id} className={`log-entry flex items-start gap-1.5 ${LOG_COLORS[entry.type]}`}>
              <span className="text-slate-400 text-[10px] shrink-0 mt-0.5 w-14">[{entry.time}]</span>
              <i className={`fa-solid ${LOG_ICONS[entry.type]} text-[10px] mt-1 shrink-0`} />
              <span className="font-medium break-words text-[11px]">{entry.message}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
