import React, { useState, useEffect } from 'react'
import { useStore } from '../store/useStore'
import type { RubricCriterion, Rubric } from '../types'

interface CriterionRow {
  name: string
  description: string
  weight: number
  maxScore: number
}

const defaultRow = (): CriterionRow => ({ name: '', description: '', weight: 20, maxScore: 10 })

// ── Help panel ────────────────────────────────────────────────────────────────

function HelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-lg shadow-2xl animate-slide-in overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-5 text-white">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-base font-bold flex items-center gap-2">
                <i className="fa-solid fa-circle-question" /> Как работает рубрика?
              </h3>
              <p className="text-xs text-blue-100 mt-0.5">Справочное руководство</p>
            </div>
            <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
              <i className="fa-solid fa-xmark text-lg" />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {[
            {
              n: 1, color: 'bg-blue-100 text-blue-600',
              title: 'Что такое рубрика?',
              body: 'Рубрика — набор критериев, по которым ИИ оценивает работу студента. Каждый критерий описывает конкретный аспект: структуру, содержание, оформление и т.д.'
            },
            {
              n: 2, color: 'bg-indigo-100 text-indigo-600',
              title: 'Вес критерия (%)',
              body: 'Вес задаёт важность критерия в итоговой оценке. Сумма всех весов = 100%.',
              extra: <div className="bg-slate-50 rounded-lg p-2 text-xs text-slate-500 font-mono mt-1">Итоговый балл = Σ (оценка × вес / 100)</div>
            },
            {
              n: 3, color: 'bg-violet-100 text-violet-600',
              title: 'Максимальный балл',
              body: 'Верхняя граница оценки по критерию (обычно 10). ИИ выставит оценку от 0 до этого числа. При расчёте балл нормализуется к 100%, поэтому разница между 10 и 100 несущественна.'
            },
            {
              n: 4, color: 'bg-emerald-100 text-emerald-600',
              title: 'Описание критерия',
              body: 'Это инструкция для ИИ: «что именно проверять». Чем конкретнее — тем точнее оценка.',
              list: ['Наличие введения, постановки задачи и заключения', 'Корректность формул и вычислений', 'Ссылки на источники, список литературы ГОСТ']
            }
          ].map(({ n, color, title, body, extra, list }) => (
            <section key={n}>
              <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-2">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${color}`}>{n}</span>
                {title}
              </h4>
              <div className="pl-8">
                <p className="text-xs text-slate-600 leading-relaxed">{body}</p>
                {extra}
                {list && (
                  <ul className="mt-1.5 space-y-1 text-xs text-slate-500 list-disc list-inside">
                    {list.map((item, i) => <li key={i}>{item}</li>)}
                  </ul>
                )}
              </div>
            </section>
          ))}

          {/* Tips */}
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-3.5">
            <h4 className="text-xs font-bold text-amber-800 flex items-center gap-1.5 mb-2">
              <i className="fa-solid fa-lightbulb text-amber-500" /> Советы
            </h4>
            <ul className="space-y-1.5 text-xs text-amber-700">
              {[
                '4–6 критериев — оптимальное количество для точной оценки',
                'Выделите главный критерий: дайте ему вес 25–35%',
                'Критерий «Оригинальность» / «Плагиат» автоматически запустит проверку через интернет',
                'Используйте Генератор рубрик — ИИ сам предложит критерии по тексту работы'
              ].map((tip, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <i className="fa-solid fa-check text-amber-500 mt-0.5 shrink-0" />
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Grade scale */}
          <section>
            <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-2">
              <span className="w-6 h-6 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center text-xs font-bold">5</span>
              Шкала итоговых оценок
            </h4>
            <div className="pl-8 grid grid-cols-2 gap-1.5">
              {[
                { grade: 'A', label: 'Отлично', range: '90–100', cls: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
                { grade: 'B', label: 'Хорошо', range: '80–89', cls: 'bg-green-50 border-green-200 text-green-700' },
                { grade: 'C', label: 'Удовлетворительно', range: '70–79', cls: 'bg-amber-50 border-amber-200 text-amber-700' },
                { grade: 'D', label: 'Достаточно', range: '60–69', cls: 'bg-orange-50 border-orange-200 text-orange-700' },
                { grade: 'E', label: 'Слабо', range: '50–59', cls: 'bg-red-50 border-red-200 text-red-500' },
                { grade: 'F', label: 'Неудовлетворительно', range: '0–49', cls: 'bg-red-100 border-red-300 text-red-700' },
              ].map(({ grade, label, range, cls }) => (
                <div key={grade} className={`flex items-center gap-2 p-2 rounded-lg border text-xs ${cls}`}>
                  <span className="font-bold text-sm w-5 text-center">{grade}</span>
                  <div>
                    <p className="font-medium leading-tight">{label}</p>
                    <p className="opacity-70">{range} б.</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="px-5 pb-5 pt-2 border-t border-slate-100">
          <button onClick={onClose} className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors">
            Понятно, закрыть
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main modal ────────────────────────────────────────────────────────────────

export default function RubricBuilderModal() {
  const {
    showRubricModal, setShowRubricModal, editingRubricId,
    rubrics, addRubric, updateRubric, setSelectedRubric, addLog
  } = useStore()

  const editingRubric = editingRubricId ? rubrics.find((r) => r.id === editingRubricId) ?? null : null
  const isEditing = !!editingRubric

  const [rubricName, setRubricName] = useState('')
  const [rows, setRows] = useState<CriterionRow[]>([defaultRow()])
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => {
    if (showRubricModal) {
      if (editingRubric) {
        setRubricName(editingRubric.name)
        setRows(editingRubric.criteria.map((c) => ({
          name: c.name, description: c.description, weight: c.weight, maxScore: c.maxScore
        })))
      } else {
        setRubricName('')
        setRows([defaultRow()])
      }
    }
  }, [showRubricModal, editingRubricId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!showRubricModal) return null

  const totalWeight = rows.reduce((s, r) => s + (r.weight || 0), 0)
  const weightOk = totalWeight === 100

  const updateRow = (i: number, field: keyof CriterionRow, value: string | number) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))

  const removeRow = (i: number) => {
    if (rows.length > 1) setRows((prev) => prev.filter((_, idx) => idx !== i))
  }

  const autoBalance = () => {
    const n = rows.length
    if (n === 0) return
    const base = Math.floor(100 / n)
    const rem = 100 - base * n
    setRows((prev) => prev.map((r, i) => ({ ...r, weight: base + (i === 0 ? rem : 0) })))
  }

  const close = () => setShowRubricModal(false)

  const save = () => {
    if (!rubricName.trim()) { addLog('Введите название рубрики', 'error'); return }
    if (!weightOk) { addLog(`Сумма весов должна быть 100%, сейчас ${totalWeight}%`, 'error'); return }
    const validRows = rows.filter((r) => r.name.trim())
    if (validRows.length === 0) { addLog('Добавьте хотя бы один критерий с названием', 'error'); return }

    const criteria: RubricCriterion[] = validRows.map((r, i) => ({
      id: editingRubric?.criteria[i]?.id ?? `c-${Date.now()}-${i}`,
      name: r.name.trim(),
      description: r.description.trim(),
      weight: r.weight,
      maxScore: r.maxScore
    }))

    if (isEditing && editingRubric) {
      updateRubric({ ...editingRubric, name: rubricName.trim(), criteria })
      addLog(`Рубрика «${rubricName.trim()}» обновлена (${criteria.length} критериев)`, 'success')
    } else {
      const rubric: Rubric = { id: `rubric-${Date.now()}`, name: rubricName.trim(), criteria }
      addRubric(rubric)
      setSelectedRubric(rubric.id)
      addLog(`Рубрика «${rubric.name}» сохранена (${criteria.length} критериев)`, 'success')
    }
    close()
  }

  return (
    <>
      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={close} />
        <div className="relative bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl animate-slide-in">

          {/* Header */}
          <div className="p-5 border-b border-slate-100 flex justify-between items-center sticky top-0 bg-white z-10 rounded-t-2xl">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <i className={`fa-solid ${isEditing ? 'fa-pen-to-square text-blue-500' : 'fa-plus-circle text-emerald-500'} text-base`} />
              {isEditing ? `Редактирование: ${editingRubric!.name}` : 'Конструктор рубрики'}
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowHelp(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors"
              >
                <i className="fa-solid fa-circle-question" />
                Справка
              </button>
              <button onClick={close} className="text-slate-400 hover:text-slate-600 transition-colors p-1">
                <i className="fa-solid fa-xmark text-lg" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Название рубрики</label>
              <input
                type="text"
                value={rubricName}
                onChange={(e) => setRubricName(e.target.value)}
                placeholder="Например: Курсовая работа по программированию"
                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-400 outline-none"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-slate-700">Критерии</h3>
                <div className="flex items-center gap-2">
                  {!weightOk && (
                    <button
                      onClick={autoBalance}
                      className="text-[10px] font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded-full transition-colors flex items-center gap-1 border border-blue-200"
                    >
                      <i className="fa-solid fa-sliders text-[9px]" />
                      Выровнять
                    </button>
                  )}
                  <div className={`text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${weightOk ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                    {weightOk && <i className="fa-solid fa-check text-[10px]" />}
                    Сумма: {totalWeight}%
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                {rows.map((row, i) => (
                  <div key={i} className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                    <div className="flex gap-2 items-center">
                      <span className="text-[10px] font-bold text-slate-400 w-4 text-center shrink-0">{i + 1}</span>
                      <input
                        type="text"
                        value={row.name}
                        onChange={(e) => updateRow(i, 'name', e.target.value)}
                        placeholder="Название критерия"
                        className="flex-1 p-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-blue-400 outline-none bg-white"
                      />
                      <div className="flex items-center gap-1">
                        <label className="text-[10px] text-slate-400">Вес%</label>
                        <input
                          type="number"
                          value={row.weight}
                          onChange={(e) => updateRow(i, 'weight', parseInt(e.target.value) || 0)}
                          min={0} max={100}
                          className="w-14 p-2 border border-slate-200 rounded-lg text-sm text-center focus:ring-1 focus:ring-blue-400 outline-none bg-white"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <label className="text-[10px] text-slate-400">Макс</label>
                        <input
                          type="number"
                          value={row.maxScore}
                          onChange={(e) => updateRow(i, 'maxScore', parseInt(e.target.value) || 1)}
                          min={1} max={100}
                          className="w-14 p-2 border border-slate-200 rounded-lg text-sm text-center focus:ring-1 focus:ring-blue-400 outline-none bg-white"
                        />
                      </div>
                      <button
                        onClick={() => removeRow(i)}
                        disabled={rows.length === 1}
                        className="p-2 text-slate-400 hover:text-red-500 transition-colors disabled:opacity-30"
                      >
                        <i className="fa-solid fa-trash text-sm" />
                      </button>
                    </div>
                    <input
                      type="text"
                      value={row.description}
                      onChange={(e) => updateRow(i, 'description', e.target.value)}
                      placeholder="Описание: что именно проверяет ИИ по этому критерию (необязательно)"
                      className="w-full p-2 border border-slate-200 rounded-lg text-xs text-slate-500 focus:ring-1 focus:ring-blue-400 outline-none bg-white"
                    />
                  </div>
                ))}
              </div>

              <button
                onClick={() => setRows((p) => [...p, defaultRow()])}
                className="mt-2 w-full py-2.5 rounded-xl border-2 border-dashed border-slate-300 hover:border-blue-400 hover:bg-blue-50 text-xs text-slate-500 hover:text-blue-600 transition-all"
              >
                <i className="fa-solid fa-plus mr-1" /> Добавить критерий
              </button>

              {!weightOk && totalWeight > 0 && (
                <p className="mt-2 text-[11px] text-red-500 text-center">
                  {totalWeight > 100
                    ? `Превышение на ${totalWeight - 100}% — уменьшите веса`
                    : `Не хватает ${100 - totalWeight}% — увеличьте веса`
                  }
                </p>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2 rounded-b-2xl sticky bottom-0">
            <button onClick={close} className="btn-secondary text-sm">Отмена</button>
            <button
              onClick={save}
              disabled={!weightOk || !rubricName.trim()}
              className={`btn-primary text-sm ${(!weightOk || !rubricName.trim()) ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <i className={`fa-solid ${isEditing ? 'fa-floppy-disk' : 'fa-plus'} mr-1.5`} />
              {isEditing ? 'Сохранить изменения' : 'Создать рубрику'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
