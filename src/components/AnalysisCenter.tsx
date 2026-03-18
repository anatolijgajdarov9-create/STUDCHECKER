import React, { useEffect, useState } from 'react'
import { useStore, getSelectedRubric } from '../store/useStore'
import {
  evaluateCriterion,
  calculateFinalScore,
  summarizeCriteria
} from '../services/llamaApi'
import { runPlagiarismCheck } from '../services/plagiarismChecker'
import { parseModels, assignModels, uniqueModelNames, analyzeContent } from '../services/modelSelector'
import { addToKnowledgeBase, findSimilar, buildRagContext, getKnowledgeBase } from '../services/ragService'
import type { CriterionResult, ExpertStep, AiModel, RubricCriterion } from '../types'
import TutorialModal from './TutorialModal'
import type { TutorialStep } from './TutorialModal'

const ANALYSIS_TUTORIAL: TutorialStep[] = [
  {
    icon: 'fa-map', iconColor: 'text-blue-500', iconBg: 'bg-blue-100',
    title: 'Планировщик',
    description: 'Первый этап: анализирует документ и формирует детальный план проверки по каждому критерию рубрики',
  },
  {
    icon: 'fa-user-graduate', iconColor: 'text-blue-500', iconBg: 'bg-blue-100',
    title: 'Эксперты',
    description: 'Для каждого критерия независимый эксперт изучает работу и выставляет оценку с обоснованием и рекомендациями',
  },
  {
    icon: 'fa-shield-halved', iconColor: 'text-blue-500', iconBg: 'bg-blue-100',
    title: 'Антиплагиат',
    description: 'Система проверяет оригинальность: ищет совпадения с материалами в интернете и вычисляет процент уникальности',
    tip: 'Для работы требуется подключение к интернету',
  },
  {
    icon: 'fa-sigma', iconColor: 'text-blue-500', iconBg: 'bg-blue-100',
    title: 'Сумматор',
    description: 'Финальный этап: применяет веса критериев, рассчитывает итоговый балл и формирует приоритетный план доработки',
  },
]

export default function AnalysisCenter() {
  const store = useStore()
  const selectedRubric = useStore(getSelectedRubric)
  const {
    config, selectedModelId, fileQueue, sources,
    isAnalyzing, analysisProgress, expertSteps,
    setAnalyzing, setProgress, setExpertSteps, updateExpertStep,
    setCurrentResult, setShowResultsModal, addLog,
    setConnected, saveToHistory, addRequestLog, setPlagiarismReport
  } = store

  const isElectron = !!window.electronAPI
  const canStart = fileQueue.length > 0 && !!selectedRubric && !isAnalyzing &&
    (isElectron || !!selectedModelId)

  // Live criteria results updated as each criterion finishes — used by SummarizerCard
  const [liveCriteriaResults, setLiveCriteriaResults] = useState<CriterionResult[]>([])
  const [currentCriteriaNames, setCurrentCriteriaNames] = useState<string[]>([])
  const [showInfo, setShowInfo] = useState(false)

  const startAnalysis = async () => {
    if (!canStart || !selectedRubric) return

    setAnalyzing(true)
    setProgress(0)
    setLiveCriteriaResults([])

    const criteria = selectedRubric.criteria
    const total = criteria.length
    const port = config.llamaPort
    const baseUrl = `http://127.0.0.1:${port}`
    const filesTotal = fileQueue.length

    let modelAssignment: Map<string, AiModel> | null = null
    let firstModel: AiModel | null = null
    let modelsLabel = selectedModelId ?? 'unknown'

    // Analyse the first file's content before model assignment
    const firstContent = fileQueue[0]?.content ?? ''

    try {
      if (isElectron) {
        addLog('Сканирование папки aimodels...', 'info')
        const listResult = await window.electronAPI!.listAiModels()

        if (!listResult.success || listResult.models.length === 0) {
          const reason = listResult.error ?? 'Папка aimodels пуста'
          addLog(`Ошибка: ${reason}`, 'error')
          addLog('Добавьте .gguf файлы в папку aimodels рядом с приложением', 'warning')
          setAnalyzing(false)
          return
        }

        const aiModels = parseModels(listResult.models)
        addLog(`Найдено моделей: ${aiModels.length} — ${aiModels.map((m) => m.displayName).join(', ')}`, 'success')

        // Content analysis — determines domain and complexity before assignment
        if (firstContent.length > 100) {
          const ca = analyzeContent(firstContent)
          const domainLabels: Record<string, string> = {
            technical: 'техническая/STEM', humanities: 'гуманитарная',
            business: 'экономическая/бизнес', mixed: 'смешанная'
          }
          addLog(
            `Анализ работы: ${domainLabels[ca.domain]} тематика, ` +
            `сложность ${Math.round(ca.complexity * 100)}%, ` +
            `~${ca.wordCount} слов, ср. длина предложения ${Math.round(ca.avgSentenceLen)} слов`,
            'info'
          )
        }

        modelAssignment = assignModels(aiModels, criteria, firstContent)
        firstModel = aiModels[0]
        modelsLabel = uniqueModelNames(modelAssignment).join(', ')
        const assignmentLines = criteria
          .map((c) => { const m = modelAssignment!.get(c.id); return m ? `${c.name} → ${m.displayName}` : null })
          .filter(Boolean)
          .join(' | ')
        addLog(`Распределение моделей: ${assignmentLines}`, 'info')
      }

      const activeModelId = isElectron ? 'local' : (selectedModelId ?? '')
      const similarWorks = findSimilar(firstContent, 3)
      const ragContext = buildRagContext(similarWorks)
      if (similarWorks.length > 0) {
        addLog(`База знаний: найдено ${similarWorks.length} похожих работ (схожесть ${Math.round(similarWorks[0].similarity * 100)}%)`, 'info')
      }

      const sourcesWithRag = ragContext
        ? [...sources, { name: '[RAG] Похожие работы из базы знаний', content: ragContext }]
        : sources

      const apiConfig = {
        url: isElectron ? baseUrl : config.llamaUrl,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        modelId: activeModelId,
        sources: sourcesWithRag,
        onLog: addLog,
        onRequestLog: addRequestLog
      }

      for (let fi = 0; fi < filesTotal; fi++) {
        const { name: fileName, content: fileContent } = fileQueue[fi]

        if (filesTotal > 1) {
          addLog(`━━ Файл ${fi + 1}/${filesTotal}: ${fileName} ━━`, 'info')
        }

        setLiveCriteriaResults([])
        const criteriaNames = criteria.map((c) => c.name)
        setCurrentCriteriaNames(criteriaNames)

        const steps: ExpertStep[] = [
          { id: 'planner', name: 'Планировщик', status: 'pending' },
          ...criteria.map((c, i) => ({
            id: `expert-${i}`,
            name: c.name,
            status: 'pending' as const
          })),
          { id: 'plagiarism', name: 'Антиплагиат', status: 'pending' },
          { id: 'summarizer', name: 'Сумматор', status: 'pending' }
        ]
        setExpertSteps(steps)

        if (modelAssignment) {
          criteria.forEach((c, i) => {
            const m = modelAssignment!.get(c.id)
            if (m) updateExpertStep(`expert-${i}`, { modelName: m.displayName })
          })
        }

        addLog(`Текст: ${fileContent.length} символов, критериев: ${total}`, 'info')

        // ── Планировщик ────────────────────────────────────────────────────
        updateExpertStep('planner', { status: 'running' })
        addLog(`Планировщик: анализ документа «${fileName}»...`, 'info')

        // Artificial delay so the planner animation is visible
        await new Promise<void>((r) => setTimeout(r, 2000))

        const wordCount = fileContent.split(/\s+/).filter(Boolean).length
        const plannerPrompt =
          `Файл: ${fileName}\n` +
          `Размер: ${fileContent.length} символов, ~${wordCount} слов\n` +
          `Критериев в рубрике: ${total}\n` +
          `Рубрика: ${selectedRubric.name}`
        const plannerResponse = criteria
          .map((c, i) => `${i + 1}. ${c.name} (вес ${c.weight}%, макс ${c.maxScore} б) — ${c.description}`)
          .join('\n')
        addRequestLog({ criterion: 'Планировщик', prompt: plannerPrompt, response: plannerResponse, durationMs: 0, status: 'ok' })
        addLog(`Планировщик: готово — ${wordCount} слов, ${total} критериев`, 'success')
        updateExpertStep('planner', { status: 'completed', score: total, maxScore: total })

        const criteriaResults: CriterionResult[] = []
        let plagiarismCache: import('../types').PlagiarismReport | null = null

        const runPlagiarism = async (progressStepId: string) => {
          const report = await runPlagiarismCheck(
            fileContent,
            (check, checked, tot) => {
              updateExpertStep(progressStepId, { modelName: `${checked}/${tot} источников` })
              const response =
                check.status === 'checked'
                  ? `Совпадение: ${check.matchPercent}%` +
                    (check.borrowings.length > 0
                      ? '\nЗаимствования:\n' + check.borrowings.map((b) => `• «${b}»`).join('\n')
                      : '\nЗаимствований не найдено')
                  : `Ошибка: ${check.errorMsg ?? 'неизвестная'}`
              addRequestLog({
                criterion: `Антиплагиат: сравнение [${checked}/${tot}]`,
                prompt: check.url + (check.title ? `\n${check.title}` : ''),
                response,
                durationMs: 0,
                status: check.status === 'error' ? 'error' : 'ok'
              })
            },
            addLog,
            (query, foundUrls) => {
              addLog(`Поиск DuckDuckGo: «${query.substring(0, 60)}» → ${foundUrls.length} результатов`, 'info')
              addRequestLog({
                criterion: 'Антиплагиат: поиск',
                prompt: query,
                response: foundUrls.length > 0
                  ? foundUrls.map((u) => `• ${u.url}\n  ${u.title}`).join('\n')
                  : 'Результатов не найдено',
                durationMs: 0,
                status: 'ok'
              })
            }
          )
          plagiarismCache = report
          setPlagiarismReport(report)
          return report
        }

        // ── Criteria loop ──────────────────────────────────────────────────
        for (let i = 0; i < total; i++) {
          const criterion = criteria[i]
          const stepId = `expert-${i}`
          const assignedModel = modelAssignment?.get(criterion.id) ?? firstModel

          if (isOriginalityCriterion(criterion)) {
            updateExpertStep(stepId, { status: 'running' })
            addLog(`Антиплагиат: запуск для критерия «${criterion.name}»...`, 'info')

            try {
              const report = plagiarismCache ?? await runPlagiarism(stepId)
              const score = Math.round((report.originalityScore / 100) * criterion.maxScore)
              const sorted = report.checkedUrls
                .filter((u) => u.matchPercent > 0)
                .sort((a, b) => b.matchPercent - a.matchPercent)
              const internetMatches = sorted.filter(u => !u.url.startsWith('kb://')).slice(0, 3)
              const ragMatches = sorted.filter(u => u.url.startsWith('kb://')).slice(0, 3)
              const internetCount = report.checkedUrls.filter(u => !u.url.startsWith('kb://')).length
              const ragCount = report.checkedUrls.filter(u => u.url.startsWith('kb://')).length

              const justification =
                `Оригинальность работы: ${report.originalityScore}%. ` +
                `Интернет: проверено ${internetCount} источников` +
                (internetMatches.length > 0 ? `, макс. совпадение ${internetMatches[0].matchPercent}% с ${internetMatches[0].url}` : ', совпадений нет') + '. ' +
                (ragCount > 0
                  ? `База знаний: проверено ${ragCount} работ` + (ragMatches.length > 0 ? `, макс. совпадение ${ragMatches[0].matchPercent}% с «${ragMatches[0].title.replace('[База знаний] ', '')}»` : ', совпадений нет') + '.'
                  : 'База знаний пуста.')

              const recommendations =
                report.originalityScore < 60
                  ? 'Обнаружены значительные заимствования. Необходима глубокая переработка текста и правильное цитирование источников.'
                  : report.originalityScore < 80
                  ? 'Имеются отдельные совпадения. Рекомендуется пересмотреть цитирование и добавить собственный анализ.'
                  : 'Уровень оригинальности соответствует академическим требованиям.'

              const cr: CriterionResult = {
                criterionName: criterion.name,
                weight: criterion.weight,
                score,
                maxScore: criterion.maxScore,
                normalizedScore: report.originalityScore,
                weightedScore: Math.round(report.originalityScore * (criterion.weight / 100) * 10) / 10,
                justification,
                recommendations,
                strengths: [],
                weaknesses: []
              }
              criteriaResults.push(cr)
              setLiveCriteriaResults((prev) => [...prev, cr])
              updateExpertStep(stepId, { status: 'completed', score, maxScore: criterion.maxScore, modelName: `${report.originalityScore}% оригинальности` })
              addLog(`${criterion.name}: ${score}/${criterion.maxScore} баллов (${report.originalityScore}% оригинальности)`, 'success')
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : String(e)
              addLog(`Ошибка антиплагиата: ${msg}`, 'error')
              updateExpertStep(stepId, { status: 'error' })
              const fb = makeFallback(criterion, msg)
              criteriaResults.push(fb)
              setLiveCriteriaResults((prev) => [...prev, fb])
            }

            setProgress(((fi * (total + 2) + i + 1) / (filesTotal * (total + 2))) * 90)
            continue
          }

          if (isElectron && assignedModel) {
            updateExpertStep(stepId, { status: 'loading', modelName: assignedModel.displayName })
            addLog(`Загрузка модели: ${assignedModel.displayName}...`, 'info')

            const sw = await window.electronAPI!.switchLlamaModel(assignedModel.path, port)
            if (!sw.success) {
              addLog(`Не удалось загрузить модель: ${sw.error}`, 'error')
              updateExpertStep(stepId, { status: 'error' })
              const fb = makeFallback(criterion, `Ошибка загрузки модели: ${sw.error}`)
              criteriaResults.push(fb)
              setLiveCriteriaResults((prev) => [...prev, fb])
              setProgress(((fi * total + i + 1) / (filesTotal * total)) * 90)
              continue
            }
            addLog(`Модель загружена`, 'success')
            setConnected(true)
          }

          updateExpertStep(stepId, { status: 'running' })
          addLog(`Оценка: ${criterion.name}...`, 'info')

          try {
            const result = await evaluateCriterion(apiConfig, criterion, null, fileContent)
            criteriaResults.push(result)
            setLiveCriteriaResults((prev) => [...prev, result])
            updateExpertStep(stepId, { status: 'completed', score: result.score, maxScore: criterion.maxScore })
            addLog(`${criterion.name}: ${result.score}/${criterion.maxScore} баллов`, 'success')
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e)
            addLog(`Ошибка оценки "${criterion.name}": ${msg}`, 'error')
            updateExpertStep(stepId, { status: 'error' })
            const fb = makeFallback(criterion, msg)
            criteriaResults.push(fb)
            setLiveCriteriaResults((prev) => [...prev, fb])
          }

          if (isElectron) {
            addLog(`Выгрузка модели...`, 'info')
            await window.electronAPI!.stopLlamaServer()
            await new Promise<void>((r) => setTimeout(r, 800))
          }

          setProgress(((fi * (total + 2) + i + 1) / (filesTotal * (total + 2))) * 90)
        }

        // ── Антиплагиат ───────────────────────────────────────────────────
        updateExpertStep('plagiarism', { status: 'running' })
        const kbCount = getKnowledgeBase().length
        addLog(`Антиплагиат: запуск проверки (база знаний: ${kbCount} работ)...`, 'info')

        try {
          if (plagiarismCache) {
            addLog(`Антиплагиат: используется кэш (${plagiarismCache.checkedUrls.length} источников)`, 'info')
          } else {
            await runPlagiarism('plagiarism')
          }
          const rep = plagiarismCache!
          updateExpertStep('plagiarism', { status: 'completed', score: rep.originalityScore, maxScore: 100, modelName: `${rep.originalityScore}% оригинальности` })
          addLog(`Антиплагиат: ${rep.originalityScore}% оригинальности (${rep.checkedUrls.length} источников)`, 'success')

          // ── Inject plagiarism into scoring if rubric has no originality criterion ──
          const hasOrigCriterion = criteria.some(isOriginalityCriterion)
          if (!hasOrigCriterion) {
            const plagScore = Math.round((rep.originalityScore / 100) * 10)
            const internetCount = rep.checkedUrls.filter(u => !u.url.startsWith('kb://')).length
            const ragCount = rep.checkedUrls.filter(u => u.url.startsWith('kb://')).length
            const topMatch = rep.checkedUrls
              .filter(u => u.matchPercent > 0)
              .sort((a, b) => b.matchPercent - a.matchPercent)[0]

            const plagCr: CriterionResult = {
              criterionName: 'Оригинальность текста',
              weight: 20,
              score: plagScore,
              maxScore: 10,
              normalizedScore: rep.originalityScore,
              weightedScore: Math.round(rep.originalityScore * 0.2 * 10) / 10,
              justification:
                `Оригинальность: ${rep.originalityScore}%. ` +
                `Проверено ${internetCount} интернет-источников и ${ragCount} работ из базы знаний. ` +
                (topMatch
                  ? `Наибольшее совпадение: ${topMatch.matchPercent}% с «${topMatch.title || topMatch.url}».`
                  : 'Значимых совпадений не обнаружено.'),
              recommendations:
                rep.originalityScore < 60
                  ? 'Обнаружены значительные заимствования. Необходима переработка текста и правильное оформление цитат.'
                  : rep.originalityScore < 80
                  ? 'Имеются совпадения с источниками. Рекомендуется пересмотреть цитирование и усилить авторский анализ.'
                  : 'Уровень оригинальности соответствует академическим требованиям.',
              strengths: rep.originalityScore >= 80 ? ['Высокий уровень оригинальности'] : [],
              weaknesses: rep.originalityScore < 80 ? [`Оригинальность ${rep.originalityScore}% — ниже нормы`] : [],
            }
            criteriaResults.push(plagCr)
            setLiveCriteriaResults((prev) => [...prev, plagCr])
            addLog(
              `Оригинальность: ${plagScore}/10 баллов (${rep.originalityScore}%) — учтено в итоговой оценке`,
              rep.originalityScore < 80 ? 'warning' : 'success'
            )
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e)
          addLog(`Ошибка антиплагиата: ${msg}`, 'error')
          updateExpertStep('plagiarism', { status: 'error' })
        }

        setProgress(((fi * (total + 2) + total + 1) / (filesTotal * (total + 2))) * 90)

        // ── Сумматор ──────────────────────────────────────────────────────
        updateExpertStep('summarizer', { status: 'running' })
        addLog('Сумматор: синтез экспертных оценок через ИИ...', 'info')

        const summarizerStart = Date.now()
        const sourcesUsed = sources.map((s) => s.name)

        // Compute numeric score first (needed for summarizer prompt)
        const tempResult = calculateFinalScore(criteriaResults, fileName, selectedRubric.name, modelsLabel, sourcesUsed)

        // AI synthesis of all expert justifications
        let summaryComment = ''
        try {
          summaryComment = await summarizeCriteria(apiConfig, criteriaResults, selectedRubric.name, fileName, tempResult.finalScore)
          addLog('Сумматор: синтез завершён', 'success')
        } catch {
          addLog('Сумматор: синтез через ИИ недоступен', 'warning')
        }

        const finalResult = calculateFinalScore(criteriaResults, fileName, selectedRubric.name, modelsLabel, sourcesUsed, summaryComment)
        const summarizerDuration = Date.now() - summarizerStart

        const summarizerPrompt = criteriaResults
          .map((c) => `${c.criterionName}: ${c.score}/${c.maxScore} (вес ${c.weight}%, взвешено ${c.weightedScore})`)
          .join('\n')
        const summarizerResponse =
          (summaryComment ? `Заключение ИИ: ${summaryComment}\n\n` : '') +
          `Итоговый балл: ${finalResult.finalScore}/100\n` +
          `Оценка: ${finalResult.grade} — ${finalResult.gradeDescription}\n` +
          `Файл: ${finalResult.fileName}\n` +
          `Рубрика: ${finalResult.rubricName}`
        addRequestLog({ criterion: 'Сумматор', prompt: summarizerPrompt, response: summarizerResponse, durationMs: summarizerDuration, status: 'ok' })

        updateExpertStep('summarizer', { status: 'completed', score: finalResult.finalScore, maxScore: 100 })
        saveToHistory(finalResult)
        setCurrentResult(finalResult)

        try {
          addToKnowledgeBase(finalResult, fileContent)
          const kbTotal = getKnowledgeBase().length
          addLog(`База знаний: работа «${fileName}» сохранена (всего ${kbTotal} работ)`, 'success')
        } catch (e) {
          addLog(`База знаний: ошибка сохранения — ${e instanceof Error ? e.message : String(e)}`, 'error')
        }

        addLog(`${fileName}: ${finalResult.finalScore}/100 (${finalResult.grade} — ${finalResult.gradeDescription})`, 'success')
      }

      setProgress(100)
      addLog(filesTotal > 1 ? `Все ${filesTotal} работ проверены!` : 'Проверка завершена!', 'success')
      setTimeout(() => setShowResultsModal(true), 400)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      addLog(`Критическая ошибка: ${msg}`, 'error')
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Start button */}
      <div className="glass-card p-6 text-center">
        <div className="flex items-center justify-end mb-3">
          <button
            onClick={() => setShowInfo(!showInfo)}
            title="Как работает проверка"
            className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] transition-all ${
              showInfo ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-400 hover:bg-blue-100 hover:text-blue-500'
            }`}
          >
            <i className="fa-solid fa-info" />
          </button>
        </div>

        <TutorialModal open={showInfo} onClose={() => setShowInfo(false)} title="Процесс проверки" steps={ANALYSIS_TUTORIAL} color="blue" />

        <button
          onClick={startAnalysis}
          disabled={!canStart}
          className={`w-full py-3.5 px-6 rounded-xl font-bold text-base transition-all flex items-center justify-center gap-3 ${showInfo ? 'mt-3' : ''} ${
            canStart
              ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-lg shadow-blue-500/30 hover:scale-[1.01] active:scale-[0.99]'
              : 'bg-slate-100 text-slate-400 cursor-not-allowed'
          }`}
        >
          {isAnalyzing ? (
            <><i className="fa-solid fa-circle-notch fa-spin" /><span>Анализируем...</span></>
          ) : (
            <><i className="fa-solid fa-play" /><span>Начать проверку</span></>
          )}
        </button>

        <p className="mt-2 text-xs text-slate-400">
          {isElectron ? 'Авто-выбор модели из папки aimodels' : `Анализ через llama-server · ${config.llamaUrl}`}
        </p>

        {fileQueue.length === 0 && <p className="text-xs text-amber-600 mt-1">Загрузите файл работы</p>}
        {fileQueue.length > 0 && !isAnalyzing && (
          <p className="text-xs text-slate-400 mt-1">{fileQueue.length} {fileQueue.length === 1 ? 'файл' : 'файлов'} в очереди</p>
        )}
        {!selectedRubric && <p className="text-xs text-amber-600 mt-1">Выберите рубрику</p>}
        {!isElectron && !selectedModelId && <p className="text-xs text-amber-600 mt-1">Выберите модель ИИ</p>}
      </div>

      {/* Steps */}
      {(isAnalyzing || expertSteps.length > 0) && (
        <div className="glass-card p-5">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Прогресс</span>
            <span className="text-lg font-bold text-blue-600">{Math.round(analysisProgress)}%</span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-2.5 mb-5 overflow-hidden">
            <div
              className="progress-gradient h-2.5 rounded-full transition-all duration-500"
              style={{ width: `${analysisProgress}%` }}
            />
          </div>

          <div className="space-y-2">
            <OrchestratorCard expertSteps={expertSteps} progress={analysisProgress} />
            {expertSteps.filter(s => s.id === 'planner').map(step => (
              <ExpertStepRow key={step.id} step={step} criteriaNames={currentCriteriaNames} variant="planner" />
            ))}
            {(() => {
              const cs = expertSteps.filter(s => s.id.startsWith('expert-'))
              return cs.length > 0 ? <CriteriaCard key="criteria" steps={cs} /> : null
            })()}
            {expertSteps.filter(s => s.id === 'plagiarism').map(step => (
              <ExpertStepRow key={step.id} step={step} variant="plagiarism" />
            ))}
            {expertSteps.filter(s => s.id === 'summarizer').map(step => (
              <ExpertStepRow key={step.id} step={step} criteriaResults={liveCriteriaResults} variant="summarizer" />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isOriginalityCriterion(c: RubricCriterion): boolean {
  const n = c.name.toLowerCase()
  const d = c.description.toLowerCase()
  return n.includes('оригинал') || n.includes('плагиат') || n.includes('уникальн') ||
    d.includes('плагиат') || d.includes('уникальн') || d.includes('заимствован')
}

function makeFallback(
  criterion: { name: string; weight: number; maxScore: number },
  reason: string
): CriterionResult {
  const score = Math.floor(criterion.maxScore * 0.5)
  const normalizedScore = (score / criterion.maxScore) * 100
  return {
    criterionName: criterion.name,
    weight: criterion.weight,
    score,
    maxScore: criterion.maxScore,
    normalizedScore,
    weightedScore: normalizedScore * (criterion.weight / 100),
    justification: `Ошибка оценки: ${reason}`,
    recommendations: 'Проверьте вручную',
    strengths: [],
    weaknesses: []
  }
}

type StepVariant = 'planner' | 'criterion' | 'plagiarism' | 'summarizer'

// ── Cycling text ──────────────────────────────────────────────────────────────

const PLANNER_STEPS = [
  'Анализирую структуру работы...',
  'Определяю тему и ключевые понятия...',
  'Оцениваю сложность критериев...',
  'Формирую план проверки...',
  'Распределяю задачи по экспертам...',
]

const SUMMARIZER_STEPS = [
  'Собираю оценки по критериям...',
  'Вычисляю взвешенные баллы...',
  'Рассчитываю итоговый результат...',
  'Определяю итоговую оценку...',
  'Формирую финальный отчёт...',
]

const ORCHESTRATOR_MESSAGES: Record<string, string[]> = {
  init:       ['Инициализация агентов...', 'Загрузка конфигурации...', 'Подготовка к анализу...'],
  planner:    ['Передаю документ планировщику...', 'Координирую первичный анализ...', 'Формирую стратегию оценки...'],
  experts:    ['Распределяю задачи по экспертам...', 'Управляю очередью агентов...', 'Маршрутизирую оценки критериев...'],
  plagiarism: ['Запускаю проверку оригинальности...', 'Маршрутизирую источники для анализа...', 'Обрабатываю результаты поиска...'],
  summarizer: ['Агрегирую оценки всех экспертов...', 'Применяю веса критериев...', 'Синтезирую итоговый отчёт...'],
  done:       ['Все агенты завершили работу', 'Результаты успешно синтезированы', 'Система готова к следующей задаче'],
}

function CyclingText({ steps, color = 'blue' }: { steps: string[]; color?: 'blue' | 'indigo' | 'violet' }) {
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setIdx((n) => (n + 1) % steps.length), 2400)
    return () => clearInterval(t)
  }, [steps.length])
  const cls = color === 'indigo' ? 'text-indigo-500' : color === 'violet' ? 'text-violet-500' : 'text-blue-500'
  return (
    <span key={idx} className={`step-cycle inline-block text-[11px] font-medium ${cls}`}>
      {steps[idx]}
    </span>
  )
}

// ── Planner SVG ───────────────────────────────────────────────────────────────

function PlannerSvg({ totalCriteria = 4, revealed = 0 }: { totalCriteria?: number; revealed?: number }) {
  const count = Math.min(Math.max(totalCriteria, 1), 6)
  const nodes = Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2
    return { cx: 40 + Math.cos(angle) * 22, cy: 30 + Math.sin(angle) * 20 }
  })

  return (
    <svg viewBox="0 0 80 60" width="96" height="72" aria-hidden="true">
      {nodes.map(({ cx, cy }, i) => (
        <line key={`l${i}`} x1={cx} y1={cy} x2="40" y2="30"
          stroke={i < revealed ? '#6366f1' : '#e2e8f0'}
          strokeWidth="1.5" strokeDasharray="4 3"
          className={i < revealed ? 'dash-flow' : ''}
          style={{ animationDelay: `${i * 0.2}s`, transition: 'stroke 0.3s' }}
        />
      ))}
      <circle cx="40" cy="30" r="10" fill="#3b82f6" />
      {revealed > 0 && <circle cx="40" cy="30" r="10" fill="none" stroke="#93c5fd" strokeWidth="3" className="svg-pulse" />}
      <text x="40" y="34" textAnchor="middle" fontSize="8" fill="white" fontWeight="bold">AI</text>
      {nodes.map(({ cx, cy }, i) => (
        <g key={i} style={{ opacity: i < revealed ? 1 : 0.15, transition: 'opacity 0.4s' }}>
          <circle cx={cx} cy={cy} r="6"
            fill={i < revealed ? '#e0e7ff' : '#f1f5f9'}
            stroke={i < revealed ? '#6366f1' : '#cbd5e1'}
            strokeWidth="1.5"
            className={i < revealed ? `node-blink-${(i % 4) + 1}` : ''}
          />
          <text x={cx} y={cy + 3} textAnchor="middle" fontSize="5" fill={i < revealed ? '#4f46e5' : '#94a3b8'} fontWeight="bold">
            С{i + 1}
          </text>
        </g>
      ))}
    </svg>
  )
}

// ── Summarizer SVG ────────────────────────────────────────────────────────────

function SummarizerSvg({ criteriaResults = [], revealed = 0 }: { criteriaResults?: CriterionResult[]; revealed?: number }) {
  const count = Math.max(1, Math.min(criteriaResults.length || 4, 6))
  const barW = Math.floor(52 / count) - 2
  const maxH = 40

  return (
    <svg viewBox="0 0 80 60" width="80" height="60" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => {
        const result = criteriaResults[i]
        const pct = result ? result.normalizedScore / 100 : 0.5
        const h = Math.max(3, Math.round(pct * maxH))
        const x = 6 + i * (barW + 2)
        const isLive = i < revealed
        const isCurrent = i === revealed - 1

        return (
          <g key={i}>
            <rect x={x} y={52 - maxH} width={barW} height={maxH} rx="2" fill="#f1f5f9" />
            <rect
              x={x} y={isLive ? 52 - h : 52}
              width={barW} height={isLive ? h : 0} rx="2"
              fill={isCurrent ? '#3b82f6' : isLive ? '#6366f1' : '#e2e8f0'}
              style={{ transition: 'height 0.6s ease-out, y 0.6s ease-out, fill 0.3s' }}
            />
            {isLive && result && (
              <text x={x + barW / 2} y={52 - h - 2} textAnchor="middle" fontSize="5"
                fill={isCurrent ? '#1d4ed8' : '#6366f1'} fontWeight="bold"
                className={isCurrent ? 'score-tick' : ''}
              >
                {result.score}
              </text>
            )}
          </g>
        )
      })}
      <text x="73" y="35" textAnchor="middle" fontSize="16" fill="#6366f1" fontWeight="bold" opacity="0.8">Σ</text>
      <line x1="4" y1="52" x2="78" y2="52" stroke="#cbd5e1" strokeWidth="1.5" />
    </svg>
  )
}

// ── Planner expanded card ─────────────────────────────────────────────────────

function PlannerCard({ step, criteriaNames }: { step: ExpertStep; criteriaNames: string[] }) {
  const [revealed, setRevealed] = useState(0)
  const isDone = step.status === 'completed'

  useEffect(() => {
    if (step.status === 'completed') {
      setRevealed(criteriaNames.length)
      return
    }
    if (step.status !== 'running') return
    setRevealed(0)
    const delay = Math.max(200, Math.floor(1800 / Math.max(criteriaNames.length, 1)))
    const interval = setInterval(() => {
      setRevealed((n) => (n >= criteriaNames.length ? n : n + 1))
    }, delay)
    return () => clearInterval(interval)
  }, [step.status, criteriaNames.length])

  const progress = criteriaNames.length > 0 ? (revealed / criteriaNames.length) * 100 : 0

  return (
    <div className={`rounded-xl border-2 overflow-hidden animate-slide-in ${isDone ? 'border-emerald-300 bg-emerald-50' : 'border-blue-300 bg-blue-50'}`}>
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <i className={`fa-solid fa-map text-sm ${isDone ? 'text-emerald-500' : 'text-blue-500'}`} />
        <p className="text-xs font-bold text-slate-800 flex-1">Планировщик</p>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${isDone ? 'text-emerald-600 bg-emerald-100' : 'text-blue-600 bg-blue-100'}`}>
          {revealed}/{criteriaNames.length} критериев
        </span>
        {isDone
          ? <i className="fa-solid fa-circle-check text-emerald-500 text-xs ml-1" />
          : <i className="fa-solid fa-circle-notch fa-spin text-blue-400 text-xs ml-1" />
        }
      </div>

      <div className={`border-t px-3 py-3 flex items-start gap-3 ${isDone ? 'border-emerald-200' : 'border-blue-200'}`}>
        <div className="shrink-0">
          <PlannerSvg totalCriteria={criteriaNames.length} revealed={revealed} />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-[10px] font-semibold uppercase tracking-wider mb-2.5 ${isDone ? 'text-emerald-600' : 'text-blue-600'}`}>
            {isDone ? 'План проверки готов' : 'Построение плана проверки'}
          </p>
          <div className="mb-3">
            {criteriaNames.slice(0, 6).map((name, i) => {
              const visibleCount = Math.min(criteriaNames.length, 6)
              const isLast = i === visibleCount - 1
              return (
                <div key={i} className="flex items-stretch gap-2.5"
                  style={{ opacity: i < revealed ? 1 : 0.18, transition: 'opacity 0.35s ease' }}>
                  {/* Chain column */}
                  <div className="flex flex-col items-center shrink-0 w-5">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-all duration-400 ${
                      i < revealed ? 'bg-emerald-500 shadow-emerald-200 shadow-sm' : 'bg-slate-200'
                    }`}>
                      {i < revealed
                        ? <i className="fa-solid fa-check text-white" style={{ fontSize: 7 }} />
                        : <span className="text-[8px] font-bold text-slate-400">{i + 1}</span>
                      }
                    </div>
                    {!isLast && (
                      <div className={`w-px flex-1 my-0.5 rounded-full transition-colors duration-500 ${
                        i < revealed - 1 ? 'bg-emerald-300' : 'bg-slate-200'
                      }`} style={{ minHeight: 8 }} />
                    )}
                  </div>
                  {/* Label */}
                  <div className={`flex-1 ${!isLast ? 'pb-2' : ''}`}>
                    <p className={`text-xs font-medium leading-tight transition-colors duration-300 ${
                      i < revealed ? 'text-slate-800' : 'text-slate-400'
                    }`}>{name}</p>
                  </div>
                </div>
              )
            })}
            {criteriaNames.length > 6 && (
              <p className="text-[10px] text-slate-400 pl-7 mt-1">+{criteriaNames.length - 6} критериев...</p>
            )}
          </div>
          {!isDone && <CyclingText steps={PLANNER_STEPS} color="blue" />}
          {isDone && <span className="text-[11px] text-emerald-600 font-medium">Все критерии распределены</span>}
        </div>
      </div>

      <div className="px-3 pb-3">
        <div className={`w-full rounded-full h-1.5 overflow-hidden ${isDone ? 'bg-emerald-100' : 'bg-blue-100'}`}>
          <div className={`h-1.5 rounded-full transition-all duration-500 ${isDone ? 'bg-emerald-500' : 'bg-blue-500'}`}
            style={{ width: `${progress}%` }} />
        </div>
        <div className={`flex justify-between text-[9px] mt-0.5 ${isDone ? 'text-emerald-400' : 'text-blue-400'}`}>
          <span>{isDone ? 'Готово' : 'Построение плана'}</span>
          <span>{Math.round(progress)}%</span>
        </div>
      </div>
    </div>
  )
}

// ── Summarizer expanded card ──────────────────────────────────────────────────

function SummarizerCard({ step, criteriaResults }: { step: ExpertStep; criteriaResults: CriterionResult[] }) {
  const [revealed, setRevealed] = useState(0)
  const isDone = step.status === 'completed'

  useEffect(() => {
    if (step.status === 'completed') {
      setRevealed(criteriaResults.length)
      return
    }
    if (step.status !== 'running') return
    setRevealed(0)
    const delay = Math.max(250, Math.floor(1800 / Math.max(criteriaResults.length, 1)))
    const interval = setInterval(() => {
      setRevealed((n) => (n >= criteriaResults.length ? n : n + 1))
    }, delay)
    return () => clearInterval(interval)
  }, [step.status, criteriaResults.length])

  const runningScore = Math.round(
    criteriaResults.slice(0, revealed).reduce((sum, r) => sum + r.weightedScore, 0)
  )
  const progress = criteriaResults.length > 0 ? (revealed / criteriaResults.length) * 100 : 0

  return (
    <div className={`rounded-xl border-2 overflow-hidden animate-slide-in ${isDone ? 'border-emerald-300 bg-emerald-50' : 'border-indigo-300 bg-indigo-50'}`}>
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <i className={`fa-solid fa-sigma text-sm ${isDone ? 'text-emerald-500' : 'text-indigo-500'}`} />
        <p className="text-xs font-bold text-slate-800 flex-1">Сумматор</p>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isDone ? 'text-emerald-600 bg-emerald-100' : 'text-indigo-600 bg-indigo-100'}`}>
          {isDone ? `${step.score ?? runningScore}/100 б.` : `${runningScore}/100 б.`}
        </span>
        {isDone
          ? <i className="fa-solid fa-circle-check text-emerald-500 text-xs ml-1" />
          : <i className="fa-solid fa-circle-notch fa-spin text-indigo-400 text-xs ml-1" />
        }
      </div>

      <div className={`border-t px-3 py-3 flex items-start gap-3 ${isDone ? 'border-emerald-200' : 'border-indigo-200'}`}>
        <div className="shrink-0">
          <SummarizerSvg criteriaResults={criteriaResults} revealed={revealed} />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-[10px] font-semibold uppercase tracking-wider mb-2 ${isDone ? 'text-emerald-600' : 'text-indigo-600'}`}>
            {isDone ? 'Итоговый балл подсчитан' : 'Суммирование баллов'}
          </p>
          <div className="space-y-1.5 mb-2.5">
            {criteriaResults.slice(0, 4).map((r, i) => (
              <div key={i} className="transition-all duration-400"
                style={{ opacity: i < revealed ? 1 : 0.2 }}>
                <div className="flex justify-between text-[9px] mb-0.5">
                  <span className="text-slate-600 truncate flex-1 mr-1">{r.criterionName}</span>
                  <span className={`font-bold shrink-0 ${isDone || i < revealed ? 'text-indigo-600' : 'text-slate-400'}`}>
                    {isDone || i < revealed ? `${r.score}/${r.maxScore}` : '?/?'}
                  </span>
                </div>
                <div className="w-full bg-indigo-100 rounded-full h-1 overflow-hidden">
                  <div className="h-1 rounded-full bg-indigo-400 transition-all duration-700"
                    style={{ width: isDone || i < revealed ? `${r.normalizedScore}%` : '0%' }} />
                </div>
              </div>
            ))}
            {criteriaResults.length > 4 && (
              <p className="text-[9px] text-slate-400">+{criteriaResults.length - 4} критериев...</p>
            )}
          </div>
          {!isDone && <CyclingText steps={SUMMARIZER_STEPS} color="indigo" />}
          {isDone && <span className="text-[11px] text-emerald-600 font-medium">Все баллы учтены</span>}
        </div>
      </div>

      <div className="px-3 pb-3">
        <div className={`w-full rounded-full h-1.5 overflow-hidden ${isDone ? 'bg-emerald-100' : 'bg-indigo-100'}`}>
          <div className={`h-1.5 rounded-full transition-all duration-500 ${isDone ? 'bg-emerald-500' : 'bg-indigo-500'}`}
            style={{ width: `${progress}%` }} />
        </div>
        <div className={`flex justify-between text-[9px] mt-0.5 ${isDone ? 'text-emerald-400' : 'text-indigo-400'}`}>
          <span>{isDone ? 'Готово' : 'Суммирование баллов'}</span>
          <span>{Math.round(progress)}%</span>
        </div>
      </div>
    </div>
  )
}

// ── Criteria Card SVG ─────────────────────────────────────────────────────────

function CriteriaCardSvg({ steps }: { steps: ExpertStep[] }) {
  const visible = steps.slice(0, 5)
  const count = visible.length
  const hubX = 20, hubY = 40
  const nodeX = 70
  const getNodeY = (i: number) => count === 1 ? 40 : 10 + i * (60 / Math.max(count - 1, 1))

  return (
    <svg viewBox="0 0 88 80" width="88" height="80" aria-hidden="true">
      {/* Hub → node lines */}
      {visible.map((step, i) => {
        const ny = getNodeY(i)
        const done = step.status === 'completed'
        const active = step.status === 'running' || step.status === 'loading'
        const color = done ? '#10b981' : active ? '#3b82f6' : '#e2e8f0'
        return (
          <line key={i} x1={hubX + 12} y1={hubY} x2={nodeX - 8} y2={ny}
            stroke={color} strokeWidth="1.5" strokeDasharray="4 2"
            className={done || active ? 'dash-flow' : undefined}
            style={{ animationDelay: `${i * 0.18}s`, transition: 'stroke 0.4s' }}
          />
        )
      })}

      {/* Data packets on active connections */}
      {visible.map((step, i) => {
        if (step.status !== 'running') return null
        const ny = getNodeY(i)
        return (
          <circle key={`p${i}`} r="2" fill="#3b82f6" opacity="0.9">
            <animateMotion dur="0.85s" repeatCount="indefinite" path={`M${hubX + 12},${hubY} L${nodeX - 8},${ny}`} />
          </circle>
        )
      })}

      {/* Central EXP hub */}
      <circle cx={hubX} cy={hubY} r="12" fill="#3b82f6" />
      {steps.some(s => s.status === 'running') && (
        <circle cx={hubX} cy={hubY} r="12" fill="none" stroke="#93c5fd" strokeWidth="2.5" className="svg-pulse" />
      )}
      {steps.every(s => s.status === 'completed') && (
        <circle cx={hubX} cy={hubY} r="12" fill="none" stroke="#6ee7b7" strokeWidth="2" />
      )}
      <text x={hubX} y={hubY - 2} textAnchor="middle" fontSize="5.5" fill="white" fontWeight="bold">EXP</text>
      <text x={hubX} y={hubY + 6} textAnchor="middle" fontSize="7" fill="#dbeafe" fontWeight="bold">AI</text>

      {/* Criterion nodes */}
      {visible.map((step, i) => {
        const ny = getNodeY(i)
        const running = step.status === 'running'
        const loading = step.status === 'loading'
        const done = step.status === 'completed'
        return (
          <g key={i}>
            <circle cx={nodeX} cy={ny} r="8"
              fill={done ? '#d1fae5' : running ? '#dbeafe' : loading ? '#fef3c7' : '#f8fafc'}
              stroke={done ? '#059669' : running ? '#2563eb' : loading ? '#d97706' : '#cbd5e1'}
              strokeWidth="1.5"
              className={running ? `node-blink-${(i % 4) + 1}` : undefined}
              style={{ transition: 'fill 0.3s, stroke 0.3s' }}
            />
            {done
              ? <text x={nodeX} y={ny + 2.5} textAnchor="middle" fontSize="7" fill="#059669">✓</text>
              : <text x={nodeX} y={ny + 2.5} textAnchor="middle" fontSize="5.5" fill={running ? '#1d4ed8' : '#94a3b8'} fontWeight="bold">{i + 1}</text>
            }
            {running && <circle cx={nodeX} cy={ny} r="8" fill="none" stroke="#93c5fd" strokeWidth="2" className="svg-pulse" />}
          </g>
        )
      })}
      {steps.length > 5 && (
        <text x={nodeX} y={getNodeY(4) + 16} textAnchor="middle" fontSize="8" fill="#94a3b8" fontWeight="bold">+{steps.length - 5}</text>
      )}
    </svg>
  )
}

// ── Criteria Card ─────────────────────────────────────────────────────────────

function CriteriaCard({ steps }: { steps: ExpertStep[] }) {
  const [genProgress, setGenProgress] = useState<Record<string, number>>({})

  const runningId = steps.find(s => s.status === 'running')?.id

  useEffect(() => {
    if (!runningId) return
    setGenProgress(p => (p[runningId] !== undefined ? p : { ...p, [runningId]: 0 }))
    const interval = setInterval(() => {
      setGenProgress(p => ({ ...p, [runningId]: Math.min((p[runningId] ?? 0) + Math.random() * 3.5 + 1, 92) }))
    }, 550)
    return () => clearInterval(interval)
  }, [runningId])

  useEffect(() => {
    const updates: Record<string, number> = {}
    steps.filter(s => s.status === 'completed').forEach(s => { updates[s.id] = 100 })
    if (Object.keys(updates).length > 0) setGenProgress(p => ({ ...p, ...updates }))
  }, [steps.filter(s => s.status === 'completed').length]) // eslint-disable-line react-hooks/exhaustive-deps

  const completed = steps.filter(s => s.status === 'completed').length
  const total = steps.length
  const isDone = completed === total && total > 0
  const activeStep = steps.find(s => s.status === 'running' || s.status === 'loading')
  const overallProgress = total > 0 ? (completed / total) * 100 : 0

  return (
    <div className={`rounded-xl border-2 overflow-hidden animate-slide-in ${isDone ? 'border-emerald-300 bg-emerald-50' : 'border-blue-300 bg-blue-50'}`}>
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <i className={`fa-solid fa-users text-sm ${isDone ? 'text-emerald-500' : 'text-blue-500'}`} />
        <p className="text-xs font-bold text-slate-800 flex-1">Эксперты</p>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${isDone ? 'text-emerald-600 bg-emerald-100' : 'text-blue-600 bg-blue-100'}`}>
          {completed}/{total} критериев
        </span>
        {isDone
          ? <i className="fa-solid fa-circle-check text-emerald-500 text-xs ml-1" />
          : <i className="fa-solid fa-circle-notch fa-spin text-blue-400 text-xs ml-1" />
        }
      </div>

      {/* Body */}
      <div className={`border-t px-3 py-3 flex items-start gap-3 ${isDone ? 'border-emerald-200' : 'border-blue-200'}`}>
        <div className="shrink-0">
          <CriteriaCardSvg steps={steps} />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-[10px] font-semibold uppercase tracking-wider mb-2.5 ${isDone ? 'text-emerald-600' : 'text-blue-600'}`}>
            {isDone ? 'Все критерии оценены' : activeStep ? `Оценка: ${activeStep.name}` : 'Подготовка экспертов...'}
          </p>
          <div className="space-y-1.5">
            {steps.map((step, i) => {
              const prog = genProgress[step.id] ?? 0
              const isRunning = step.status === 'running'
              const isLoading = step.status === 'loading'
              const isDoneStep = step.status === 'completed'
              const isPending = step.status === 'pending'
              const isError = step.status === 'error'

              return (
                <div key={step.id}
                  className={`rounded-lg border transition-all duration-300 px-2.5 py-1.5 ${
                    isRunning ? 'border-blue-300 bg-white shadow-sm shadow-blue-100' :
                    isLoading ? 'border-amber-200 bg-amber-50/70' :
                    isDoneStep ? 'border-emerald-200 bg-white/70' :
                    isError ? 'border-red-200 bg-red-50/70' :
                    'border-slate-200 bg-white/30'
                  }`}
                  style={{ opacity: isPending ? 0.4 : 1 }}
                >
                  <div className="flex items-center gap-2">
                    <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 transition-all duration-300 ${
                      isDoneStep ? 'bg-emerald-500' : isRunning ? 'bg-blue-500' :
                      isLoading ? 'bg-amber-400' : isError ? 'bg-red-400' : 'bg-slate-200'
                    }`}>
                      {isDoneStep ? <i className="fa-solid fa-check text-white" style={{ fontSize: 6 }} />
                        : isRunning || isLoading ? <i className="fa-solid fa-circle-notch fa-spin text-white" style={{ fontSize: 6 }} />
                        : isError ? <i className="fa-solid fa-xmark text-white" style={{ fontSize: 6 }} />
                        : <span className="text-[7px] font-bold text-slate-400">{i + 1}</span>
                      }
                    </div>
                    <p className={`text-xs font-medium flex-1 truncate ${
                      isRunning ? 'text-blue-700' : isDoneStep ? 'text-slate-700' :
                      isLoading ? 'text-amber-700' : 'text-slate-400'
                    }`}>{step.name}</p>
                    {isDoneStep && step.score !== undefined && step.maxScore && (
                      <span className="text-[10px] font-bold text-emerald-600 shrink-0">{step.score}/{step.maxScore}</span>
                    )}
                    {isRunning && (
                      <span className="text-[9px] font-bold text-blue-500 shrink-0">{Math.round(prog)}%</span>
                    )}
                    {isLoading && (
                      <span className="text-[9px] text-amber-600 shrink-0">загрузка</span>
                    )}
                  </div>
                  {(isRunning || isLoading || isDoneStep) && (
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <div className="flex-1 bg-white/60 rounded-full h-1.5 overflow-hidden">
                        {isDoneStep ? (
                          <div className="h-1.5 rounded-full bg-emerald-400 w-full transition-all duration-700" />
                        ) : isLoading ? (
                          <div className="h-1.5 rounded-full w-2/5" style={{ background: 'linear-gradient(90deg, transparent, #f59e0b, transparent)', animation: 'progressSlide 1.4s ease-in-out infinite' }} />
                        ) : (
                          <div className="h-1.5 rounded-full transition-all duration-300" style={{ width: `${prog}%`, background: 'linear-gradient(90deg, #3b82f6, #6366f1)' }} />
                        )}
                      </div>
                      {step.modelName && !isDoneStep && (
                        <span className="text-[8px] text-slate-400 shrink-0 max-w-[72px] truncate">{step.modelName}</span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-3 pb-3">
        <div className={`w-full rounded-full h-1.5 overflow-hidden ${isDone ? 'bg-emerald-100' : 'bg-blue-100'}`}>
          <div className={`h-1.5 rounded-full transition-all duration-500 ${isDone ? 'bg-emerald-500' : 'bg-blue-500'}`}
            style={{ width: `${overallProgress}%` }} />
        </div>
        <div className={`flex justify-between text-[9px] mt-0.5 ${isDone ? 'text-emerald-400' : 'text-blue-400'}`}>
          <span>{isDone ? 'Готово' : activeStep ? `Оцениваю: ${activeStep.name}` : 'Экспертная оценка'}</span>
          <span>{Math.round(overallProgress)}%</span>
        </div>
      </div>
    </div>
  )
}

// ── Orchestrator SVG ──────────────────────────────────────────────────────────

function OrchestratorSvg({ phase }: { phase: string }) {
  const active = {
    doc:  true,
    plan: ['planner', 'experts', 'plagiarism', 'summarizer', 'done'].includes(phase),
    exp:  ['experts', 'plagiarism', 'summarizer', 'done'].includes(phase),
    plag: ['plagiarism', 'summarizer', 'done'].includes(phase),
    sum:  ['summarizer', 'done'].includes(phase),
  }
  const lc = (on: boolean, c: string) => ({ stroke: on ? c : '#e2e8f0', strokeWidth: 1.5 as const, strokeDasharray: '4 2' as const, className: on ? 'dash-flow' : undefined })
  const isDone = phase === 'done'

  return (
    <svg viewBox="0 0 155 74" width="148" height="72" aria-hidden="true">
      {/* Lines */}
      <line x1="20" y1="37" x2="55" y2="37" {...lc(active.doc, '#8b5cf6')} />
      <line x1="76" y1="28" x2="108" y2="13" {...lc(active.plan, '#6366f1')} />
      <line x1="79" y1="33" x2="116" y2="28" {...lc(active.exp, '#3b82f6')} />
      <line x1="79" y1="41" x2="116" y2="47" {...lc(active.plag, '#10b981')} />
      <line x1="76" y1="46" x2="108" y2="61" {...lc(active.sum, '#6366f1')} />

      {/* Animated data packets */}
      {active.doc  && <circle r="2.5" fill="#8b5cf6"><animateMotion dur="1.0s" repeatCount="indefinite" path="M20,37 L55,37" /></circle>}
      {active.plan && <circle r="2"   fill="#6366f1" opacity="0.9"><animateMotion dur="1.2s" repeatCount="indefinite" begin="0.2s" path="M76,28 L108,13" /></circle>}
      {active.exp  && <circle r="2"   fill="#3b82f6" opacity="0.9"><animateMotion dur="0.9s" repeatCount="indefinite" begin="0.1s" path="M79,33 L116,28" /></circle>}
      {active.plag && <circle r="2"   fill="#10b981" opacity="0.9"><animateMotion dur="1.1s" repeatCount="indefinite" begin="0.3s" path="M79,41 L116,47" /></circle>}
      {active.sum  && <circle r="2"   fill="#8b5cf6" opacity="0.9"><animateMotion dur="1.3s" repeatCount="indefinite" begin="0.4s" path="M76,46 L108,61" /></circle>}

      {/* ORCH central node */}
      <circle cx="67" cy="37" r="12" fill="#7c3aed" />
      {!isDone && <circle cx="67" cy="37" r="12" fill="none" stroke="#c4b5fd" strokeWidth="2.5" className="svg-pulse" />}
      <text x="67" y="34" textAnchor="middle" fontSize="5.5" fill="white" fontWeight="bold">ORCH</text>
      <text x="67" y="42" textAnchor="middle" fontSize="7" fill="#ddd6fe" fontWeight="bold">AI</text>

      {/* DOC node */}
      <rect x="3" y="29" width="16" height="15" rx="2.5" fill={active.doc ? '#ede9fe' : '#f8fafc'} stroke={active.doc ? '#8b5cf6' : '#cbd5e1'} strokeWidth="1.5" />
      <text x="11" y="38.5" textAnchor="middle" fontSize="4.5" fill={active.doc ? '#6d28d9' : '#94a3b8'} fontWeight="bold">DOC</text>

      {/* PLANNER node */}
      <circle cx="117" cy="12" r="9" fill={active.plan ? '#e0e7ff' : '#f8fafc'} stroke={active.plan ? '#4f46e5' : '#cbd5e1'} strokeWidth="1.5" className={phase === 'planner' ? 'node-blink-1' : ''} />
      <text x="117" y="15.5" textAnchor="middle" fontSize="4.5" fill={active.plan ? '#3730a3' : '#94a3b8'} fontWeight="bold">Пл.</text>

      {/* EXPERTS node */}
      <circle cx="125" cy="30" r="9" fill={active.exp ? '#dbeafe' : '#f8fafc'} stroke={active.exp ? '#2563eb' : '#cbd5e1'} strokeWidth="1.5" className={phase === 'experts' ? 'node-blink-2' : ''} />
      <text x="125" y="33.5" textAnchor="middle" fontSize="4.5" fill={active.exp ? '#1e40af' : '#94a3b8'} fontWeight="bold">Эк.</text>

      {/* PLAGIARISM node */}
      <circle cx="125" cy="47" r="9" fill={active.plag ? '#d1fae5' : '#f8fafc'} stroke={active.plag ? '#059669' : '#cbd5e1'} strokeWidth="1.5" className={phase === 'plagiarism' ? 'node-blink-3' : ''} />
      <text x="125" y="50.5" textAnchor="middle" fontSize="4.5" fill={active.plag ? '#065f46' : '#94a3b8'} fontWeight="bold">Ант</text>

      {/* SUMMARIZER node */}
      <circle cx="117" cy="61" r="9" fill={active.sum ? '#ede9fe' : '#f8fafc'} stroke={active.sum ? '#7c3aed' : '#cbd5e1'} strokeWidth="1.5" className={phase === 'summarizer' ? 'node-blink-4' : ''} />
      <text x="117" y="65" textAnchor="middle" fontSize="8.5" fill={active.sum ? '#5b21b6' : '#94a3b8'} fontWeight="bold">&#x3a3;</text>
    </svg>
  )
}

// ── Orchestrator Card ──────────────────────────────────────────────────────────

function OrchestratorCard({ expertSteps, progress }: { expertSteps: ExpertStep[]; progress: number }) {
  const plannerStep   = expertSteps.find(s => s.id === 'planner')
  const summarizerStep = expertSteps.find(s => s.id === 'summarizer')
  const plagiarismStep = expertSteps.find(s => s.id === 'plagiarism')
  const expertList    = expertSteps.filter(s => s.id.startsWith('expert-'))

  const isRunningExperts = expertList.some(s => s.status === 'running' || s.status === 'loading')
  const completedExperts = expertList.filter(s => s.status === 'completed').length
  const totalExperts     = expertList.length
  const allDone          = summarizerStep?.status === 'completed'

  let phase: string
  if (allDone)                             phase = 'done'
  else if (summarizerStep?.status === 'running') phase = 'summarizer'
  else if (plagiarismStep?.status === 'running') phase = 'plagiarism'
  else if (isRunningExperts)               phase = 'experts'
  else if (plannerStep?.status === 'running') phase = 'planner'
  else                                     phase = 'init'

  const isDone = phase === 'done'
  const msgs   = ORCHESTRATOR_MESSAGES[phase] ?? ORCHESTRATOR_MESSAGES.init

  const PHASE_LABEL: Record<string, string> = {
    init: 'Инициализация', planner: 'Планирование', experts: 'Экспертная оценка',
    plagiarism: 'Антиплагиат', summarizer: 'Суммирование', done: 'Завершено',
  }

  type AgentRow = { label: string; status: ExpertStep['status']; icon: string }
  const agentRows: AgentRow[] = []
  if (plannerStep && plannerStep.status !== 'pending')
    agentRows.push({ label: 'Планировщик', status: plannerStep.status, icon: 'fa-map' })
  if (totalExperts > 0 && (isRunningExperts || completedExperts > 0)) {
    const activeExp = expertList.find(s => s.status === 'running' || s.status === 'loading')
    const label = activeExp?.name
      ? `Эксперты ${completedExperts}/${totalExperts} · ${activeExp.name}`
      : `Эксперты ${completedExperts}/${totalExperts}`
    agentRows.push({ label, status: isRunningExperts ? 'running' : completedExperts === totalExperts ? 'completed' : 'pending', icon: 'fa-users' })
  }
  if (plagiarismStep && plagiarismStep.status !== 'pending')
    agentRows.push({ label: 'Антиплагиат', status: plagiarismStep.status, icon: 'fa-shield-halved' })
  if (summarizerStep && summarizerStep.status !== 'pending')
    agentRows.push({ label: 'Сумматор', status: summarizerStep.status, icon: 'fa-sigma' })

  const statusColor = (st: ExpertStep['status']) =>
    st === 'completed' ? 'text-emerald-500' : st === 'running' ? 'text-violet-500' : st === 'loading' ? 'text-amber-500' : 'text-slate-300'
  const statusLabel = (st: ExpertStep['status']) =>
    st === 'completed' ? 'готово' : st === 'running' ? 'работает' : st === 'loading' ? 'загрузка' : ''

  return (
    <div className={`rounded-xl border-2 overflow-hidden animate-slide-in ${isDone ? 'border-violet-300 bg-violet-50' : 'border-violet-400 bg-violet-50'}`}>
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <i className={`fa-solid fa-network-wired text-sm ${isDone ? 'text-violet-500' : 'text-violet-600'}`} />
        <p className="text-xs font-bold text-slate-800 flex-1">Оркестратор</p>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full text-violet-700 bg-violet-100">
          {PHASE_LABEL[phase]}
        </span>
        {isDone
          ? <i className="fa-solid fa-circle-check text-violet-500 text-xs ml-1" />
          : <i className="fa-solid fa-circle-notch fa-spin text-violet-500 text-xs ml-1" />
        }
      </div>

      <div className="border-t border-violet-200 px-3 py-3 flex items-start gap-3">
        <div className="shrink-0">
          <OrchestratorSvg phase={phase} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider mb-2 text-violet-700">
            {isDone ? 'Мульти-агентная система завершила работу' : 'Координация мульти-агентной системы'}
          </p>
          <div className="space-y-1 mb-2.5">
            {agentRows.map(({ label, status, icon }) => (
              <div key={label} className="flex items-center gap-1.5">
                <i className={`fa-solid ${icon} text-[9px] w-3 text-center shrink-0 ${statusColor(status)}`} />
                <span className="text-[10px] text-slate-600 flex-1 truncate">{label}</span>
                <span className={`text-[9px] font-medium shrink-0 ${statusColor(status)}`}>{statusLabel(status)}</span>
              </div>
            ))}
          </div>
          {!isDone
            ? <CyclingText steps={msgs} color="violet" />
            : <span className="text-[11px] text-violet-600 font-medium">Все задачи выполнены · Отчёт готов</span>
          }
        </div>
      </div>

      <div className="px-3 pb-2.5">
        <div className="w-full bg-violet-100 rounded-full h-1.5 overflow-hidden">
          <div className={`h-1.5 rounded-full transition-all duration-500 ${isDone ? 'bg-violet-400' : 'progress-gradient'}`}
            style={{ width: `${progress}%` }} />
        </div>
        <div className="flex justify-between text-[9px] mt-0.5 text-violet-400">
          <span>{isDone ? 'Выполнено' : 'Общий прогресс системы'}</span>
          <span>{Math.round(progress)}%</span>
        </div>
      </div>
    </div>
  )
}

// ── ExpertStepRow ─────────────────────────────────────────────────────────────

function ExpertStepRow({
  step,
  variant = 'criterion',
  criteriaNames,
  criteriaResults,
}: {
  step: ExpertStep
  variant?: StepVariant
  criteriaNames?: string[]
  criteriaResults?: CriterionResult[]
}) {
  const [genProgress, setGenProgress] = useState(0)

  useEffect(() => {
    if (variant !== 'criterion') return
    if (step.status === 'completed') { setGenProgress(100); return }
    if (step.status !== 'running') { setGenProgress(0); return }
    setGenProgress(0)
    const interval = setInterval(() => {
      setGenProgress((p) => (p >= 92 ? p : p + Math.random() * 3.5 + 1))
    }, 550)
    return () => clearInterval(interval)
  }, [step.status, variant])

  // Expanded cards for planner/summarizer while running or after completion
  if ((step.status === 'running' || step.status === 'completed') && variant === 'planner') {
    return <PlannerCard step={step} criteriaNames={criteriaNames ?? []} />
  }
  if ((step.status === 'running' || step.status === 'completed') && variant === 'summarizer') {
    return <SummarizerCard step={step} criteriaResults={criteriaResults ?? []} />
  }

  const statusConfig = {
    pending:   { icon: 'fa-clock',                cls: 'text-slate-400', bg: 'bg-slate-50',   border: 'border-slate-200',  text: 'Ожидание' },
    loading:   { icon: 'fa-circle-notch fa-spin', cls: 'text-amber-500', bg: 'bg-amber-50',   border: 'border-amber-200',  text: 'Загрузка...' },
    running:   { icon: 'fa-circle-notch fa-spin', cls: 'text-blue-500',  bg: 'bg-blue-50',    border: 'border-blue-300',   text: 'Работает...' },
    completed: {
      icon: 'fa-circle-check', cls: 'text-emerald-500', bg: 'bg-emerald-50', border: 'border-emerald-200',
      text: step.score !== undefined ? `${step.score}/${step.maxScore ?? 100} б.` : 'Готово'
    },
    error: { icon: 'fa-circle-exclamation', cls: 'text-red-500', bg: 'bg-red-50', border: 'border-red-200', text: 'Ошибка' }
  }

  const s = statusConfig[step.status]
  const isSpecial = variant !== 'criterion'
  const specialIcons: Record<StepVariant, string> = { planner: 'fa-map', criterion: '', plagiarism: 'fa-shield-halved', summarizer: 'fa-sigma' }
  const iconClass = isSpecial ? specialIcons[variant] : s.icon

  const progressPct = step.status === 'completed' && step.score !== undefined && step.maxScore
    ? Math.min(100, Math.round((step.score / step.maxScore) * 100))
    : step.status === 'completed' ? 100 : 0

  return (
    <div className={`rounded-lg border transition-all overflow-hidden ${s.bg} ${s.border} ${isSpecial ? 'border-dashed' : ''}`}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <i className={`fa-solid ${iconClass || s.icon} ${s.cls} text-sm w-4 text-center shrink-0`} />
        <div className="flex-1 min-w-0">
          <p className={`text-xs truncate ${isSpecial ? 'font-bold text-slate-800' : 'font-medium text-slate-700'}`}>
            {step.name}
          </p>
          {step.modelName && <p className="text-[10px] text-slate-400 truncate">{step.modelName}</p>}
        </div>
        <span className={`text-[10px] font-semibold ${s.cls} shrink-0`}>{s.text}</span>
      </div>

      {/* Per-step progress bar */}
      {step.status !== 'pending' && (
        <div className="px-3 pb-2">
          {variant === 'criterion' ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-white/60 rounded-full h-1.5 overflow-hidden">
                {step.status === 'completed' ? (
                  <div className="h-1.5 rounded-full bg-emerald-400 transition-all duration-700 w-full" />
                ) : step.status === 'running' ? (
                  <div className="h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${genProgress}%`, background: 'linear-gradient(90deg, #3b82f6, #6366f1)' }} />
                ) : step.status === 'loading' ? (
                  <div className="h-1.5 rounded-full w-2/5"
                    style={{ background: 'linear-gradient(90deg, transparent, #f59e0b, transparent)', animation: 'progressSlide 1.4s ease-in-out infinite' }} />
                ) : step.status === 'error' ? (
                  <div className="h-1.5 rounded-full bg-red-400 w-full" />
                ) : null}
              </div>
              {step.status === 'running' && (
                <span className="text-[9px] text-blue-500 font-semibold shrink-0 w-7 text-right">{Math.round(genProgress)}%</span>
              )}
              {step.status === 'completed' && step.score !== undefined && step.maxScore && (
                <span className="text-[9px] text-emerald-500 font-semibold shrink-0">{step.score}/{step.maxScore}</span>
              )}
            </div>
          ) : (
            <div className="w-full bg-white/60 rounded-full h-1 overflow-hidden">
              {(step.status === 'running' || step.status === 'loading') ? (
                <div className="h-1 rounded-full w-2/5"
                  style={{
                    background: step.status === 'loading'
                      ? 'linear-gradient(90deg, transparent, #f59e0b, transparent)'
                      : 'linear-gradient(90deg, transparent, #3b82f6, transparent)',
                    animation: 'progressSlide 1.4s ease-in-out infinite'
                  }}
                />
              ) : step.status === 'completed' ? (
                <div className="h-1 rounded-full bg-emerald-400 transition-all duration-700"
                  style={{ width: `${progressPct}%` }} />
              ) : step.status === 'error' ? (
                <div className="h-1 rounded-full bg-red-400 w-full" />
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
