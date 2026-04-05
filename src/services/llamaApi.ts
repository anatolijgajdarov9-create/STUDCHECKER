import type { Model, PlanItem, CriterionResult, RubricCriterion, Rubric, AiModel, ExecutionPlan } from '../types'
import { buildModelsDescription, estimateCapability, analyzeContent, type ContentAnalysis } from './modelSelector'
import {
  buildCriterionPrompt as buildCriterionPromptTpl,
  getDomainFewShotExamples,
  buildSystemPrompt as buildSystemPromptTpl,
  getOptimalTemperature,
  getOptimalMaxTokens,
  detectWorkTypeWithConfidence,
  buildScoreScale,
  getWorkTypeReference
} from './promptTemplates'

export interface LlamaApiConfig {
  url: string
  temperature: number
  maxTokens: number
  modelId: string
  modelCapability?: number
  sources?: Array<{ name: string; content: string }>
  onLog?: (message: string, type?: 'info' | 'success' | 'error' | 'warning') => void
  onRequestLog?: (entry: { criterion: string; prompt: string; response: string; durationMs: number; status: 'ok' | 'error' | 'timeout' }) => void
  /** Optional: content analysis result for domain-aware prompts */
  contentAnalysis?: ContentAnalysis
  /** Optional: detected work type */
  workType?: string
}

// ── Circuit Breaker ─────────────────────────────────────────────────────────────

enum CircuitState { CLOSED = 'closed', OPEN = 'open', HALF_OPEN = 'half-open' }

class CircuitBreaker {
  private failures = 0
  private lastFailureTime = 0
  private state: CircuitState = CircuitState.CLOSED
  private readonly failureThreshold: number
  private readonly resetTimeout: number
  private readonly halfOpenAttempts: number
  private halfOpenSuccesses = 0

  constructor(failureThreshold = 5, resetTimeout = 60000, halfOpenAttempts = 2) {
    this.failureThreshold = failureThreshold
    this.resetTimeout = resetTimeout
    this.halfOpenAttempts = halfOpenAttempts
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = CircuitState.HALF_OPEN
        this.halfOpenSuccesses = 0
      } else {
        throw new Error('Circuit breaker OPEN: too many failures, retry later')
      }
    }

    try {
      const result = await fn()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure()
      throw error
    }
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.halfOpenSuccesses++
      if (this.halfOpenSuccesses >= this.halfOpenAttempts) {
        this.reset()
      }
    } else {
      this.failures = 0
    }
  }

  private onFailure(): void {
    this.failures++
    this.lastFailureTime = Date.now()
    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN
    } else if (this.failures >= this.failureThreshold) {
      this.state = CircuitState.OPEN
    }
  }

  private reset(): void {
    this.state = CircuitState.CLOSED
    this.failures = 0
    this.halfOpenSuccesses = 0
  }

  getState(): string {
    return this.state
  }
}

let globalCircuitBreaker: CircuitBreaker | null = null

function getCircuitBreaker(): CircuitBreaker {
  if (!globalCircuitBreaker) {
    globalCircuitBreaker = new CircuitBreaker(5, 60000, 2)
  }
  return globalCircuitBreaker
}

function classifyError(error: unknown): 'timeout' | 'network' | 'server' | 'client' | 'unknown' {
  const msg = error instanceof Error ? error.message : String(error)
  if (error instanceof DOMException && error.name === 'AbortError') return 'timeout'
  if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('fetch')) return 'network'
  if (/5\d{2}/.test(msg)) return 'server'
  if (/4\d{2}/.test(msg)) return 'client'
  return 'unknown'
}

function getRetryDelay(attempt: number, errorType: string): number {
  const baseDelay = errorType === 'network' ? 5000 : 3000
  const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt - 1), 30000)
  const jitter = Math.random() * 1000
  return exponentialDelay + jitter
}

// ── Server readiness check ───────────────────────────────────────────────────────

export async function waitForServerReady(url: string, timeoutMs = 60000): Promise<boolean> {
  const start = Date.now()
  const checkInterval = 3000

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/v1/models`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      })
      if (res.ok) return true
    } catch {}
    await new Promise<void>((r) => setTimeout(r, checkInterval))
  }
  return false
}

// ── Adaptive model parameters ──────────────────────────────────────────────────

export interface ModelParams {
  contextLimit: number
  maxTokens: number
  temperature: number
  useFewShot: boolean
  promptComplexity: 'minimal' | 'standard' | 'detailed'
}

export function getModelParams(capability: number): ModelParams {
  if (capability < 40) {
    return {
      contextLimit: 800,
      maxTokens: 200,
      temperature: 0.05,
      useFewShot: false,
      promptComplexity: 'minimal'
    }
  }
  if (capability < 60) {
    return {
      contextLimit: 1200,
      maxTokens: 300,
      temperature: 0.1,
      useFewShot: true,
      promptComplexity: 'standard'
    }
  }
  return {
    contextLimit: 1800,
    maxTokens: 400,
    temperature: 0.15,
    useFewShot: true,
    promptComplexity: 'detailed'
  }
}

/** @deprecated Use estimateCapability from modelSelector */
export function getCapabilityFromSize(sizeBytes: number): number {
  return estimateCapability(sizeBytes)
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
  const timeoutMs = 300000
  const maxRetries = 3
  let lastError: Error | null = null
  const circuitBreaker = getCircuitBreaker()

  const messages: Array<{ role: string; content: string }> = [
    { role: 'user', content: prompt }
  ]
  if (opts.assistantPrefix) {
    messages.push({ role: 'assistant', content: opts.assistantPrefix })
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let lastErrorType = 'unknown'

    try {
      const result = await circuitBreaker.execute(async () => {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
        const startTime = Date.now()

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
          const text = opts.assistantPrefix ? opts.assistantPrefix + content : content
          return { text, durationMs: Date.now() - startTime }
        } catch (e) {
          clearTimeout(timeoutId)
          throw e
        }
      })

      return result
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))
      lastErrorType = classifyError(lastError)

      const circuitBreakerState = circuitBreaker.getState()
      if (circuitBreakerState === CircuitState.OPEN) {
        config.onLog?.(`Circuit breaker OPEN: слишком много ошибок. Подождите и попробуйте позже.`, 'error')
        throw lastError
      }

      if (attempt < maxRetries) {
        const delay = getRetryDelay(attempt, lastErrorType)
        config.onLog?.(`Попытка ${attempt} не удалась (${lastErrorType}): ${lastError.message}. Повтор через ${Math.round(delay / 1000)} сек...`, 'warning')
        await new Promise<void>((r) => setTimeout(r, delay))
      }
    }
  }

  throw lastError || new Error('Ошибка вызова LLM после всех попыток')
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

const PLANNER_EXAMPLES = [
  {
    rubric: {
      name: 'Реферат',
      criteria: [
        { name: 'Актуальность темы', maxScore: 10, weight: 15, description: 'Обоснование выбора темы, её значимость' },
        { name: 'Структура', maxScore: 10, weight: 20, description: 'Наличие введения, основной части, заключения, списка литературы' },
        { name: 'Раскрытие темы', maxScore: 10, weight: 35, description: 'Глубина раскрытия темы, использование источников' },
        { name: 'Оформление', maxScore: 10, weight: 15, description: 'Соответствие требованиям ГОСТ' },
        { name: 'Выводы', maxScore: 10, weight: 15, description: 'Наличие и качество выводов по теме' }
      ]
    },
    content: 'В данном реферате рассматривается проблема глобального потепления. Автор приводит данные о повышении температуры...',
    result: [
      { criterion: 'Актуальность темы', prompt: 'Оцени: 1) Обоснована ли актуальность темы? 2) Указаны ли причины выбора темы? 3) Актуальна ли тема в современном контексте? Максимум — 10 баллов.', maxScore: 10 },
      { criterion: 'Структура', prompt: 'Проверь: 1) Есть ли введение с целями/задачами? 2) Логично ли выстроена основная часть? 3) Есть ли заключение? 4) Указан ли список литературы (минимум 5 источников)?', maxScore: 10 },
      { criterion: 'Раскрытие темы', prompt: 'Оцени глубину: 1) Раскрыта ли суть проблемы? 2) Использованы ли разные источники (книги, статьи, интернет)? 3) Есть ли анализ и обобщение материала? 4) Не списана ли работа целиком из одного источника?', maxScore: 10 },
      { criterion: 'Оформление', prompt: 'Проверь: 1) Соответствует ли оформление требованиям? 2) Правильно ли оформлены ссылки и список литературы? 3) Соблюдены ли шрифт, интервалы, поля?', maxScore: 10 },
      { criterion: 'Выводы', prompt: 'Оцени: 1) Сформулированы ли выводы? 2) Соответствуют ли они поставленным целям? 3) Есть ли в выводах обобщение основных положений?', maxScore: 10 }
    ]
  }
]

export async function runPlanner(
  config: LlamaApiConfig,
  rubric: Rubric,
  contentPreview: string,
  models?: AiModel[]
): Promise<ExecutionPlan> {
  const rubricBlock = rubric.criteria.map((c) => 
    `- ${c.name} (макс ${c.maxScore} балл., вес ${c.weight}%): ${c.description}`
  ).join('\n')

  const modelsBlock = models && models.length > 0 
    ? buildModelsDescription(models)
    : 'Модели не переданы — выбери модель на основе описания работы.'

  const sortedModels = models ? [...models].sort((a, b) => b.capability - a.capability) : []
  const firstModelName = sortedModels[0]?.fileName || 'default'

  const examplesBlock = `
ПРИМЕР ОПТИМАЛЬНОГО ПЛАНА (для понимания формата):
Критерии: [Глубина анализа, Оформление, Логика, Оригинальность]
Модели: [7B-сильная, 3B-быстрая]

ОПТИМАЛЬНЫЙ ПОРЯДОК:
1. Шаг 1: "Оформление" → 3B → isModelSwitch=false (первая модель)
2. Шаг 2: "Оригинальность" → 3B → isModelSwitch=false (та же модель)
3. Шаг 3: "Логика" → 7B → isModelSwitch=true (переключение)
4. Шаг 4: "Глубина анализа" → 7B → isModelSwitch=false (та же модель)

Почему такой порядок? Сгруппировали все критерии с 3B вместе, потом 7B.
Переключений: 2 (минимум)
---`

  const prompt = `Ты — умный планировщик проверки студенческих работ. Твоя задача — составить ОПТИМАЛЬНЫЙ план выполнения.

${examplesBlock}

КОНКРЕТНАЯ РАБОТА ДЛЯ АНАЛИЗА:
${modelsBlock}

РУБРИКА ОЦЕНКИ:
${rubricBlock}

ТЕКСТ РАБОТЫ (первые 2000 символов):
${contentPreview.substring(0, 2000)}

═══════════════════════════════════════════════════════════════
ЗАДАНИЕ:
═══════════════════════════════════════════════════════════════

Для КАЖДОГО критерия:
1. Оцени СЛОЖНОСТЬ: low (простые задачи) / medium / high (сложный анализ)
2. Выбери ПОДХОДЯЩУЮ модель из списка
3. Вычисли ПАРАМЕТРЫ для этой модели:
   - contextLimit: 800 (маленькие модели) / 1200 (средние) / 1800 (большие)
   - useFewShot: false (маленькие) / true (большие)
4. Создай ПРОМТ для оценки

═══════════════════════════════════════════════════════════════
ПРАВИЛА ОПТИМАЛЬНОГО ПЛАНИРОВАНИЯ:
═══════════════════════════════════════════════════════════════

1. ПЕРВЫЙ ШАГ — используй самую мощную модель (для планировщика она уже загружена)
2. ГРУППИРУЙ критерии по модели: все с одной моделью — вместе
3. МИНИМИЗИРУЙ переключения: если модель A нужна для шагов 1 и 3, а B для шага 2 — сначала A (шаг 1), потом B (шаг 2), потом A (шаг 3)
4. ПЕРВЫЙ шаг каждой группы должен иметь isModelSwitch=false (модель уже загружена)
5. СЛЕДУЮЩИЕ шаги с той же моделью — isModelSwitch=false
6. ПЕРВЫЙ шаг с НОВОЙ моделью — isModelSwitch=true

═══════════════════════════════════════════════════════════════
ВЫБОР МОДЕЛИ:
═══════════════════════════════════════════════════════════════

- high сложность → самая мощная модель (capability 70+)
- medium сложность → модель capability 40-70
- low сложность → любая модель, но быстрая лучше

═══════════════════════════════════════════════════════════════
ФОРМАТ ОТВЕТА (JSON):
═══════════════════════════════════════════════════════════════

{
  "recommendedFirstModel": "имя файла первой модели (самая мощная)",
  "estimatedSwitches": число,
  "steps": [
    {
      "step": 1,
      "criterion": "ТОЧНО название критерия из рубрики",
      "criterionId": "id критерия из рубрики",
      "recommendedModel": "имя файла модели",
      "modelRationale": "1-2 предложения почему выбрана эта модель",
      "complexity": "low|medium|high",
      "isModelSwitch": false,
      "contextLimit": 1200,
      "maxTokens": 300,
      "temperature": 0.1,
      "useFewShot": true,
      "promptComplexity": "minimal|standard|detailed",
      "prompt": "Детальный промт для эксперта: что проверять, критерии оценки"
    }
  ]
}`

  const { text: response } = await callLLM(config, prompt, { maxTokens: 3500, temperature: 0.3 })

  try {
    const rawPlan = extractJSON(response)
    
    if (rawPlan && typeof rawPlan === 'object' && 'steps' in rawPlan) {
      const planData = rawPlan as Record<string, unknown>
      const steps = (planData.steps as Array<Record<string, unknown>>).map((item, index) => {
        const criterionName = String(item.criterion || '')
        const rubricCriterion = rubric.criteria.find(c => c.name === criterionName)
        const modelName = String(item.recommendedModel || firstModelName)
        const model = models?.find(m => m.fileName === modelName)
        const capability = model?.capability || 50
        const params = getModelParams(capability)
        
        return {
          criterion: criterionName,
          criterionId: rubricCriterion?.id || String(index),
          prompt: String(item.prompt || ''),
          maxScore: rubricCriterion?.maxScore || Number(item.maxScore) || 10,
          recommendedModel: modelName,
          modelRationale: String(item.modelRationale || 'Модель выбрана планировщиком'),
          complexity: (item.complexity as 'low' | 'medium' | 'high') || 'medium',
          step: Number(item.step) || index + 1,
          isModelSwitch: Boolean(item.isModelSwitch),
          contextLimit: Number(item.contextLimit) || params.contextLimit,
          maxTokens: Number(item.maxTokens) || params.maxTokens,
          temperature: Number(item.temperature) || params.temperature,
          useFewShot: item.useFewShot !== undefined ? Boolean(item.useFewShot) : params.useFewShot,
          promptComplexity: (item.promptComplexity as 'minimal' | 'standard' | 'detailed') || params.promptComplexity
        } as PlanItem
      })

      const estimatedSwitches = Number(planData.estimatedSwitches) || steps.filter(s => s.isModelSwitch).length
      const recommendedFirstModel = String(planData.recommendedFirstModel || firstModelName)

      config.onLog?.(`Планировщик: ${steps.length} шагов, ~${estimatedSwitches} переключений модели`, 'success')

      return { steps, estimatedSwitches, recommendedFirstModel }
    }
    
    throw new Error('Некорректная структура плана')
  } catch (e) {
    config.onLog?.('Планировщик: ошибка парсинга, создаю базовый план', 'warning')
    
    const defaultModel = sortedModels[0]?.fileName || 'default'
    const defaultCapability = sortedModels[0]?.capability || 50
    const defaultParams = getModelParams(defaultCapability)
    
    const steps: PlanItem[] = rubric.criteria.map((c, i) => ({
      criterion: c.name,
      criterionId: c.id,
      prompt: `Оцени критерий "${c.name}" (${c.description}). Выстави оценку от 0 до ${c.maxScore}.`,
      maxScore: c.maxScore,
      recommendedModel: defaultModel,
      modelRationale: 'Модель по умолчанию',
      complexity: 'medium' as const,
      step: i + 1,
      isModelSwitch: i === 0 ? false : true,
      contextLimit: defaultParams.contextLimit,
      maxTokens: defaultParams.maxTokens,
      temperature: defaultParams.temperature,
      useFewShot: defaultParams.useFewShot,
      promptComplexity: defaultParams.promptComplexity
    }))

    return { 
      steps, 
      estimatedSwitches: steps.length - 1, 
      recommendedFirstModel: defaultModel 
    }
  }
}

// ── Few-shot examples ─────────────────────────────────────────────────────────

interface FewShotExample {
  criterionName: string
  criterionDescription: string
  workExcerpt: string
  score: number
  maxScore: number
  qualityLevel: 'excellent' | 'good' | 'satisfactory' | 'poor'
  justification: string
  recommendations: string
}

const FEW_SHOT_EXAMPLES: FewShotExample[] = [
  // ОТЛИЧНО (9-10/10)
  {
    criterionName: 'Раскрытие темы',
    criterionDescription: 'Полнота и глубина раскрытия основной темы работы',
    workExcerpt: 'В работе детально анализируются причины глобального потепления: антропогенные факторы (сжигание ископаемого топлива даёт 75% выбросов CO2), промышленные выбросы метана, вырубка лесов. Приведены данные IPCC за 2023 год, конкретные примеры последствий для экосистем Арктики и коралловых рифов.',
    score: 9,
    maxScore: 10,
    qualityLevel: 'excellent',
    justification: 'Работа демонстрирует глубокое понимание темы. Автор использует научные данные, проводит анализ причин и последствий, приводит конкретные примеры. Материал изложен логично и систематизирован.',
    recommendations: 'Работа выполнена на высоком уровне. Для совершенства можно добавить больше первичных источников и собственные наблюдения.'
  },
  // ХОРОШО (6-7/10)
  {
    criterionName: 'Раскрытие темы',
    criterionDescription: 'Полнота и глубина раскрытия основной темы работы',
    workExcerpt: 'В реферате рассматривается проблема загрязнения окружающей среды. Автор описывает основные виды загрязнений: воздуха, воды, почвы. Упоминает отдельные примеры негативного воздействия на природу.',
    score: 6,
    maxScore: 10,
    qualityLevel: 'good',
    justification: 'Тема раскрыта в общих чертах. Автор знаком с основными аспектами проблемы, но ограничивается описанием без глубокого анализа. Не хватает конкретных данных, статистики, причинно-следственных связей.',
    recommendations: 'Добавить конкретные цифры и статистику. Углубить анализ причинно-следственных связей. Рассмотреть меньше тем, но раскрыть их более подробно.'
  },
  // УДОВЛЕТВОРИТЕЛЬНО (4-5/10)
  {
    criterionName: 'Раскрытие темы',
    criterionDescription: 'Полнота и глубина раскрытия основной темы работы',
    workExcerpt: 'В работе рассматривается тема загрязнения. Автор в общих чертах описывает, что загрязнение плохо для природы. Упоминает несколько терминов без объяснения их значения.',
    score: 4,
    maxScore: 10,
    qualityLevel: 'satisfactory',
    justification: 'Работа носит поверхностный характер. Автор не раскрывает суть проблемы, ограничивается общими фразами типа "загрязнение вредит природе". Отсутствует научная терминология и анализ.',
    recommendations: 'Изучить предметную область более глубоко. Использовать научные источники вместо популярных статей. Объяснять специальные термины. Добавить структуру и логику изложения.'
  },
  // ПЛОХО (2-3/10)
  {
    criterionName: 'Раскрытие темы',
    criterionDescription: 'Полнота и глубина раскрытия основной темы работы',
    workExcerpt: 'Экология это когда природу загрязняют. Надо её защищать. В работе говорится о том что люди должны беречь природу.',
    score: 2,
    maxScore: 10,
    qualityLevel: 'poor',
    justification: 'Работа не раскрывает тему. Отсутствует какое-либо содержательное наполнение, нет определений, примеров, анализа. Текст представляет собой набор общих фраз без конкретики.',
    recommendations: 'Кардинально переработать содержание. Изучить основы темы по учебникам и научным источникам. Начать с определений и базовых понятий. Обязательно использовать источники информации.'
  },
  // ЛОГИЧНОСТЬ - ХОРОШО
  {
    criterionName: 'Логичность изложения',
    criterionDescription: 'Структурированность текста, наличие переходов между разделами, отсутствие противоречий',
    workExcerpt: 'Введение формулирует цели работы. Затем последовательно рассматриваются причины, виды загрязнений и способы решения проблемы. Каждый раздел логически связан с предыдущим. Выводы соответствуют поставленным целям.',
    score: 8,
    maxScore: 10,
    qualityLevel: 'good',
    justification: 'Работа имеет чёткую логическую структуру. Прослеживается последовательность: проблема → анализ → решение. Используются связующие конструкции между разделами.',
    recommendations: 'Хорошая работа. Можно усилить переходы между отдельными абзацами внутри разделов.'
  },
  // ЛОГИЧНОСТЬ - ПЛОХО
  {
    criterionName: 'Логичность изложения',
    criterionDescription: 'Структурированность текста, наличие переходов между разделами, отсутствие противоречий',
    workExcerpt: 'Сначала автор пишет о важности экологии. Затем резко переходит к истории промышленной революции. Далее снова возвращается к экологии, но без связи с предыдущим материалом. Встречаются внутренние противоречия в аргументации.',
    score: 3,
    maxScore: 10,
    qualityLevel: 'poor',
    justification: 'Работа имеет серьёзные логические проблемы: отсутствуют переходы между темами, нет связности изложения, присутствуют внутренние противоречия. Создаётся впечатление набора разрозненных фактов.',
    recommendations: 'Составить план работы и следовать ему. Добавлять связующие фразы между абзацами. Проверить, что каждый раздел логически вытекает из предыдущего. Убрать противоречия в аргументации.'
  }
]

function buildFewShotBlock(criterionName: string, criterionDescription: string, useExamples: boolean = true): string {
  if (!useExamples) return ''
  
  const relevantExamples = FEW_SHOT_EXAMPLES.filter(ex => 
    ex.criterionName.toLowerCase().includes(criterionName.toLowerCase().split(' ')[0])
  )
  
  const selectedExamples = relevantExamples.slice(0, 2)
  
  if (selectedExamples.length === 0) return ''
  
  return selectedExamples.map((ex, i) => {
    const levelLabel = {
      excellent: 'ОТЛИЧНО',
      good: 'ХОРОШО', 
      satisfactory: 'УДОВЛЕТВОРИТЕЛЬНО',
      poor: 'ПЛОХО'
    }[ex.qualityLevel]
    
    return `
ПРИМЕР ${i + 1} (${levelLabel} — ${ex.score}/${ex.maxScore}):
Критерий: ${ex.criterionName}
Что проверяем: ${ex.criterionDescription}
Текст работы:
${ex.workExcerpt}

Оценка эксперта:
Балл: ${ex.score}/${ex.maxScore}
Обоснование: ${ex.justification}
Рекомендации: ${ex.recommendations}
---`
  }).join('\n')
}

// ── Evaluation prompt ─────────────────────────────────────────────────────────
// Uses Chain-of-Thought + few-shot learning for more accurate, consistent scores.

export async function evaluateCriterion(
  config: LlamaApiConfig,
  criterion: RubricCriterion,
  _planItem: PlanItem | null,
  fileContent: string
): Promise<CriterionResult> {
  // Determine domain and work type (auto-detect if not provided)
  const contentAnalysis = config.contentAnalysis || analyzeContent(fileContent)
  const workType = config.workType || detectWorkTypeWithConfidence('', '', fileContent).workType
  const domain = contentAnalysis.domain

  // Build domain-adapted few-shot block
  const fewShotExamples = getDomainFewShotExamples(domain, criterion.name, 2)
  const fewShotBlock = fewShotExamples.length > 0
    ? fewShotExamples.map((ex, i) => {
        const levelLabel = ex.score / ex.maxScore >= 0.9 ? 'ОТЛИЧНО' :
                          ex.score / ex.maxScore >= 0.7 ? 'ХОРОШО' :
                          ex.score / ex.maxScore >= 0.5 ? 'УДОВЛЕТВОРИТЕЛЬНО' : 'ПЛОХО'
        return `
ПРИМЕР ${i + 1} (${levelLabel} — ${ex.score}/${ex.maxScore}):
Текст работы:
${ex.workExcerpt}

Оценка эксперта:
Балл: ${ex.score}/${ex.maxScore}
Обоснование: ${ex.justification}
Рекомендации: ${ex.recommendations}
---`
      }).join('\n')
    : buildFewShotBlock(criterion.name, criterion.description, false)

  // Build domain-specific prompt using promptTemplates
  const prompt = buildCriterionPromptTpl(criterion, workType, contentAnalysis, fileContent)

  // Compute optimal temperature and maxTokens for this criterion
  const planComplexity = _planItem?.complexity || 'medium'
  const temperature = getOptimalTemperature(domain, contentAnalysis.complexity, config.temperature)
  const maxTokens = getOptimalMaxTokens(criterion.name, planComplexity)

  const fullPrompt = `${prompt}

ПРИМЕРЫ ОЦЕНКИ (для ориентира):
${fewShotBlock}

${buildScoreScale(criterion.maxScore, workType)}

ФОРМАТ ОТВЕТА (только эти строки):
Балл: [число]
Обоснование: [конкретно: что сделано хорошо, что плохо]
Улучшить: [1-2 совета по улучшению]`

  const ANCHOR = 'Балл: '

  let result: { text: string; durationMs: number }
  let status: 'ok' | 'error' | 'timeout' = 'ok'

  try {
    result = await callLLM(config, fullPrompt, {
      maxTokens,
      temperature,
      assistantPrefix: ANCHOR,
      stop: ['\n\nКритерий', '\n\nТекст', '\n\nНапиши', '---', 'Задача:']
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    status = msg.includes('abort') ? 'timeout' : 'error'
    config.onRequestLog?.({ criterion: criterion.name, prompt: fullPrompt, response: `ОШИБКА: ${msg}`, durationMs: 0, status })
    throw e
  }

  config.onRequestLog?.({ criterion: criterion.name, prompt: fullPrompt, response: result.text, durationMs: result.durationMs, status })
  return parseModelResponse(result.text, criterion)
}

// ── Self-consistency evaluation ────────────────────────────────────────────────
// Runs multiple evaluations and takes the median score for more consistent results.

export async function evaluateCriterionWithConsistency(
  config: LlamaApiConfig,
  criterion: RubricCriterion,
  planItem: PlanItem | null,
  fileContent: string,
  runs = 3
): Promise<CriterionResult> {
  const results: CriterionResult[] = []
  const prompts: string[] = []

  for (let i = 0; i < runs; i++) {
    try {
      const result = await evaluateCriterion(config, criterion, planItem, fileContent)
      results.push(result)
    } catch {
      // Continue with other runs
    }
  }

  if (results.length === 0) {
    throw new Error('Все попытки оценки критерия завершились ошибкой')
  }

  if (results.length === 1) {
    return results[0]
  }

  // Take median score for consistency
  const scores = results.map(r => r.score).sort((a, b) => a - b)
  const medianScore = scores[Math.floor(scores.length / 2)]

  // Find the result closest to median for justification/recommendations
  const medianResult = results.find(r => r.score === medianScore) || results[0]

  // Average justifications/recommendations if multiple results
  const bestJustification = medianResult.justification
  const bestRecommendations = medianResult.recommendations

  return {
    ...medianResult,
    score: medianScore,
    justification: bestJustification,
    recommendations: bestRecommendations
  }
}

// ── Feedback loop for borderline cases ─────────────────────────────────────────
// Iteratively refines borderline scores (30-75%) for more accurate assessment.

const BORDERLINE_LOW = 0.3   // Below 30% — clear need for improvement
const BORDERLINE_HIGH = 0.75 // Above 75% — good enough
const MAX_FEEDBACK_ITERATIONS = 2
const CONVERGENCE_THRESHOLD = 0.15 // Consider converged if score changed by < 15%

export async function evaluateCriterionWithFeedback(
  config: LlamaApiConfig,
  criterion: RubricCriterion,
  planItem: PlanItem | null,
  fileContent: string,
  useConsistency = true
): Promise<CriterionResult> {
  const evaluator = useConsistency
    ? evaluateCriterionWithConsistency
    : evaluateCriterion

  let result = await evaluator(config, criterion, planItem, fileContent)
  let iterations = 0
  let previousScore = result.score

  const isBorderline = (normalized: number) => 
    normalized >= BORDERLINE_LOW && normalized <= BORDERLINE_HIGH

  while (iterations < MAX_FEEDBACK_ITERATIONS) {
    const normalizedScore = result.score / result.maxScore
    
    if (!isBorderline(normalizedScore)) {
      break
    }

    iterations++
    config.onLog?.(`Feedback итерация ${iterations} для "${criterion.name}" (${result.score}/${result.maxScore})`, 'info')
    
    const iterationContext = iterations > 1
      ? `ПРЕДЫДУЩАЯ ИТЕРАЦИЯ: ${previousScore}/${result.maxScore} → ${result.score}/${result.maxScore}`
      : `ПЕРВИЧНАЯ ОЦЕНКА: ${result.score}/${result.maxScore}`

    const detailedPrompt = `Ты — строгий эксперт. Оцени работу повторно для уточнения.

КРИТЕРИЙ: ${criterion.name}
МАКСИМАЛЬНЫЙ БАЛЛ: ${criterion.maxScore}

${iterationContext}

ТЕКСТ РАБОТЫ (для справки):
${fileContent.substring(0, 1200)}

Вопросы для уточнения:
1. Первичная оценка адекватна или завышена/занижена?
2. Есть ли аргументы за повышение или понижение оценки?
3. Какая итоговая оценка наиболее объективна?

Если оценка изменилась — объясни почему.
Если осталась той же — подтверди обоснование.

ФОРМАТ ОТВЕТА:
Балл: [число]
Обоснование: [краткое обоснование с учётом итераций]`

    try {
      const detailedResult = await callLLM(config, detailedPrompt, {
        maxTokens: 250,
        temperature: 0.05,
        assistantPrefix: 'Балл: '
      })
      
      const refined = parseModelResponse(detailedResult.text, criterion)
      previousScore = result.score
      result = {
        ...result,
        score: refined.score,
        justification: refined.justification,
        recommendations: refined.recommendations,
        strengths: refined.strengths,
        weaknesses: refined.weaknesses
      }

      const scoreDiff = Math.abs(result.score - previousScore) / result.maxScore
      if (scoreDiff < CONVERGENCE_THRESHOLD) {
        config.onLog?.(`Feedback сошёлся для "${criterion.name}"`, 'info')
        break
      }
    } catch {
      break
    }
  }

  return result
}

// ── Response parser ───────────────────────────────────────────────────────────
// Four-pass strategy:
//   Pass 1 — marker format  "Балл: N\nОбоснование: ...\nУлучшить: ..."
//   Pass 2 — JSON extraction (model may still output JSON)
//   Pass 3 — structured analysis parsing (for CoT responses)
//   Pass 4 — raw text heuristics (last resort)

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
      strengths: extractStrengths(justification, criterion),
      weaknesses: extractWeaknesses(justification, criterion)
    }
  }

  // ── Pass 1: marker format ─────────────────────────────────────────────────
  const scoreRx = /(?:^|\n)\s*[Бб]алл\s*[:\-–—]\s*(\d+(?:\.\d+)?)/
  const justRx  = /(?:^|\n)\s*[Оо]боснование\s*[:\-–—]\s*([\s\S]+?)(?=\n\s*(?:[УуРрЧч]|$))/
  const recRx   = /(?:^|\n)\s*(?:[Уу]лучшить|[Рр]екоменд\w*|[Чч]то\s+улучшить)\s*[:\-–—]\s*([\s\S]+)/

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

  // ── Pass 3: structured analysis parsing (CoT responses) ───────────────────
  // Look for analysis sections in Chain-of-Thought responses
  const analysisSection = raw.match(/(?:Анализ|Разбор)[:\s]+([\s\S]+?)(?=\n\s*(?:Балл|Шаг|$))/i)
  const analysisLines = analysisSection?.[1]?.split('\n').filter(l => l.trim()) || []
  
  // Extract score from analysis if found
  const analysisScoreM = raw.match(/(?:Балл|Оценка)[:\s]+(\d+(?:\.\d+)?)\s*\/\s*(\d+)/)
  if (analysisScoreM) {
    const score = parseFloat(analysisScoreM[1])
    const recM = raw.match(/(?:Улучшить|[Рр]екоменд)[:\s]+([\s\S]+)$/i)
    const justification = analysisLines.join(' ').substring(0, 500)
    const recommendations = recM ? recM[1].replace(/\n/g, ' ').trim().substring(0, 350) : ''
    return build(score, justification, recommendations)
  }

  // ── Pass 4: raw text heuristics ───────────────────────────────────────────
  const scorePatterns = [
    /(\d+(?:\.\d+)?)\s*\/\s*(\d+)/,            // 7/10 or 7/10
    /оценк[аи][:\s]+(\d+(?:\.\d+)?)/i,          // оценка: 7
    /(?:^|\n)\s*(\d+(?:\.\d+)?)\s*$/m,          // standalone number line
    /(?:max|из)\s*(\d+(?:\.\d+)?)/i             // "из 10" pattern
  ]
  let score = criterion.maxScore * 0.5
  for (const p of scorePatterns) {
    const m = raw.match(p)
    if (m) { 
      const v = parseFloat(m[1])
      if (v >= 0 && v <= criterion.maxScore) { score = v; break }
      // Handle "X/Y" format where Y is the max
      if (m[2]) {
        const maxFromPattern = parseFloat(m[2])
        if (maxFromPattern > 0 && maxFromPattern <= 20) {
          score = Math.round(v / maxFromPattern * criterion.maxScore)
          break
        }
      }
    }
  }

  const clean = raw.replace(/```[\s\S]*?```/g, '').replace(/\{[\s\S]*?\}/g, '').replace(/\s{2,}/g, ' ').trim()
  const sentences = clean.split(/(?<=[.!?])\s+/).filter(s => s.length > 10)
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

// ── Helper extractors for strengths/weaknesses ─────────────────────────────────

function extractStrengths(text: string, criterion: RubricCriterion): string[] {
  const strengths: string[] = []
  const positiveMarkers = [
    'хорош', 'отличн', 'грамотн', 'полност', 'логичн', 'структуриров',
    'правильн', 'глубок', 'детальн', 'аргументиров', 'содержательн',
    'соответств', 'выполнен', 'раскрыт', 'обоснова'
  ]
  for (const marker of positiveMarkers) {
    const m = text.match(new RegExp(`[^.]*${marker}[^.]*\\.`, 'gi'))
    if (m) strengths.push(...m.slice(0, 1))
  }
  return [...new Set(strengths)].slice(0, 3)
}

function extractWeaknesses(text: string, criterion: RubricCriterion): string[] {
  const weaknesses: string[] = []
  const negativeMarkers = [
    'недостат', 'слаб', 'отсутств', 'неполн', 'поверхност', 'ошибк',
    'нарушен', 'несоответств', 'упрощен', 'нелогич', 'неструктуриров',
    'отсутствует', 'не указан', 'не раскрыт'
  ]
  for (const marker of negativeMarkers) {
    const m = text.match(new RegExp(`[^.]*${marker}[^.]*\\.`, 'gi'))
    if (m) weaknesses.push(...m.slice(0, 1))
  }
  return [...new Set(weaknesses)].slice(0, 3)
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
    config.onLog?.('Генератор рубрик: не удалось разобрать JSON, создаётся рубрика по умолчанию', 'warning')
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
