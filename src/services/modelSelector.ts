import type { AiModel, RubricCriterion } from '../types'
import type { RawAiModel } from '../types/electron'

// ── Model description builder for LLM ─────────────────────────────────────────

export interface ModelDescription {
  fileName: string
  displayName: string
  sizeLabel: string
  capability: number
  suggestedUseCases: string[]
}

function inferSuggestedUseCases(model: AiModel): string[] {
  const cases: string[] = []
  const name = model.displayName.toLowerCase()
  const size = model.size / 1e9

  if (size >= 7) {
    cases.push('глубокий анализ текста', 'сложная аргументация', 'генерация текста')
  } else if (size >= 3) {
    cases.push('оценка студенческих работ', 'анализ по критериям', 'проверка структуры')
  } else {
    cases.push('быстрая проверка', 'простые формальные критерии', 'оформление')
  }

  if (name.includes('qwen') || name.includes(' llama')) {
    cases.push('логический анализ', 'резюмирование')
  }
  if (name.includes('math') || name.includes('code')) {
    cases.push('технические расчёты', 'программирование')
  }

  return cases
}

export function describeModel(model: AiModel): ModelDescription {
  return {
    fileName: model.fileName,
    displayName: model.displayName,
    sizeLabel: model.sizeLabel,
    capability: model.capability,
    suggestedUseCases: inferSuggestedUseCases(model)
  }
}

export function buildModelsDescription(models: AiModel[]): string {
  if (models.length === 0) return 'Модели не обнаружены.'

  const sorted = [...models].sort((a, b) => b.capability - a.capability)

  const lines: string[] = ['ДОСТУПНЫЕ МОДЕЛИ:']
  
  for (const m of sorted) {
    const desc = describeModel(m)
    lines.push(
      `\n${desc.displayName}`,
      `  Файл: ${desc.fileName}`,
      `  Размер: ${desc.sizeLabel} (~${desc.capability}/100 capability)`,
      `  Рекомендуется для: ${desc.suggestedUseCases.join(', ')}`
    )
  }

  return lines.join('\n')
}

export function findModelByName(models: AiModel[], fileName: string): AiModel | undefined {
  return models.find(m => 
    m.fileName === fileName || 
    m.displayName.toLowerCase() === fileName.toLowerCase()
  )
}

export function findClosestModel(models: AiModel[], targetCapability: number): AiModel {
  const sorted = [...models].sort((a, b) => b.capability - a.capability)
  let closest = sorted[0]
  let minDiff = Math.abs(closest.capability - targetCapability)

  for (const m of sorted) {
    const diff = Math.abs(m.capability - targetCapability)
    if (diff < minDiff) {
      minDiff = diff
      closest = m
    }
  }

  return closest
}

// ── Parsing ──────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`
  return `${bytes} B`
}

function formatDisplayName(fileName: string): string {
  return fileName
    .replace(/\.gguf$/i, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b(q\d+[_ ]?[a-z]+\d*|iq\d+[_ ]?[a-z]+\d*)\b/gi, '') // strip quant tags
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

// Architecture quality multiplier — known model families perform better at same size.
// Based on benchmarks (Open LLM Leaderboard, etc.)
const ARCHITECTURE_MULTIPLIER: Array<{ patterns: RegExp[]; multiplier: number }> = [
  { patterns: [/qwen2\.5/i, /qwen3/i], multiplier: 1.15 },     // Qwen2.5/3 — excellent across tasks
  { patterns: [/llama-?3[.\-]/i, /llama3[.\-]/i], multiplier: 1.12 }, // Llama-3 — strong improvement over Llama-2
  { patterns: [/llama-?3[.\-]*8b/i], multiplier: 1.14 },        // Llama-3 8B specifically
  { patterns: [/mistral/i, /mixtral/i], multiplier: 1.10 },     // Mistral/Mixtral — efficient
  { patterns: [/gemma-?2/i], multiplier: 1.08 },                // Gemma 2 — good for size
  { patterns: [/qwen2/i], multiplier: 1.08 },                   // Qwen2 — solid
  { patterns: [/phi-?3/i], multiplier: 1.10 },                  // Phi-3 — surprisingly capable
  { patterns: [/phi-?2/i], multiplier: 0.95 },                  // Phi-2 — weaker
  { patterns: [/llama-?2/i], multiplier: 0.92 },                // Llama-2 — older
  { patterns: [/llama/i], multiplier: 0.90 },                   // Llama-1 — oldest
  { patterns: [/yi/i], multiplier: 1.05 },                      // Yi — competitive
  { patterns: [/deepseek/i], multiplier: 1.08 },                // DeepSeek — strong coding
  { patterns: [/minicpm/i], multiplier: 1.02 },                 // MiniCPM — decent
  { patterns: [/internlm/i], multiplier: 1.02 },                // InternLM — average
  { patterns: [/baichuan/i], multiplier: 0.95 },                // Baichuan — slightly behind
  { patterns: [/falcon/i], multiplier: 0.93 },                  // Falcon — older
  { patterns: [/mpt/i], multiplier: 0.90 },                     // MPT — older
  { patterns: [/stablelm/i], multiplier: 0.90 },                // StableLM — weaker
  { patterns: [/vicuna/i], multiplier: 0.88 },                  // Vicuna — fine-tuned Llama-1
  { patterns: [/openhermes/i, /neuralhermes/i], multiplier: 1.05 }, // OpenHermes — fine-tuned Mistral
]

/**
 * Estimate capability 0–100 from file size AND model architecture.
 *
 * Uses size as base, then adjusts based on known architecture quality.
 * Rough guide: 3B ≈ 2 GB, 7B ≈ 4 GB, 13B ≈ 7 GB, 30B ≈ 18 GB, 70B ≈ 40 GB
 */
export function estimateCapability(sizeBytes: number, fileName?: string): number {
  const gb = sizeBytes / 1e9

  // Base capability from size
  let baseCapability: number
  if (gb >= 35) baseCapability = 100
  else if (gb >= 18) baseCapability = 90
  else if (gb >= 10) baseCapability = 80
  else if (gb >= 6)  baseCapability = 70
  else if (gb >= 3)  baseCapability = 58
  else if (gb >= 1.5) baseCapability = 46
  else baseCapability = 35

  if (!fileName) return Math.round(baseCapability)

  // Apply architecture multiplier
  for (const { patterns, multiplier } of ARCHITECTURE_MULTIPLIER) {
    if (patterns.some(p => p.test(fileName))) {
      const adjusted = baseCapability * multiplier
      return Math.round(Math.min(100, adjusted))
    }
  }

  return Math.round(baseCapability)
}

export function parseModels(raw: RawAiModel[]): AiModel[] {
  return raw
    .map((m) => ({
      ...m,
      sizeLabel: formatSize(m.size),
      displayName: formatDisplayName(m.fileName),
      capability: estimateCapability(m.size, m.fileName)
    }))
    .sort((a, b) => b.capability - a.capability) // most capable first
}

// ── Content analysis ──────────────────────────────────────────────────────────

export interface ContentAnalysis {
  /** 0–1: overall complexity of the work (sentence length + technical density) */
  complexity: number
  /** Dominant domain detected in the work */
  domain: 'technical' | 'humanities' | 'business' | 'mixed'
  /** True when STEM/technical markers dominate */
  hasTechnical: boolean
  /** True when humanities/social-science markers dominate */
  hasHumanities: boolean
  /** True when economic/business markers dominate */
  hasBusiness: boolean
  /** Total word count of the original text */
  wordCount: number
  /** Average sentence length in words */
  avgSentenceLen: number
}

/**
 * Analyses the student work to determine its domain, complexity and length.
 * Uses keyword matching on the first 8 000 chars — fast, no LLM required.
 */
export function analyzeContent(text: string): ContentAnalysis {
  const preview  = text.substring(0, 8000).toLowerCase()
  const words    = preview.split(/\s+/).filter((w) => w.length > 2)
  const sentences = text.substring(0, 8000).split(/[.!?]+/).filter((s) => s.trim().length > 10)
  const wordCount = text.split(/\s+/).filter(Boolean).length

  const techMarkers = [
    'алгоритм', 'функци', 'формул', 'уравнени', 'матриц', 'вектор',
    'программ', 'база данных', 'сервер', 'протокол', 'интерфейс', 'микроконтроллер',
    'реакци', 'молекул', 'атом', 'лаборатор', 'эксперимент',
    'теорем', 'доказательств', 'интеграл', 'производн', 'дифференциал',
    'нейронн', 'компилятор', 'архитектур', 'байт', 'процессор',
    'физическ', 'химическ', 'математическ', 'биологическ', 'технологическ'
  ]
  const humMarkers = [
    'общество', 'культур', 'историческ', 'философ', 'социальн',
    'политическ', 'психологическ', 'педагогическ', 'лингвистическ',
    'литератур', 'искусств', 'этическ', 'моральн', 'правов', 'юридическ',
    'гуманитарн', 'антропологи', 'религи', 'идеологи'
  ]
  const busMarkers = [
    'рынок', 'прибыль', 'доход', 'расход', 'бюджет', 'инвестиц',
    'маркетинг', 'менеджмент', 'предприяти', 'организаци', 'управлени',
    'бизнес', 'финансов', 'экономическ', 'конкурент', 'стратеги'
  ]

  const techHits = techMarkers.filter((m) => preview.includes(m)).length
  const humHits  = humMarkers.filter((m) => preview.includes(m)).length
  const busHits  = busMarkers.filter((m) => preview.includes(m)).length

  // Sentence complexity: longer sentences → more complex reasoning required
  const avgSentenceLen = sentences.length > 0 ? words.length / sentences.length : 15
  const sentComplexity = Math.min(1, avgSentenceLen / 25) // 25+ words/sentence → max

  // Technical density: more STEM markers → higher complexity
  const techDensity = Math.min(1, techHits / 4)

  const complexity = Math.min(1, sentComplexity * 0.5 + techDensity * 0.5)

  const hasTechnical  = techHits >= 2 && techHits >= humHits && techHits >= busHits
  const hasHumanities = humHits  >= 2 && humHits  > techHits && humHits  >= busHits
  const hasBusiness   = busHits  >= 2 && busHits  > techHits && busHits  > humHits

  let domain: ContentAnalysis['domain'] = 'mixed'
  if (hasTechnical)  domain = 'technical'
  else if (hasHumanities) domain = 'humanities'
  else if (hasBusiness)   domain = 'business'

  return { complexity, domain, hasTechnical, hasHumanities, hasBusiness, wordCount, avgSentenceLen }
}

// ── Criterion scoring (combines keyword analysis + content analysis) ───────────

/**
 * Returns 0–1 priority score for a criterion given the current content context.
 * Higher score → criterion needs more model capability.
 */
function criterionScore(criterion: RubricCriterion, content?: ContentAnalysis): number {
  const text = `${criterion.name} ${criterion.description}`.toLowerCase()

  // ── Base score from criterion keywords ────────────────────────────────────
  const highMarkers = [
    'оригинальность', 'уникальность', 'качество содержания', 'глубина',
    'аргументац', 'анализ', 'критическ', 'синтез', 'логик', 'концепц',
    'обоснован', 'теоретическ', 'научн', 'методолог'
  ]
  const lowMarkers = [
    'оформление', 'форматирование', 'грамотность',
    'соответствие требованиям', 'орфограф', 'пунктуац'
  ]

  const highHits = highMarkers.filter((k) => text.includes(k)).length
  const lowHits  = lowMarkers.filter((k) => text.includes(k)).length

  let base: number
  if (highHits > lowHits) base = Math.min(0.85, 0.55 + highHits * 0.1)
  else if (lowHits > highHits) base = Math.max(0.2, 0.45 - lowHits * 0.1)
  else base = 0.5

  if (!content) return base

  // ── Content-aware boosts ──────────────────────────────────────────────────
  let boost = 0

  // Technical works: quality/depth/analysis criteria require stronger models
  if (content.hasTechnical) {
    if (/качество|глубина|содержани|анализ|точность|методолог|правильность/.test(text)) boost += 0.15
    if (/корректность|обоснован|научн/.test(text)) boost += 0.10
  }

  // Humanities: argumentation, originality and style become critical
  if (content.hasHumanities) {
    if (/аргумент|логик|рассуждени|доказательств/.test(text)) boost += 0.12
    if (/оригинальн|авторск|стиль/.test(text)) boost += 0.10
  }

  // Business: conclusions, practical recommendations matter
  if (content.hasBusiness) {
    if (/вывод|рекоменд|практическ|применени/.test(text)) boost += 0.10
    if (/анализ|оценк|эффективн/.test(text)) boost += 0.08
  }

  // Long works: structure and logical flow are harder to evaluate
  if (content.wordCount > 3000) {
    if (/структур|логик|последовательн|связность/.test(text)) boost += 0.08
  }

  // Globally: complex content bumps all criteria slightly
  boost += content.complexity * 0.08

  return Math.min(0.95, base + boost)
}

// ── Assignment ────────────────────────────────────────────────────────────────

/**
 * Assigns models to criteria with content-aware scoring.
 *
 * Flow:
 *  1. Analyse fileContent (domain, complexity, length) — if provided.
 *  2. Score each criterion: base keyword complexity + content-aware boosts.
 *  3. Sort criteria by score DESC (most demanding first).
 *  4. Round-robin over models sorted by capability DESC.
 *
 * Guarantees every model is used when criteria.length >= models.length.
 * Best model handles the hardest criterion; lighter criteria → smaller/faster models.
 */
export function assignModels(
  models: AiModel[],
  criteria: RubricCriterion[],
  fileContent?: string
): Map<string, AiModel> {
  const sorted = [...models].sort((a, b) => b.capability - a.capability) // best first
  const assignment = new Map<string, AiModel>()

  if (sorted.length === 1) {
    for (const c of criteria) assignment.set(c.id, sorted[0])
    return assignment
  }

  const content = fileContent ? analyzeContent(fileContent) : undefined

  const byScore = [...criteria]
    .map((c) => ({ criterion: c, score: criterionScore(c, content) }))
    .sort((a, b) => b.score - a.score)

  for (let i = 0; i < byScore.length; i++) {
    assignment.set(byScore[i].criterion.id, sorted[i % sorted.length])
  }

  return assignment
}

// ── Summary helpers ───────────────────────────────────────────────────────────

/** Returns unique model names used in an assignment map */
export function uniqueModelNames(assignment: Map<string, AiModel>): string[] {
  return [...new Set([...assignment.values()].map((m) => m.displayName))]
}
