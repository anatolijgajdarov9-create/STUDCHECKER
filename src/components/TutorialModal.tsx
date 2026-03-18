import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'

export interface TutorialStep {
  icon: string
  iconColor: string
  iconBg: string
  title: string
  description: string
  tip?: string
}

interface TutorialModalProps {
  open: boolean
  onClose: () => void
  title: string
  steps: TutorialStep[]
  color?: 'blue' | 'emerald' | 'indigo' | 'violet'
}

const ACCENT = {
  blue:    { header: 'bg-blue-600',    btn: 'bg-blue-600 hover:bg-blue-700',     dot: 'bg-blue-200',    activeDot: 'bg-blue-600' },
  emerald: { header: 'bg-emerald-600', btn: 'bg-emerald-600 hover:bg-emerald-700', dot: 'bg-emerald-200', activeDot: 'bg-emerald-600' },
  indigo:  { header: 'bg-indigo-600',  btn: 'bg-indigo-600 hover:bg-indigo-700',  dot: 'bg-indigo-200',  activeDot: 'bg-indigo-600' },
  violet:  { header: 'bg-violet-600',  btn: 'bg-violet-600 hover:bg-violet-700',  dot: 'bg-violet-200',  activeDot: 'bg-violet-600' },
}

export default function TutorialModal({ open, onClose, title, steps, color = 'blue' }: TutorialModalProps) {
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState<'right' | 'left'>('right')
  const [animKey, setAnimKey] = useState(0)
  const c = ACCENT[color]

  useEffect(() => {
    if (open) { setStep(0); setDir('right'); setAnimKey(k => k + 1) }
  }, [open])

  if (!open) return null

  const go = (next: number, direction: 'right' | 'left') => {
    setDir(direction)
    setAnimKey(k => k + 1)
    setStep(next)
  }

  const cur = steps[step]

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden animate-slide-in">

        {/* Header */}
        <div className={`${c.header} px-5 py-3.5 flex items-center justify-between`}>
          <span className="text-sm font-bold text-white flex items-center gap-2">
            <i className="fa-solid fa-graduation-cap" />
            {title}
          </span>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded-full bg-white/20 hover:bg-white/35 transition-colors flex items-center justify-center text-white"
          >
            <i className="fa-solid fa-xmark text-xs" />
          </button>
        </div>

        {/* Progress dots */}
        <div className="flex justify-center gap-2 pt-4 pb-1">
          {steps.map((_, i) => (
            <button
              key={i}
              onClick={() => go(i, i > step ? 'right' : 'left')}
              className={`rounded-full transition-all duration-300 ${
                i === step
                  ? `${c.activeDot} w-6 h-2`
                  : `${c.dot} w-2 h-2 hover:opacity-80`
              }`}
            />
          ))}
        </div>

        {/* Step content */}
        <div
          key={animKey}
          className={`px-7 pt-4 pb-3 tutorial-step-${dir}`}
        >
          {/* Icon */}
          <div className="flex justify-center mb-4">
            <div className={`w-20 h-20 rounded-2xl ${cur.iconBg} flex items-center justify-center tutorial-icon-bounce shadow-sm`}>
              <i className={`fa-solid ${cur.icon} text-4xl ${cur.iconColor}`} />
            </div>
          </div>

          {/* Step counter */}
          <p className="text-center text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
            Шаг {step + 1} из {steps.length}
          </p>

          {/* Title */}
          <h3 className="text-center text-base font-bold text-slate-800 mb-2">{cur.title}</h3>

          {/* Description */}
          <p className="text-center text-sm text-slate-600 leading-relaxed mb-3">{cur.description}</p>

          {/* Tip */}
          {cur.tip && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-[11px] text-amber-800 flex items-start gap-2">
              <i className="fa-solid fa-lightbulb text-amber-500 mt-0.5 shrink-0 text-xs" />
              <span>{cur.tip}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 pt-2 flex items-center justify-between">
          <button
            onClick={() => go(step - 1, 'left')}
            disabled={step === 0}
            className="px-3.5 py-2 rounded-lg text-sm text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
          >
            <i className="fa-solid fa-chevron-left mr-1 text-xs" />
            Назад
          </button>

          {step < steps.length - 1 ? (
            <button
              onClick={() => go(step + 1, 'right')}
              className={`px-5 py-2 rounded-lg text-sm font-semibold text-white ${c.btn} transition-colors`}
            >
              Далее
              <i className="fa-solid fa-chevron-right ml-1 text-xs" />
            </button>
          ) : (
            <button
              onClick={onClose}
              className={`px-5 py-2 rounded-lg text-sm font-semibold text-white ${c.btn} transition-colors flex items-center gap-1.5`}
            >
              <i className="fa-solid fa-check text-xs" />
              Понятно
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
