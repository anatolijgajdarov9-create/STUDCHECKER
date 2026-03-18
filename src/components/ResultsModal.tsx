import React, { useEffect, useRef } from 'react'
import { Chart, ArcElement, Tooltip, Legend, DoughnutController } from 'chart.js'
import { useStore } from '../store/useStore'

Chart.register(ArcElement, Tooltip, Legend, DoughnutController)

function stripMarkdown(text: string): string {
  if (!text) return ''
  return text
    .replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/#{1,6}\s+/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)\s]+\s*/gm, '')
    .replace(/^\s*>\s+/gm, '')
    .replace(/\n{2,}/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function formatRecommendation(text: string): string[] {
  const clean = stripMarkdown(text)
  const parts = clean.split(/(?:^|\s)(?:\d+[).])\s+/u).map(s => s.trim()).filter(Boolean)
  if (parts.length > 1) return parts
  const semi = clean.split(/;\s*/).map(s => s.trim()).filter(Boolean)
  if (semi.length > 1) return semi
  return [clean]
}

function stripMarkdownHtml(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html
  return stripMarkdown(div.textContent || div.innerText || '')
}

export default function ResultsModal() {
  const { currentResult, showResultsModal, setShowResultsModal, addLog } = useStore()
  const chartRef = useRef<HTMLCanvasElement>(null)
  const chartInstance = useRef<Chart | null>(null)

  useEffect(() => {
    if (!showResultsModal || !currentResult || !chartRef.current) return

    if (chartInstance.current) {
      chartInstance.current.destroy()
      chartInstance.current = null
    }

    const ctx = chartRef.current.getContext('2d')
    if (!ctx) return

    chartInstance.current = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Набрано', 'Остаток'],
        datasets: [
          {
            data: [currentResult.finalScore, 100 - currentResult.finalScore],
            backgroundColor: ['#3b82f6', '#e2e8f0'],
            borderWidth: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: { legend: { display: false }, tooltip: { enabled: false } }
      }
    })

    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy()
        chartInstance.current = null
      }
    }
  }, [showResultsModal, currentResult])

  if (!showResultsModal || !currentResult) return null

  const handleDownload = () => {
    const lines = [
      `# Отчёт о проверке работы`,
      ``,
      `**Файл:** ${currentResult.fileName}`,
      `**Дата:** ${new Date(currentResult.timestamp).toLocaleString('ru-RU')}`,
      `**Модель:** ${currentResult.modelUsed}`,
      `**Рубрика:** ${currentResult.rubricName}`,
      ``,
      `---`,
      ``,
      `## Итоговая оценка: ${currentResult.finalScore}/100`,
      `**Оценка:** ${currentResult.grade} — ${currentResult.gradeDescription}`,
      ``,
      ...(currentResult.summaryComment ? [`**Заключение ИИ:** ${currentResult.summaryComment}`, ``] : []),
      `---`,
      ``,
      `## Оценки по критериям`,
      ``,
      ...currentResult.criteria.flatMap((c) => [
        `### ${c.criterionName} (вес ${c.weight}%)`,
        `- **Балл:** ${c.score}/${c.maxScore} (${c.normalizedScore}%)`,
        `- **Обоснование:** ${c.justification}`,
        `- **Рекомендации:** ${c.recommendations}`,
        c.strengths.length ? `- **Сильные стороны:** ${c.strengths.join(', ')}` : '',
        c.weaknesses.length ? `- **Слабые стороны:** ${c.weaknesses.join(', ')}` : '',
        ``
      ]),
      `---`,
      `*Сгенерировано Smart Grader AI*`
    ]
    const blob = new Blob([lines.filter(Boolean).join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `report_${currentResult.fileName.replace(/\.[^.]+$/, '')}_${Date.now()}.md`
    a.click()
    URL.revokeObjectURL(url)
    addLog('Отчёт скачан', 'success')
  }

  const gradeColor =
    currentResult.finalScore >= 80
      ? 'text-emerald-600'
      : currentResult.finalScore >= 60
      ? 'text-amber-600'
      : 'text-red-600'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        onClick={() => setShowResultsModal(false)}
      />
      <div className="relative bg-white rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl animate-slide-in">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex justify-between items-center sticky top-0 bg-white z-10 rounded-t-2xl">
          <h2 className="text-xl font-bold text-slate-800">Результаты проверки</h2>
          <button
            onClick={() => setShowResultsModal(false)}
            className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500"
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Overview */}
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-1 bg-blue-50 rounded-xl p-4 border border-blue-100 flex flex-col items-center justify-center">
              <p className="text-xs text-slate-500 mb-1">Итоговая оценка</p>
              <p className={`text-5xl font-extrabold ${gradeColor}`}>{currentResult.finalScore}</p>
              <p className="text-xs font-bold text-slate-600 mt-1">/100</p>
              <span className="mt-2 px-3 py-1 bg-white rounded-full text-sm font-bold text-slate-700 shadow-sm border border-slate-200">
                {currentResult.grade} — {currentResult.gradeDescription}
              </span>
            </div>
            <div className="col-span-2 flex flex-col justify-between">
              <div className="text-sm text-slate-500 space-y-1">
                <p><span className="font-medium text-slate-700">Файл:</span> {currentResult.fileName}</p>
                <p><span className="font-medium text-slate-700">Рубрика:</span> {currentResult.rubricName}</p>
                <p><span className="font-medium text-slate-700">Модель:</span> {currentResult.modelUsed}</p>
                <p><span className="font-medium text-slate-700">Дата:</span> {new Date(currentResult.timestamp).toLocaleString('ru-RU')}</p>
              </div>
              <div className="relative h-28 mt-2">
                <canvas ref={chartRef} />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className={`text-xl font-extrabold ${gradeColor}`}>{currentResult.finalScore}%</span>
                </div>
              </div>
            </div>
          </div>

          {/* AI Summary */}
          {currentResult.summaryComment && (
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-200 p-4 flex gap-3">
              <div className="shrink-0 w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
                <i className="fa-solid fa-brain text-white text-xs" />
              </div>
              <div>
                <p className="text-xs font-bold text-blue-800 mb-1">Заключение ИИ</p>
                <p className="text-sm text-slate-700 leading-relaxed">{currentResult.summaryComment}</p>
              </div>
            </div>
          )}

          {/* Criteria breakdown */}
          <div>
            <h3 className="text-base font-bold text-slate-800 mb-3">Детальный разбор по критериям</h3>
            <div className="space-y-3">
              {currentResult.criteria.map((c) => {
                const pct = Math.round((c.score / c.maxScore) * 100)
                const barColor =
                  pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500'
                const scoreColor =
                  pct >= 80 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-red-600'

                // Render justification as plain text (no markdown)
                const feedbackText = stripMarkdown(c.justification)

                return (
                  <div key={c.criterionName} className="bg-slate-50 rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <span className="font-semibold text-slate-800 text-sm">{c.criterionName}</span>
                        <span className="text-xs text-slate-500 ml-2">вес {c.weight}%</span>
                      </div>
                      <span className={`text-lg font-bold ${scoreColor}`}>
                        {c.score}<span className="text-sm text-slate-400">/{c.maxScore}</span>
                      </span>
                    </div>
                    <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden mb-3">
                      <div
                        className={`h-full ${barColor} rounded-full transition-all duration-700`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div
                      className="text-xs text-slate-600 mb-2 whitespace-pre-wrap"
                    >
                      {feedbackText}
                    </div>
                    {c.recommendations && (
                      <p className="text-xs text-blue-700 bg-blue-50 rounded-lg px-3 py-1.5 border border-blue-100 mb-2">
                        <i className="fa-solid fa-lightbulb mr-1" />
                        {stripMarkdown(c.recommendations)}
                      </p>
                    )}
                    <div className="flex gap-3 flex-wrap">
                      {c.strengths.map((s, i) => (
                        <span key={i} className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full">
                          + {stripMarkdown(s)}
                        </span>
                      ))}
                      {c.weaknesses.map((w, i) => (
                        <span key={i} className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
                          − {stripMarkdown(w)}
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Action plan */}
          {(() => {
            const weak = currentResult.criteria
              .filter(c => c.normalizedScore < 85 && c.recommendations)
              .sort((a, b) => a.normalizedScore - b.normalizedScore)
            if (weak.length === 0) return null
            return (
              <div>
                <h3 className="text-base font-bold text-slate-800 mb-1 flex items-center gap-2">
                  <i className="fa-solid fa-route text-blue-500" />
                  Приоритетный план доработки
                </h3>
                <p className="text-xs text-slate-500 mb-3">
                  Критерии отсортированы по приоритету — от наиболее критичных к менее важным
                </p>
                {currentResult.sourcesUsed && currentResult.sourcesUsed.length > 0 && (
                  <div className="bg-slate-50 rounded-xl border border-slate-200 px-3 py-2 mb-3 flex items-start gap-2">
                    <i className="fa-solid fa-book-open text-slate-400 mt-0.5 shrink-0 text-xs" />
                    <div>
                      <p className="text-[10px] font-semibold text-slate-600 mb-0.5">Использованные источники:</p>
                      <p className="text-[10px] text-slate-500">{currentResult.sourcesUsed.join(' · ')}</p>
                    </div>
                  </div>
                )}
                <div className="space-y-3">
                  {weak.map((c, idx) => {
                    const priority = c.normalizedScore < 50 ? 'critical' : c.normalizedScore < 70 ? 'high' : 'medium'
                    const priorityConfig = {
                      critical: { label: 'Критично', cls: 'bg-red-100 text-red-700 border-red-200', dot: 'bg-red-500', bar: 'bg-red-100', border: 'border-red-200' },
                      high:     { label: 'Важно',    cls: 'bg-amber-100 text-amber-700 border-amber-200', dot: 'bg-amber-500', bar: 'bg-amber-50', border: 'border-amber-200' },
                      medium:   { label: 'Желательно', cls: 'bg-blue-100 text-blue-700 border-blue-200', dot: 'bg-blue-400', bar: 'bg-blue-50', border: 'border-blue-200' },
                    }
                    const pc = priorityConfig[priority]
                    const steps = formatRecommendation(c.recommendations)
                    return (
                      <div key={c.criterionName} className={`rounded-xl border ${pc.border} ${pc.bar} p-3.5`}>
                        <div className="flex items-center gap-2 mb-2">
                          <div className={`w-2 h-2 rounded-full ${pc.dot} shrink-0`} />
                          <span className="text-xs font-semibold text-slate-700 flex-1">{c.criterionName}</span>
                          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${pc.cls}`}>{pc.label}</span>
                          <span className="text-[10px] text-slate-500">{Math.round(c.normalizedScore)}%</span>
                        </div>
                        {steps.length > 1 ? (
                          <ol className="space-y-1 pl-1">
                            {steps.map((s, i) => (
                              <li key={i} className="flex items-start gap-2 text-[11px] text-slate-700">
                                <span className={`w-4 h-4 rounded-full ${pc.dot} text-white text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5`}>{i + 1}</span>
                                <span>{s}</span>
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p className="text-[11px] text-slate-700 pl-4">{c.recommendations}</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex items-center justify-between sticky bottom-0">
          <span className="text-xs text-slate-400 flex items-center gap-1.5">
            <i className="fa-solid fa-circle-check text-emerald-500" />
            Сохранено в историю
          </span>
          <div className="flex gap-2">
            <button onClick={handleDownload} className="btn-secondary text-sm flex items-center gap-2">
              <i className="fa-solid fa-download" /> Скачать MD
            </button>
            <button onClick={() => setShowResultsModal(false)} className="btn-primary text-sm flex items-center gap-2">
              <i className="fa-solid fa-check" /> Закрыть
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
