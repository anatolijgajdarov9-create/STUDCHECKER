import React from 'react'

export interface InfoStep {
  icon: string
  text: string
}

interface InfoPanelProps {
  open: boolean
  onClose: () => void
  title: string
  steps: InfoStep[]
  color?: 'blue' | 'emerald' | 'indigo' | 'violet'
}

const COLOR = {
  blue:    { bg: 'bg-blue-50',    border: 'border-blue-200',   dot: 'bg-blue-500',    icon: 'text-blue-500',    title: 'text-blue-700',   close: 'hover:text-blue-600' },
  emerald: { bg: 'bg-emerald-50', border: 'border-emerald-200',dot: 'bg-emerald-500', icon: 'text-emerald-500', title: 'text-emerald-700',close: 'hover:text-emerald-600' },
  indigo:  { bg: 'bg-indigo-50',  border: 'border-indigo-200', dot: 'bg-indigo-500',  icon: 'text-indigo-500',  title: 'text-indigo-700', close: 'hover:text-indigo-600' },
  violet:  { bg: 'bg-violet-50',  border: 'border-violet-200', dot: 'bg-violet-500',  icon: 'text-violet-500',  title: 'text-violet-700', close: 'hover:text-violet-600' },
}

export default function InfoPanel({ open, onClose, title, steps, color = 'blue' }: InfoPanelProps) {
  if (!open) return null
  const c = COLOR[color]

  return (
    <div className={`mt-3 rounded-xl border ${c.border} ${c.bg} p-3.5 animate-slide-in`}>
      <div className="flex items-center justify-between mb-2.5">
        <p className={`text-[11px] font-bold uppercase tracking-wider ${c.title}`}>{title}</p>
        <button
          onClick={onClose}
          className={`text-slate-300 ${c.close} transition-colors p-0.5`}
        >
          <i className="fa-solid fa-xmark text-xs" />
        </button>
      </div>
      <div className="space-y-2">
        {steps.map((step, i) => (
          <div key={i} className="flex items-start gap-2.5">
            <div className={`w-5 h-5 rounded-full ${c.dot} flex items-center justify-center shrink-0 mt-0.5`}>
              <i className={`fa-solid ${step.icon} text-white text-[8px]`} />
            </div>
            <p className="text-[11px] text-slate-600 leading-relaxed">{step.text}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
