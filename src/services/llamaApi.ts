import type { Model, PlanItem, CriterionResult, RubricCriterion, Rubric } from '../types'

export interface LlamaApiConfig {
  url: string
  temperature: number
  maxTokens: number
  modelId: string
  sources?: Array<{ name: string; content: string }>
  onLog: (message: string, type?: 'info' | 'success' | 'error' | 'warning') => void
  onRequestLog?: (entry: { criterion: string; prompt: string; response: string; durationMs: number; status: 'ok' | 'error' | 'timeout' }) => void
}

export async function fetchModels(baseUrl: string): Promise<Model[]> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(`${baseUrl}/v1/models`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return data.data || []
  } catch (e) {
    clearTimeout(timeoutId)
    throw e
  }
}

interface CallOptions {
  maxTokens?: number
  temperature?: number
  stop?: string[]
  /** If set, injected as partial assistant message to steer output format */
  assistantPrefix?: string
}

async function callLLM(
  config: LlamaApiConfig,
  prompt: string,
  opts: CallOptions = {}
): Promise<{ text: string; durationMs: number }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 300000)
  const startTime = Date.now()

  const messages: Array<{ role: string; content: string }> = [
    { role: 'user', content: prompt }
  ]
  // Prefix-anchor: forces the model to continue from a specific token sequence
  if (opts.assistantPrefix) {
    messages.push({ role: 'assistant', content: opts.assistantPrefix })
  }

  try {
    const res = await fetch(`${config.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        model: config.modelId,
        messages,
        temperature: opts.temperature ?? config.temperature,
        max_tokens: opts.maxTokens ?? config.maxTokens,
        ...(opts.stop ? { stop: opts.stop } : {})
      }),
      signal: controller.signal
    })

    clearTimeout(timeoutId)
    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`HTTP ${res.status}: ${errText}`)
    }

    const data = await res.json()
    const content = data.choices[0].message.content as string
    // If we used a prefix, prepend it back so the parser sees the full text
    const text = opts.assistantPrefix ? opts.assistantPrefix + content : content
    return { text, durationMs: Date.now() - startTime }
  } catch (e) {
    clearTimeout(timeoutId)
    throw e
  }
}

function extractJSON(text: string): unknown {
  // Try direct parse first
  try {
    return JSON.parse(text)
  } catch {}

  // Try to extract from code blocks
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlock) {
    try {
      return JSON.parse(codeBlock[1].trim())
    } catch {}
  }

  // Try array or object patterns
  for (const pattern of [/(\[[\s\S]*\])/, /(\{[\s\S]*\})/]) {
    const match = text.match(pattern)
    if (match) {
      try {
        return JSON.parse(match[1])
      } catch {}
    }
  }

  throw new Error('JSON не найден в ответе модели')
}

export async function runPlanner(
  config: LlamaApiConfig,
  rubric: Rubric,
  contentPreview: string
): Promise<PlanItem[]> {
  const prompt = `Ты - Планировщик академической проверки. Проанализируй начало текста работы и рубрику, создай детальные промты для оценки каждого критерия.

РУБРИКА:
${rubric.criteria.map((c) => `- ${c.name} (макс ${c.maxScore} балл., вес ${c.weight}%): ${c.description}`).join('\n')}

ТЕКСТ РАБОТЫ (начало, первые 3000 символов):
${contentPreview.substring(0, 3000)}

ЗАДАЧА: Создай JSON массив с детальным промтом для каждого критерия рубрики.

ФОРМАТ ОТВЕТА (строго JSON массив):
[
  {
    "criterion": "Название критерия точно как в рубрике",
    "prompt": "Детальный промт для эксперта: что проверять, на что обращать внимание, какие ошибки искать",
    "maxScore": число
  }
]`

  const { text: response } = await callLLM(config, prompt, { maxTokens: 2000 })

  try {
    const plan = extractJSON(response)
    if (Array.isArray(plan) && plan.length > 0) {
      return plan as PlanItem[]
    }
    throw new Error('Некорректная структура плана')
  } catch {
    config.onLog('Планировщик вернул некорректный JSON, используем стандартные промты', 'warning')
    return rubric.criteria.map((c) => ({
      criterion: c.name,
      prompt: `Оцени критерий "${c.name}" (${c.description}). Проверь работу и выстави оценку от 0 до ${c.maxScore}.`,
      maxScore: c.maxScore
    }))
  }
}

// ── Evaluation prompt ─────────────────────────────────────────────────────────
// Uses marker-based output instead of JSON — far more reliable on 1B Q-models.
// The assistant prefix "Балл: " anchors the response to start with the score
// immediately, preventing preamble text and steering the format.

export async function evaluateCriterion(
  config: LlamaApiConfig,
  criterion: RubricCriterion,
  _planItem: PlanItem | null,
  fileContent: string
): Promise<CriterionResult> {
  // Use less text for small models — quality > quantity
  const preview = fileContent.substring(0, 1800)

  const sourcesBlock = config.sources && config.sources.length > 0
    ? '\nСправочный материал:\n' +
      config.sources.map((s) => `• ${s.name}: ${s.content.substring(0, 400)}`).join('\n') + '\n'
    : ''

  // Marker-based prompt — no JSON syntax, just fill-in-the-blank
  const prompt = `Ты проверяешь студенческую работу по одному критерию.

Критерий: ${criterion.name}
Что проверяем: ${criterion.description}
Максимум баллов: ${criterion.maxScore}
${sourcesBlock}
Текст работы студента:
${preview}

Напиши оценку строго в таком формате (без лишних слов):
Балл: [число от 0 до ${criterion.maxScore}]
Обоснование: [конкретно о данной работе — что выполнено хорошо и что плохо]
Улучшить: [2-3 пронумерованных шага: 1) что именно добавить/переработать; 2) что изучить/исправить. Если выше есть справочный материал — сошлись на него]`

  // "Балл: " as assistant prefix forces model to output score first
  const ANCHOR = 'Балл: '

  let result: { text: string; durationMs: number }
  let status: 'ok' | 'error' | 'timeout' = 'ok'

  try {
    result = await callLLM(config, prompt, {
      maxTokens: 350,
      temperature: 0.15,           // low temperature → consistent, factual output
      assistantPrefix: ANCHOR,
      stop: ['\n\nКритерий', '\n\nТекст', '\n\nНапиши', '---', 'Задача:']
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    status = msg.includes('abort') ? 'timeout' : 'error'
    config.onRequestLog?.({ criterion: criterion.name, prompt, response: `ОШИБКА: ${msg}`, durationMs: 0, status })
    throw e
  }

  config.onRequestLog?.({ criterion: criterion.name, prompt, response: result.text, durationMs: result.durationMs, status })
  return parseModelResponse(result.text, criterion)
}

// ── Response parser ───────────────────────────────────────────────────────────
// Three-pass strategy:
//   Pass 1 — marker format  "Балл: N\nОбоснование: ...\nУлучшить: ..."
//   Pass 2 — JSON extraction (model may still output JSON)
//   Pass 3 — raw text heuristics (last resort)

function parseModelResponse(raw: string, criterion: RubricCriterion): CriterionResult {
  const clamp = (n: number) => Math.max(0, Math.min(criterion.maxScore, isNaN(n) ? criterion.maxScore * 0.5 : n))

  const build = (score: number, justification: string, recommendations: string): CriterionResult => {
    const s = clamp(score)
    const n = (s / criterion.maxScore) * 100
    return {
      criterionName: criterion.name,
      weight: criterion.weight,
      score: s,
      maxScore: criterion.maxScore,
      normalizedScore: Math.round(n * 10) / 10,
      weightedScore: Math.round(n * (criterion.weight / 100) * 10) / 10,
      justification: (justification || '').trim() || genJustification(s, criterion),
      recommendations: (recommendations || '').trim() || genRecommendation(s, criterion),
      strengths: [],
      weaknesses: []
    }
  }

  // ── Pass 1: marker format ─────────────────────────────────────────────────
  // Matches lines like:
  //   Балл: 7   /   Балл — 7   /   балл: 7/10
  //   Обоснование: текст...
  //   Улучшить: / Рекомендации: / Что улучшить: текст...
  const scoreRx   = /(?:^|\n)\s*[Бб]алл\s*[:\-–—]\s*(\d+(?:\.\d+)?)/
  const justRx    = /(?:^|\n)\s*[Оо]боснование\s*[:\-–—]\s*([\s\S]+?)(?=\n\s*(?:[УуРрЧч]|$))/
  const recRx     = /(?:^|\n)\s*(?:[Уу]лучшить|[Рр]екоменд\w*|[Чч]то\s+улучшить)\s*[:\-–—]\s*([\s\S]+)/

  const scoreM = raw.match(scoreRx)
  const justM  = raw.match(justRx)
  const recM   = raw.match(recRx)

  if (scoreM) {
    const score = parseFloat(scoreM[1])
    const just  = justM ? justM[1].replace(/\n/g, ' ').trim() : ''
    const rec   = recM  ? recM[1].replace(/\n/g, ' ').trim() : ''
    return build(score, just, rec)
  }

  // ── Pass 2: JSON extraction ───────────────────────────────────────────────
  try {
    const data = extractJSON(raw) as Record<string, unknown>
    const score = parseFloat(String(data.score ?? data.балл ?? data.grade ?? ''))
    if (!isNaN(score)) {
      const just = String(data.justification ?? data.comment ?? data.обоснование ?? data.feedback ?? '').trim()
      const rec  = String(data.recommendations ?? data.улучшить ?? data.recommendation ?? data.advice ?? '').trim()
      return build(score, just, rec)
    }
  } catch { /* fall through */ }

  // ── Pass 3: raw text heuristics ───────────────────────────────────────────
  const scorePatterns = [
    /(\d+(?:\.\d+)?)\s*\/\s*\d+/,            // 7/10
    /оценк[аи][:\s]+(\d+(?:\.\d+)?)/i,       // оценка: 7
    /^(\d+(?:\.\d+)?)\s*$/m                  // standalone number line
  ]
  let score = criterion.maxScore * 0.5
  for (const p of scorePatterns) {
    const m = raw.match(p)
    if (m) { const v = parseFloat(m[1]); if (v >= 0 && v <= criterion.maxScore) { score = v; break } }
  }

  // Strip JSON/code fragments from text for cleaner extraction
  const clean = raw.replace(/```[\s\S]*?```/g, '').replace(/\{[\s\S]*?\}/g, '').replace(/\s{2,}/g, ' ').trim()

  // Split on sentence boundaries, find recommendation section
  const sentences = clean.split(/(?<=[.!?])\s+/)
  const recStart  = sentences.findIndex((s) => /рекоменд|улучш|следует|нужно|необходимо/i.test(s))

  let just: string
  let rec: string

  if (recStart > 0) {
    just = sentences.slice(0, recStart).join(' ')
    rec  = sentences.slice(recStart).join(' ')
  } else {
    const mid = Math.ceil(sentences.length / 2)
    just = sentences.slice(0, mid).join(' ')
    rec  = sentences.slice(mid).join(' ')
  }

  return build(score, just.substring(0, 500), rec.substring(0, 350))
}

// ── Fallback text generators ──────────────────────────────────────────────────

function genJustification(score: number, c: RubricCriterion): string {
  const pct = score / c.maxScore
  if (pct >= 0.9) return `Критерий «${c.name}» выполнен отлично. ${c.description} — на высоком уровне.`
  if (pct >= 0.7) return `Критерий «${c.name}» выполнен хорошо, но есть недочёты. ${c.description}.`
  if (pct >= 0.5) return `Критерий «${c.name}» выполнен частично. ${c.description} раскрыто недостаточно.`
  return `Критерий «${c.name}» выполнен слабо. ${c.description} — требует серьёзной доработки.`
}

function genRecommendation(score: number, c: RubricCriterion): string {
  const pct = score / c.maxScore
  if (pct >= 0.9) return `Работа выполнена на высоком уровне по данному критерию. Поддерживайте этот стандарт.`
  if (pct >= 0.7) return `Для повышения оценки: уделите больше внимания ${c.description.toLowerCase()}.`
  if (pct >= 0.5) return `Необходимо существенно доработать: ${c.description.toLowerCase()}. Рекомендуется пересмотреть структуру и полноту изложения.`
  return `Требуется значительное улучшение: ${c.description.toLowerCase()}. Изучите требования повторно и полностью переработайте этот раздел.`
}

// ── Rubric generator ──────────────────────────────────────────────────────────

export async function generateRubricFromWork(
  config: LlamaApiConfig,
  fileContent: string,
  workTypeHint?: string
): Promise<Rubric> {
  const preview = fileContent.substring(0, 4000)
  const typeHint = workTypeHint ? `Тип работы: ${workTypeHint}\n` : ''

  const prompt = `Ты — эксперт по разработке академических рубрик. Проанализируй приведённую учебную работу и создай подходящую рубрику для её оценки.

${typeHint}НАЧАЛО ТЕКСТА РАБОТЫ:
${preview}

ЗАДАЧА: Создай рубрику с 4–6 критериями, которые ТОЧНО подходят для оценки данного типа работы.
Учти содержание: какие аспекты важны именно для этой работы?

ПРАВИЛА:
- Сумма весов должна равняться РОВНО 100%
- maxScore для каждого критерия: 10
- Критерии должны отражать специфику работы (не просто общие «структура», «оформление»)
- Названия критериев — конкретные и понятные

Ответь ТОЛЬКО валидным JSON без пояснений:
{
  "name": "Название рубрики (отражает тип работы)",
  "criteria": [
    {
      "id": "c1",
      "name": "Название критерия",
      "weight": 20,
      "maxScore": 10,
      "description": "Что именно проверяется по данному критерию"
    }
  ]
}`

  const { text: response } = await callLLM(config, prompt, {
    maxTokens: 1500,
    temperature: 0.4
  })

  try {
    const data = extractJSON(response) as { name: string; criteria: Rubric['criteria'] }
    if (!data.name || !Array.isArray(data.criteria) || data.criteria.length < 2) {
      throw new Error('Некорректная структура рубрики')
    }

    // Normalize weights to sum exactly 100
    const totalWeight = data.criteria.reduce((s, c) => s + (Number(c.weight) || 0), 0)
    if (totalWeight !== 100 && totalWeight > 0) {
      data.criteria = data.criteria.map((c) => ({
        ...c,
        weight: Math.round((Number(c.weight) / totalWeight) * 100)
      }))
      // Fix rounding drift on last criterion
      const diff = 100 - data.criteria.reduce((s, c) => s + c.weight, 0)
      if (diff !== 0) data.criteria[data.criteria.length - 1].weight += diff
    }

    return {
      id: `ai_${Date.now()}`,
      name: data.name,
      criteria: data.criteria.map((c, i) => ({
        id: `c${i + 1}`,
        name: String(c.name || `Критерий ${i + 1}`),
        weight: Number(c.weight) || Math.floor(100 / data.criteria.length),
        maxScore: Number(c.maxScore) || 10,
        description: String(c.description || '')
      }))
    }
  } catch {
    config.onLog('Генератор рубрик: не удалось разобрать JSON, создаётся рубрика по умолчанию', 'warning')
    // Fallback: generic academic rubric
    return {
      id: `ai_fallback_${Date.now()}`,
      name: 'Сгенерированная рубрика',
      criteria: [
        { id: 'c1', name: 'Соответствие теме', weight: 25, maxScore: 10, description: 'Насколько работа соответствует заданной теме' },
        { id: 'c2', name: 'Полнота раскрытия', weight: 25, maxScore: 10, description: 'Глубина и полнота изложения материала' },
        { id: 'c3', name: 'Структура и логика', weight: 25, maxScore: 10, description: 'Логичность построения, наличие введения/заключения' },
        { id: 'c4', name: 'Оформление', weight: 25, maxScore: 10, description: 'Соответствие требованиям оформления' }
      ]
    }
  }
}

export async function summarizeCriteria(
  config: LlamaApiConfig,
  criteriaResults: CriterionResult[],
  rubricName: string,
  fileName: string,
  finalScore: number
): Promise<string> {
  const expertsBlock = criteriaResults
    .map(r =>
      `Критерий: ${r.criterionName} (вес ${r.weight}%, балл ${r.score}/${r.maxScore})\n` +
      `Обоснование: ${r.justification.substring(0, 300)}\n` +
      `Рекомендации: ${r.recommendations.substring(0, 200)}`
    )
    .join('\n\n')

  const prompt = `Ты — финальный оценщик. Ниже — оценки независимых экспертов по каждому критерию работы. Синтезируй общее заключение.

Работа: "${fileName}"
Рубрика: "${rubricName}"
Итоговый балл: ${finalScore}/100

Оценки экспертов:
${expertsBlock}

Напиши ИТОГОВОЕ ЗАКЛЮЧЕНИЕ о работе в 3-4 предложения: что сделано хорошо, что слабо, главный совет автору.`

  const ANCHOR = 'Итоговое заключение: '

  try {
    const { text } = await callLLM(config, prompt, {
      maxTokens: 250,
      temperature: 0.2,
      assistantPrefix: ANCHOR,
      stop: ['\n\n\n', '---', 'Работа:', 'Рубрика:', 'Оценки:']
    })
    return text.replace(/^Итоговое заключение:\s*/i, '').trim().substring(0, 700)
  } catch {
    return ''
  }
}

export function calculateFinalScore(
  criteriaResults: CriterionResult[],
  fileName: string,
  rubricName: string,
  modelUsed: string,
  sourcesUsed: string[] = [],
  summaryComment?: string
) {
  let totalWeightedScore = 0
  let totalWeight = 0

  for (const cr of criteriaResults) {
    totalWeightedScore += cr.weightedScore
    totalWeight += cr.weight
  }

  const finalScore = totalWeight > 0 ? Math.round(totalWeightedScore / (totalWeight / 100)) : 0

  let grade: string
  let gradeDescription: string
  if (finalScore >= 90) { grade = 'A'; gradeDescription = 'Отлично' }
  else if (finalScore >= 80) { grade = 'B'; gradeDescription = 'Хорошо' }
  else if (finalScore >= 70) { grade = 'C'; gradeDescription = 'Удовлетворительно' }
  else if (finalScore >= 60) { grade = 'D'; gradeDescription = 'Достаточно' }
  else if (finalScore >= 50) { grade = 'E'; gradeDescription = 'Слабо' }
  else { grade = 'F'; gradeDescription = 'Неудовлетворительно' }

  return {
    id: Date.now().toString(),
    fileName,
    timestamp: new Date().toISOString(),
    rubricName,
    modelUsed,
    finalScore,
    grade,
    gradeDescription,
    criteria: criteriaResults,
    sourcesUsed,
    summaryComment
  }
}
