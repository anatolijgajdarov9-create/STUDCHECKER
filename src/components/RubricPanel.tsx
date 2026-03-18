import React, { useState } from 'react'
import { useStore, getSelectedRubric } from '../store/useStore'
import TutorialModal from './TutorialModal'
import type { TutorialStep } from './TutorialModal'

const RUBRIC_TUTORIAL: TutorialStep[] = [
  {
    icon: 'fa-list-check', iconColor: 'text-emerald-500', iconBg: 'bg-emerald-100',
    title: 'Что такое рубрика',
    description: 'Рубрика — набор критериев оценки работы. Каждый критерий определяет конкретный аспект, который проверяется ИИ',
  },
  {
    icon: 'fa-scale-balanced', iconColor: 'text-emerald-500', iconBg: 'bg-emerald-100',
    title: 'Веса и баллы',
    description: 'Каждый критерий имеет вес (%) и максимальный балл. Итоговый балл — это взвешенная сумма оценок по всем критериям',
    tip: 'Сумма всех весов должна равняться ровно 100%',
  },
  {
    icon: 'fa-pen-to-square', iconColor: 'text-emerald-500', iconBg: 'bg-emerald-100',
    title: 'Создание рубрики',
    description: 'Нажмите «Создать» для ручного создания: задайте критерии, их описания, веса и максимальные баллы',
  },
  {
    icon: 'fa-wand-magic-sparkles', iconColor: 'text-emerald-500', iconBg: 'bg-emerald-100',
    title: 'Генератор рубрик',
    description: 'Загрузите работу и используйте раздел «Генератор рубрик» ниже — ИИ автоматически создаст подходящую рубрику',
    tip: 'Можно указать тип работы для более точной генерации',
  },
]

export default function RubricPanel() {
  const { rubrics, selectedRubricId, setSelectedRubric, openRubricModal, deleteRubric, addLog } = useStore()
  const selectedRubric = useStore(getSelectedRubric)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showInfo, setShowInfo] = useState(false)

  const handleDelete = () => {
    if (!selectedRubricId) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    const name = selectedRubric?.name ?? ''
    deleteRubric(selectedRubricId)
    addLog(`Рубрика «${name}» удалена`, 'warning')
    setConfirmDelete(false)
  }

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <i className="fa-solid fa-list-check text-emerald-500 text-base" />
          Рубрика
        </h2>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowInfo(!showInfo)}
            title="Справка по рубрикам"
            className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] transition-all ${
              showInfo ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400 hover:bg-emerald-100 hover:text-emerald-500'
            }`}
          >
            <i className="fa-solid fa-info" />
          </button>
          {selectedRubricId && (
            <>
              <button
                onClick={() => { openRubricModal(selectedRubricId); setConfirmDelete(false) }}
                title="Редактировать рубрику"
                className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
              >
                <i className="fa-solid fa-pen text-[10px]" />
              </button>
              <button
                onClick={handleDelete}
                onBlur={() => setConfirmDelete(false)}
                title={confirmDelete ? 'Нажмите ещё раз для подтверждения' : 'Удалить рубрику'}
                className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${
                  confirmDelete
                    ? 'text-white bg-red-500 hover:bg-red-600'
                    : 'text-slate-400 hover:text-red-500 hover:bg-red-50'
                }`}
              >
                <i className={`fa-solid ${confirmDelete ? 'fa-trash-can' : 'fa-trash'} text-[10px]`} />
              </button>
            </>
          )}
          <button
            onClick={() => { openRubricModal(); setConfirmDelete(false) }}
            className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 transition-colors ml-1"
          >
            <i className="fa-solid fa-plus text-[10px]" /> Создать
          </button>
        </div>
      </div>

      <TutorialModal open={showInfo} onClose={() => setShowInfo(false)} title="Рубрики оценки" steps={RUBRIC_TUTORIAL} color="emerald" />

      {confirmDelete && (
        <p className="text-[10px] text-red-500 bg-red-50 rounded-lg px-2 py-1 mb-2 border border-red-100">
          Нажмите ещё раз для подтверждения удаления
        </p>
      )}

      <select
        value={selectedRubricId ?? ''}
        onChange={(e) => { setSelectedRubric(e.target.value); setConfirmDelete(false) }}
        className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:ring-2 focus:ring-blue-400 focus:border-blue-400 outline-none transition-all mb-3"
      >
        <option value="">-- Выберите рубрику --</option>
        {rubrics.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name} ({r.criteria.length} кр.)
          </option>
        ))}
      </select>

      {selectedRubric && (
        <div className="space-y-1.5">
          {selectedRubric.criteria.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between text-xs p-2 bg-slate-50 rounded-lg border border-slate-100"
            >
              <div className="min-w-0">
                <p className="font-medium text-slate-700 truncate">{c.name}</p>
                {c.description && (
                  <p className="text-slate-400 truncate text-[10px]">{c.description}</p>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0 ml-2">
                <span className="text-[10px] font-bold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded-full">
                  {c.weight}%
                </span>
                <span className="text-[10px] text-slate-500">{c.maxScore}б</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
