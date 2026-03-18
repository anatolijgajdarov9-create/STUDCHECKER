/**
 * RAG Knowledge Base — TF-IDF vector similarity over localStorage.
 *
 * Flow:
 *  1. After grading, call addToKnowledgeBase(result, content).
 *  2. Before grading, call findSimilar(content, 3) to inject past context.
 *  3. UI can call getKnowledgeBase() / deleteEntry() / clearKnowledgeBase().
 */

import type { AnalysisResult, RagEntry } from '../types'

const STORAGE_KEY = 'studchecker-rag-v1'
const MAX_ENTRIES = 200
const VECTOR_TOP_TERMS = 300
const IDF_KEY = 'studchecker-rag-idf-v1'

interface IDFStats {
  docFreq: Record<string, number>
  totalDocs: number
  lastUpdated: number
}

function getIDFStats(): IDFStats {
  try {
    const raw = localStorage.getItem(IDF_KEY)
    return raw ? JSON.parse(raw) : { docFreq: {}, totalDocs: 0, lastUpdated: 0 }
  } catch {
    return { docFreq: {}, totalDocs: 0, lastUpdated: 0 }
  }
}

function saveIDFStats(stats: IDFStats): void {
  try {
    localStorage.setItem(IDF_KEY, JSON.stringify(stats))
  } catch {}
}

function updateIDFForWord(word: string, increment: number, stats: IDFStats): void {
  stats.docFreq[word] = (stats.docFreq[word] || 0) + increment
}

function computeIDF(word: string, stats: IDFStats): number {
  const df = stats.docFreq[word] || 0
  if (df === 0) return 1
  return Math.log(stats.totalDocs / df)
}

function rebuildIDFStats(entries: RagEntry[]): IDFStats {
  const docFreq: Record<string, number> = {}
  let totalDocs = entries.length

  for (const entry of entries) {
    if (!entry.termVector) continue
    for (const word of Object.keys(entry.termVector)) {
      docFreq[word] = (docFreq[word] || 0) + 1
    }
  }

  const stats: IDFStats = { docFreq, totalDocs, lastUpdated: Date.now() }
  saveIDFStats(stats)
  return stats
}

// ── Reference examples by work type ────────────────────────────────────────────

interface ReferenceExample {
  workType: string
  criteria: string[]
  typicalMistakes: string[]
  goodPractice: string[]
  evaluationTips: string[]
}

const REFERENCE_EXAMPLES: ReferenceExample[] = [
  {
    workType: 'Реферат',
    criteria: ['Актуальность темы', 'Структура', 'Раскрытие темы', 'Оформление', 'Выводы'],
    typicalMistakes: [
      'Переписывание текста из одного источника',
      'Отсутствие анализа и обобщения материала',
      'Неправильное оформление списка литературы',
      'Отсутствие выводов или их формальность',
      'Несоответствие объёма требованиям'
    ],
    goodPractice: [
      'Использование 5+ разных источников',
      'Наличие сравнительного анализа точек зрения',
      'Чёткая структура с обоснованными выводами',
      'Собственные обобщения автора'
    ],
    evaluationTips: [
      'Проверить уникальность текста (плагиат)',
      'Оценить глубину раскрытия темы',
      'Проверить наличие анализа, а не только описания'
    ]
  },
  {
    workType: 'Курсовая работа',
    criteria: ['Актуальность', 'Цель и задачи', 'Теоретическая часть', 'Практическая часть', 'Оформление', 'Выводы'],
    typicalMistakes: [
      'Цель не соответствует задачам',
      'Теоретическая часть — пересказ учебника',
      'Отсутствие практической значимости',
      'Выводы не соответствуют задачам',
      'Слабая методологическая база'
    ],
    goodPractice: [
      'Чёткая формулировка цели и задач',
      'Критический анализ литературы',
      'Применение методов исследования',
      'Конкретные практические рекомендации'
    ],
    evaluationTips: [
      'Проверить логику: цель → задачи → выводы',
      'Оценить самостоятельность исследования',
      'Проверить наличие апробации результатов'
    ]
  },
  {
    workType: 'Лабораторная работа',
    criteria: ['Цель работы', 'Описание хода работы', 'Результаты', 'Выводы', 'Оформление'],
    typicalMistakes: [
      'Цель сформулирована некорректно',
      'Отсутствие промежуточных расчётов',
      'Выводы не соответствуют результатам',
      'Нарушение методики выполнения',
      'Отсутствие погрешностей измерений'
    ],
    goodPractice: [
      'Чёткая формулировка цели',
      'Подробное описание методики',
      'Таблицы и графики с результатами',
      'Выводы, вытекающие из данных'
    ],
    evaluationTips: [
      'Проверить правильность расчётов',
      'Оценить глубину анализа результатов',
      'Проверить соблюдение методики'
    ]
  },
  {
    workType: 'Эссе',
    criteria: ['Актуальность проблемы', 'Аргументация', 'Логика рассуждений', 'Стиль изложения', 'Выводы'],
    typicalMistakes: [
      'Отсутствие собственной позиции',
      'Пересказ чужих мыслей без анализа',
      'Логические противоречия',
      'Излишне формальный или разговорный стиль',
      'Отсутствие примера-иллюстрации'
    ],
    goodPractice: [
      'Чёткая авторская позиция',
      'Логичная структура аргументов',
      'Использование примеров из жизни/литературы',
      'Глубокий анализ проблемы'
    ],
    evaluationTips: [
      'Оценить оригинальность мысли',
      'Проверить наличие контраргументов',
      'Оценить глубину анализа'
    ]
  }
]

export function getReferenceExamples(workType: string): ReferenceExample | null {
  return REFERENCE_EXAMPLES.find(ex => 
    workType.toLowerCase().includes(ex.workType.toLowerCase())
  ) || null
}

export function buildReferenceContext(workType: string, rubricName: string): string {
  const ref = getReferenceExamples(workType)
  if (!ref) return ''

  const lines = [
    `\nСПРАВОЧНЫЙ МАТЕРИАЛ ПО ТИПУ РАБОТЫ "${ref.workType}":`,
    `\nТипичные ошибки в работах этого типа:`,
    ...ref.typicalMistakes.map(m => `  • ${m}`),
    `\nЧто характеризует качественную работу:`,
    ...ref.goodPractice.map(g => `  • ${g}`),
    `\nНа что обратить внимание при проверке:`,
    ...ref.evaluationTips.map(t => `  • ${t}`)
  ]

  return lines.join('\n')
}

// ── Stop words (Russian + common English) ────────────────────────────────────

const STOP_WORDS = new Set([
  'и', 'в', 'во', 'не', 'что', 'он', 'на', 'я', 'с', 'со', 'как', 'а', 'то', 'все',
  'она', 'так', 'его', 'но', 'да', 'ты', 'к', 'у', 'же', 'вы', 'за', 'бы', 'по',
  'только', 'ее', 'мне', 'было', 'вот', 'от', 'меня', 'еще', 'нет', 'о', 'из',
  'ему', 'теперь', 'когда', 'даже', 'ну', 'вдруг', 'ли', 'если', 'уже', 'или',
  'ни', 'быть', 'был', 'него', 'до', 'вас', 'нибудь', 'опять', 'уж', 'вам',
  'ведь', 'там', 'потом', 'себя', 'ничего', 'ей', 'может', 'они', 'тут', 'где',
  'есть', 'надо', 'ней', 'для', 'мы', 'тебя', 'их', 'чем', 'была', 'сам',
  'чтоб', 'без', 'будто', 'чего', 'раз', 'тоже', 'себе', 'под', 'будет', 'ж',
  'тогда', 'кто', 'этот', 'того', 'потому', 'этого', 'какой', 'совсем', 'ним',
  'здесь', 'этом', 'один', 'почти', 'мой', 'тем', 'чтобы', 'нее', 'сейчас',
  'были', 'куда', 'зачем', 'всех', 'никогда', 'можно', 'при', 'наконец', 'два',
  'об', 'другой', 'хоть', 'после', 'над', 'больше', 'тот', 'через', 'эти',
  'нас', 'про', 'всего', 'них', 'какая', 'много', 'разве', 'три', 'эту',
  'моя', 'впрочем', 'хорошо', 'свою', 'этой', 'перед', 'иногда', 'лучше',
  'чуть', 'том', 'нельзя', 'такой', 'им', 'более', 'всегда', 'конечно',
  'всю', 'между', 'the', 'is', 'in', 'it', 'of', 'and', 'to', 'a', 'an',
  'this', 'that', 'are', 'was', 'for', 'on', 'with', 'as', 'at', 'be',
])

// ── TF-IDF vector ────────────────────────────────────────────────────────────────

export function buildTermVector(text: string): Record<string, number> {
  const words = text
    .toLowerCase()
    .replace(/[^\wа-яёА-ЯЁ\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w))

  const freq: Record<string, number> = {}
  for (const w of words) freq[w] = (freq[w] || 0) + 1

  const total = Object.values(freq).reduce((s, v) => s + v, 0)
  if (total === 0) return {}

  const idfStats = getIDFStats()

  const tfidf: Record<string, number> = {}
  for (const [word, tf] of Object.entries(freq)) {
    const idf = idfStats.totalDocs > 0 ? computeIDF(word, idfStats) : 1
    tfidf[word] = (tf / total) * idf
  }

  return Object.fromEntries(
    Object.entries(tfidf).sort((a, b) => b[1] - a[1]).slice(0, VECTOR_TOP_TERMS)
  )
}

function cosineSimilarity(v1: Record<string, number>, v2: Record<string, number>): number {
  let dot = 0, mag1 = 0, mag2 = 0
  for (const [k, a] of Object.entries(v1)) {
    const b = v2[k] || 0
    dot += a * b
    mag1 += a * a
  }
  for (const b of Object.values(v2)) mag2 += b * b
  if (mag1 === 0 || mag2 === 0) return 0
  return dot / (Math.sqrt(mag1) * Math.sqrt(mag2))
}

// ── Work type detection ───────────────────────────────────────────────────────

function detectWorkType(fileName: string, rubricName: string, content: string): string {
  const combined = `${fileName} ${rubricName} ${content.substring(0, 500)}`.toLowerCase()
  if (/курсов|курсовая/.test(combined)) return 'Курсовая работа'
  if (/диплом|выпускн/.test(combined)) return 'Дипломная работа'
  if (/реферат/.test(combined)) return 'Реферат'
  if (/лаборатор|лаб\.?\s*раб/.test(combined)) return 'Лабораторная работа'
  if (/практическ/.test(combined)) return 'Практическая работа'
  if (/контрольн/.test(combined)) return 'Контрольная работа'
  if (/эссе/.test(combined)) return 'Эссе'
  if (/отчёт|отчет/.test(combined)) return 'Отчёт'
  if (/доклад/.test(combined)) return 'Доклад'
  return 'Учебная работа'
}

// ── Storage helpers ───────────────────────────────────────────────────────────

export function getKnowledgeBase(): RagEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as RagEntry[]) : []
  } catch {
    return []
  }
}

function saveKnowledgeBase(entries: RagEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // localStorage full — drop oldest entries
    const trimmed = entries.slice(0, Math.floor(entries.length / 2))
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed)) } catch {}
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function addToKnowledgeBase(result: AnalysisResult, content: string): void {
  const entries = getKnowledgeBase()

  // Avoid duplicates
  const existing = entries.findIndex((e) => e.id === result.id)
  if (existing !== -1) return

  const entry: RagEntry = {
    id: result.id,
    fileName: result.fileName,
    rubricName: result.rubricName,
    grade: result.grade,
    finalScore: result.finalScore,
    timestamp: result.timestamp,
    workType: detectWorkType(result.fileName, result.rubricName, content),
    contentSummary: content.substring(0, 1500),
    termVector: buildTermVector(content),
    criteriaResults: result.criteria.map((c) => ({
      name: c.criterionName,
      score: c.score,
      maxScore: c.maxScore,
      justification: c.justification.substring(0, 200)
    }))
  }

  const updated = [entry, ...entries].slice(0, MAX_ENTRIES)
  saveKnowledgeBase(updated)
  
  const allEntries = getKnowledgeBase()
  rebuildIDFStats(allEntries)
}

export interface SimilarEntry {
  entry: RagEntry
  similarity: number
}

export function findSimilar(content: string, topK = 3): SimilarEntry[] {
  const entries = getKnowledgeBase()
  if (entries.length === 0) return []

  const queryVec = buildTermVector(content)

  const scored = entries.map((entry) => ({
    entry,
    similarity: cosineSimilarity(queryVec, entry.termVector)
  }))

  return scored
    .filter((s) => s.similarity > 0.05) // threshold — skip unrelated
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK)
}

export function deleteEntry(id: string): void {
  const entries = getKnowledgeBase().filter((e) => e.id !== id)
  saveKnowledgeBase(entries)
  rebuildIDFStats(entries)
}

export function clearKnowledgeBase(): void {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(IDF_KEY)
}

export function getKnowledgeBaseStats(): {
  total: number
  workTypes: Record<string, number>
  avgScore: number
  byGrade: Record<string, number>
} {
  const entries = getKnowledgeBase()
  const workTypes: Record<string, number> = {}
  const byGrade: Record<string, number> = {}
  let scoreSum = 0

  for (const e of entries) {
    workTypes[e.workType] = (workTypes[e.workType] || 0) + 1
    byGrade[e.grade] = (byGrade[e.grade] || 0) + 1
    scoreSum += e.finalScore
  }

  return {
    total: entries.length,
    workTypes,
    avgScore: entries.length > 0 ? Math.round(scoreSum / entries.length) : 0,
    byGrade
  }
}

/**
 * Plagiarism check against KB using full-text cosine similarity on termVectors.
 * Returns all entries with similarity > 10%, sorted by descending match.
 */
export function checkRagPlagiarism(text: string): Array<{ entry: RagEntry; matchPercent: number }> {
  const entries = getKnowledgeBase()
  if (entries.length === 0) return []

  const queryVec = buildTermVector(text)
  if (Object.keys(queryVec).length === 0) return []

  const results: Array<{ entry: RagEntry; matchPercent: number }> = []
  for (const entry of entries) {
    // Guard: skip entries with missing or empty termVector (e.g. from old format)
    if (!entry.termVector || Object.keys(entry.termVector).length === 0) continue
    const sim = cosineSimilarity(queryVec, entry.termVector)
    const matchPercent = Math.round(sim * 100)
    if (matchPercent > 5) {
      results.push({ entry, matchPercent })
    }
  }
  return results.sort((a, b) => b.matchPercent - a.matchPercent)
}

/**
 * Build a context string from similar past works for LLM injection.
 */
export function buildRagContext(similar: SimilarEntry[]): string {
  if (similar.length === 0) return ''

  const lines: string[] = ['КОНТЕКСТ ИЗ БАЗЫ ЗНАНИЙ (похожие проверенные работы):']
  for (const { entry, similarity } of similar) {
    lines.push(
      `\n— Работа: «${entry.fileName}» (${entry.workType}), схожесть ${Math.round(similarity * 100)}%`,
      `  Рубрика: ${entry.rubricName}`,
      `  Итог: ${entry.finalScore}/100 (${entry.grade})`,
      ...entry.criteriaResults.map(
        (c) => `  • ${c.name}: ${c.score}/${c.maxScore} — ${c.justification}`
      )
    )
  }
  return lines.join('\n')
}

/**
 * Build complete context for LLM including reference examples and similar works.
 */
export function buildFullContext(
  similar: SimilarEntry[],
  workType: string,
  rubricName: string
): string {
  const parts: string[] = []

  const refContext = buildReferenceContext(workType, rubricName)
  if (refContext) parts.push(refContext)

  const ragContext = buildRagContext(similar)
  if (ragContext) parts.push(ragContext)

  return parts.join('\n')
}
