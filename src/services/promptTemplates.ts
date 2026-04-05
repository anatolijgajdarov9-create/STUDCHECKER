/**
 * Prompt Templates — централизованная система промпт-шаблонов.
 *
 * Адаптирует промпты под:
 *  - тип работы (реферат, курсовая, лаб. работа, эссе, диплом)
 *  - домен (technical / humanities / business / mixed)
 *  - сложность текста (0–1)
 *
 * Каждая оценка использует Chain-of-Thought + few-shot + domain-specific guidance.
 */

import type { RubricCriterion } from '../types'
import type { ContentAnalysis } from './modelSelector'

// ── Copy of detectWorkType here to avoid circular deps with ragService ────────
// (ragService imports from modelSelector, modelSelector imports from here would cycle)

const STOP_WORDS = new Set([
  'и', 'в', 'во', 'не', 'что', 'он', 'на', 'я', 'с', 'со', 'как', 'а', 'то', 'все',
  'она', 'так', 'его', 'но', 'да', 'ты', 'к', 'у', 'же', 'вы', 'за', 'бы', 'по',
  'the', 'is', 'in', 'it', 'of', 'and', 'to', 'a', 'an', 'this', 'that', 'are'
])

function tokenizeLight(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\wа-яёА-ЯЁ\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
}

// ── Domain-specific evaluation guidance ─────────────────────────────────────

interface DomainGuidance {
  /** What to look for in this domain */
  keyIndicators: string[]
  /** Common mistakes in this domain */
  typicalFlaws: string[]
  /** What distinguishes excellent work */
  excellenceMarkers: string[]
  /** Scoring tone calibration (lower = stricter) */
  strictnessMod: number
}

const DOMAIN_GUIDANCE: Record<string, DomainGuidance> = {
  technical: {
    keyIndicators: [
      'Корректность терминологии и формул',
      'Правильность алгоритмических описаний',
      'Наличие расчётов и обоснований',
      'Соответствие методологии',
      'Практическая реализуемость'
    ],
    typicalFlaws: [
      'Неверное применение формул',
      'Отсутствие пояснений к расчётам',
      'Противоречия в алгоритмах',
      'Копирование кода/формулы без понимания',
      'Отсутствие единиц измерения'
    ],
    excellenceMarkers: [
      'Собственные модификации алгоритмов',
      'Сравнение нескольких методов',
      'Анализ погрешностей',
      'Оптимизация и обоснование выбора подхода'
    ],
    strictnessMod: -0.3 // Технические работы — строже
  },
  humanities: {
    keyIndicators: [
      'Глубина анализа источников',
      'Наличие авторской позиции',
      'Аргументированность выводов',
      'Использование первоисточников',
      'Связность и логика изложения'
    ],
    typicalFlaws: [
      'Пересказ без анализа',
      'Отсутствие собственной позиции',
      'Поверхностное использование источников',
      'Логические противоречия',
      'Подмена аргументов эмоциями'
    ],
    excellenceMarkers: [
      'Критический анализ нескольких точек зрения',
      'Оригинальная авторская позиция',
      'Использование редких/первоисточников',
      'Междисциплинарный подход'
    ],
    strictnessMod: 0 // Стандартная строгость
  },
  business: {
    keyIndicators: [
      'Обоснованность экономических расчётов',
      'Практическая значимость рекомендаций',
      'Анализ рынка/конкурентов',
      'Реалистичность выводов',
      'Использование актуальных данных'
    ],
    typicalFlaws: [
      'Устаревшие статистические данные',
      'Нереалистичные финансовые прогнозы',
      'Отсутствие анализа рисков',
      'Рекомендации без обоснования',
      'Игнорирование конкурентной среды'
    ],
    excellenceMarkers: [
      'Детальный финансовый план',
      'Анализ чувствительности/рисков',
      'Конкретные KPI и метрики',
      'SWOT/PEST-анализ'
    ],
    strictnessMod: -0.15
  },
  mixed: {
    keyIndicators: [
      'Сбалансированность теоретической и практической частей',
      'Междисциплинарные связи',
      'Логичность структуры',
      'Качество выводов'
    ],
    typicalFlaws: [
      'Дисбаланс между разделами',
      'Слабая связь между частями работы',
      'Формальные выводы'
    ],
    excellenceMarkers: [
      'Интеграция подходов из разных областей',
      'Комплексный анализ проблемы',
      'Практические рекомендации с обоснованием'
    ],
    strictnessMod: -0.1
  }
}

// ── Work-type specific scoring instructions ──────────────────────────────────

interface WorkTypeInstructions {
  /** Extra system instruction appended to every criterion prompt */
  extraInstruction: string
  /** Score scale description for the model */
  scoreScale: string
  /** What to prioritize when scoring */
  priority: string
}

const WORK_TYPE_INSTRUCTIONS: Record<string, WorkTypeInstructions> = {
  'Реферат': {
    extraInstruction:
      'Оценивай работу как РЕФЕРАТ. Ключевое: использование нескольких источников, ' +
      'наличие анализа (не просто пересказ), правильное оформление ссылок, ' +
      'самостоятельность изложения. Снижай балл за переписывание одного источника.',
    scoreScale: 'Для реферата 8-10/10 = отличный анализ 5+ источников, 5-7 = хороший пересказ, 3-4 = поверхностный, 1-2 = переписывание',
    priority: 'Проверь глубину анализа и разнообразие источников'
  },
  'Курсовая работа': {
    extraInstruction:
      'Оценивай работу как КУРСОВУЮ РАБОТУ. Ключевое: чёткая цель и задачи, ' +
      'теоретическая база, самостоятельное исследование/анализ, ' +
      'практическая значимость, соответствие выводов задачам.',
    scoreScale: 'Для курсовой 8-10/10 = полноценное исследование, 5-7 = хороший анализ без практики, 3-4 = теоретический пересказ, 1-2 = незавершённая',
    priority: 'Проверь логику: цель → задачи → методы → результаты → выводы'
  },
  'Лабораторная работа': {
    extraInstruction:
      'Оценивай работу как ЛАБОРАТОРНУЮ РАБОТУ. Ключевое: правильность методики, ' +
      'точность расчётов, наличие результатов, корректность выводов, ' +
      'учёт погрешностей.',
    scoreScale: 'Для лаб. работы 8-10/10 = точные расчёты + анализ, 5-7 = верные результаты без глубокого анализа, 3-4 = ошибки в расчётах, 1-2 = незавершённая',
    priority: 'Проверь правильность расчётов и соответствие результатов выводам'
  },
  'Эссе': {
    extraInstruction:
      'Оценивай работу как ЭССЕ. Ключевое: оригинальность мысли, чёткая авторская позиция, ' +
      'аргументация, стиль изложения, использование примеров.',
    scoreScale: 'Для эссе 8-10/10 = оригинальная позиция с сильными аргументами, 5-7 = хорошая позиция с типовыми аргументами, 3-4 = слабая аргументация, 1-2 = отсутствие позиции',
    priority: 'Оцени оригинальность мысли и силу аргументации'
  },
  'Дипломная работа': {
    extraInstruction:
      'Оценивай работу как ДИПЛОМНУЮ (ВКР). Ключевое: научная новизна, ' +
      'глубина исследования, методологическая база, апробация результатов, ' +
      'публикации/акты внедрения.',
    scoreScale: 'Для ВКР 8-10/10 = полноценное исследование с новизной, 5-7 = хороший обзор без новизны, 3-4 = компиляция, 1-2 = слабая работа',
    priority: 'Проверь научную новизну и методологическую строгость'
  },
  'Контрольная работа': {
    extraInstruction:
      'Оценивай работу как КОНТРОЛЬНУЮ РАБОТУ. Ключевое: правильность ответов, ' +
      'полнота раскрытия вопросов, самостоятельность.',
    scoreScale: 'Для контрольной 8-10/10 = полные правильные ответы, 5-7 = частичные, 3-4 = поверхностные, 1-2 = неверные',
    priority: 'Проверь правильность и полноту ответов на вопросы'
  }
}

// ── Criterion-category-specific prompts ──────────────────────────────────────
// Maps criterion name keywords to domain-adapted prompt templates.

interface CriterionCategory {
  /** Keywords that match this category (regex fragments) */
  keywords: string[]
  /** Prompt template — {criterion}, {maxScore}, {description}, {domainGuidance}, {workTypeInstruction} */
  promptTemplate: string
}

const CATEGORIES: CriterionCategory[] = [
  {
    keywords: ['оригинальн', 'уникальн', 'плагиат', 'самостоятел'],
    promptTemplate: `КРИТЕРИЙ: {criterion} (максимум {maxScore} баллов)
Описание: {description}

{workTypeInstruction}

ЗАДАНИЕ: Оцени САМОСТОЯТЕЛЬНОСТЬ и ОРИГИНАЛЬНОСТЬ работы.
Проверь:
1. Есть ли собственные мысли/выводы автора (не просто пересказ)?
2. Насколько текст уникален (не похож на типовые формулировки)?
3. Есть ли собственный анализ, а не компиляция источников?
4. Использует ли автор разные источники или один?

{domainGuidance}

Выстави оценку от 0 до {maxScore}.`
  },
  {
    keywords: ['структур', 'логик', 'последователь', 'связн'],
    promptTemplate: `КРИТЕРИЙ: {criterion} (максимум {maxScore} баллов)
Описание: {description}

{workTypeInstruction}

ЗАДАНИЕ: Оцени СТРУКТУРУ и ЛОГИКУ изложения.
Проверь:
1. Есть ли чёткая структура (введение → основная часть → заключение)?
2. Логично ли связаны разделы между собой?
3. Нет ли внутренних противоречий?
4. Есть ли переходы между абзацами и разделами?
5. Соответствуют ли выводы поставленным целям (если есть)?

{domainGuidance}

Выстави оценку от 0 до {maxScore}.`
  },
  {
    keywords: ['раскрыт', 'содержан', 'глубин', 'анализ', 'аргумент', 'качеств'],
    promptTemplate: `КРИТЕРИЙ: {criterion} (максимум {maxScore} баллов)
Описание: {description}

{workTypeInstruction}

ЗАДАНИЕ: Оцени ГЛУБИНУ и КАЧЕСТВО раскрытия темы.
Проверь:
1. Насколько полно раскрыта тема?
2. Есть ли анализ, а не просто описание фактов?
3. Используются ли аргументы и доказательства?
4. Есть ли сравнение разных точек зрения?
5. Приведены ли конкретные примеры, данные, ссылки на источники?

{domainGuidance}

Выстави оценку от 0 до {maxScore}.`
  },
  {
    keywords: ['оформлен', 'формат', 'грамотн', 'орфограф', 'пунктуац', 'стиль'],
    promptTemplate: `КРИТЕРИЙ: {criterion} (максимум {maxScore} баллов)
Описание: {description}

{workTypeInstruction}

ЗАДАНИЕ: Оцени ОФОРМЛЕНИЕ и ГРАМОТНОСТЬ.
Проверь:
1. Соответствует ли оформление стандартным требованиям?
2. Правильно ли оформлены ссылки и список литературы?
3. Есть ли грубые орфографические/пунктуационные ошибки?
4. Соответствует ли стиль академическому?
5. Есть ли форматирование (заголовки, абзацы)?

{domainGuidance}

Выстави оценку от 0 до {maxScore}.`
  },
  {
    keywords: ['актуальн', 'тем', 'выбор', 'значим'],
    promptTemplate: `КРИТЕРИЙ: {criterion} (максимум {maxScore} баллов)
Описание: {description}

{workTypeInstruction}

ЗАДАНИЕ: Оцени АКТУАЛЬНОСТЬ и ОБОСНОВАННОСТЬ выбора темы.
Проверь:
1. Обоснована ли актуальность темы во введении?
2. Насколько тема значима в современном контексте?
3. Есть ли ссылки на современные источники (последние 5 лет)?
4. Указаны ли причины и мотивация выбора темы?

{domainGuidance}

Выстави оценку от 0 до {maxScore}.`
  },
  {
    keywords: ['вывод', 'заключен', 'результат', 'рекомендац'],
    promptTemplate: `КРИТЕРИЙ: {criterion} (максимум {maxScore} баллов)
Описание: {description}

{workTypeInstruction}

ЗАДАНИЕ: Оцени КАЧЕСТВО ВЫВОДОВ и РЕЗУЛЬТАТОВ.
Проверь:
1. Сформулированы ли чёткие выводы?
2. Соответствуют ли выводы поставленным целям/задачам?
3. Есть ли обобщение основных положений?
4. Содержат ли выводы рекомендации/перспективы?
5. Не являются ли выводы формальными/шаблонными?

{domainGuidance}

Выстави оценку от 0 до {maxScore}.`
  },
  {
    keywords: ['цел', 'задач', 'метод', 'исследован', 'практическ'],
    promptTemplate: `КРИТЕРИЙ: {criterion} (максимум {maxScore} баллов)
Описание: {description}

{workTypeInstruction}

ЗАДАНИЕ: Оцени МЕТОДОЛОГИЮ и ПРАКТИЧЕСКУЮ ЧАСТЬ.
Проверь:
1. Чётко ли сформулированы цель и задачи?
2. Выбраны ли адекватные методы исследования?
3. Есть ли практическая часть/расчёты/эксперимент?
4. Соответствуют ли результаты поставленным задачам?
5. Есть ли анализ полученных результатов?

{domainGuidance}

Выстави оценку от 0 до {maxScore}.`
  }
]

const DEFAULT_PROMPT_TEMPLATE = `КРИТЕРИЙ: {criterion} (максимум {maxScore} баллов)
Описание: {description}

{workTypeInstruction}

ЗАДАНИЕ: Оцени работу по данному критерию.
Проверь:
1. Насколько полно выполнен данный критерий?
2. Есть ли существенные недостатки?
3. Что сделано особенно хорошо?
4. Какие рекомендации по улучшению?

{domainGuidance}

Выстави оценку от 0 до {maxScore}.`

// ── Domain-adapted few-shot examples ─────────────────────────────────────────

interface DomainFewShot {
  domain: string
  workExcerpt: string
  score: number
  maxScore: number
  justification: string
  recommendations: string
}

const DOMAIN_FEW_SHOT: DomainFewShot[] = [
  // TECHNICAL — отлично
  {
    domain: 'technical',
    workExcerpt: 'Для решения задачи использован метод Рунге-Кутты 4-го порядка. Погрешность на каждом шаге составляет O(h⁴). Проведено сравнение с методом Эйлера: максимальная относительная погрешность 0.3%. Результаты представлены в таблице 1 и на рисунке 2.',
    score: 9,
    maxScore: 10,
    justification: 'Работа демонстрирует глубокое понимание численных методов. Приведены конкретные расчёты, оценка погрешности, сравнение методов. Результаты визуализированы.',
    recommendations: 'Для совершенства: добавить анализ устойчивости метода и вычислительной сложности.'
  },
  // TECHNICAL — посредственно
  {
    domain: 'technical',
    workExcerpt: 'Программа написана на языке Python. Использованы библиотеки numpy и pandas. Результат показан на экране.',
    score: 4,
    maxScore: 10,
    justification: 'Описание крайне поверхностное. Отсутствуют алгоритм, блок-схема, тестирование, оценка сложности. Нет объяснения выбора библиотек.',
    recommendations: 'Добавить алгорит, тестовые примеры, оценку сложности, обоснование выбора инструмента.'
  },
  // HUMANITIES — отлично
  {
    domain: 'humanities',
    workExcerpt: 'Анализируя позиции Иванова И.И. (2023) и Петрова П.П. (2022), можно отметить расхождение в трактовке причин реформы 1861 года. Иванов акцентирует экономические факторы, тогда как Петров — политическое давление. На мой взгляд, обе позиции дополняют друг друга, что подтверждается архивными материалами.',
    score: 9,
    maxScore: 10,
    justification: 'Автор демонстрирует критическое мышление: сравнивает точки зрения, формулирует собственную позицию, подкрепляет её дополнительными источниками.',
    recommendations: 'Можно усилить анализ привлечением зарубежных исследований по теме.'
  },
  // HUMANITIES — посредственно
  {
    domain: 'humanities',
    workExcerpt: 'Реформа 1861 года была важна для России. Она отменила крепостное право. Крестьяне стали свободными. Это было хорошее решение.',
    score: 3,
    maxScore: 10,
    justification: 'Текст представляет собой набор трюизмов без анализа. Отсутствуют источники, аргументация, глубина. Автор не демонстрирует понимания исторического контекста.',
    recommendations: 'Изучить историографию вопроса. Добавить анализ причин, хода и последствий реформы. Использовать минимум 5 источников.'
  },
  // BUSINESS — отлично
  {
    domain: 'business',
    workExcerpt: 'NPV проекта составляет 2.3 млн руб. при ставке дисконтирования 12%. Срок окупаемости — 3.2 года. Анализ чувствительности показал, что при снижении объёма продаж на 15% проект остаётся рентабельным (NPV > 0). Основной риск — изменение налогового законодательства.',
    score: 9,
    maxScore: 10,
    justification: 'Финансовый анализ проведён на высоком уровне: расчёт NPV, срок окупаемости, анализ чувствительности, идентификация рисков.',
    recommendations: 'Добавить сценарный анализ (оптимистичный/пессимистичный) и план митигации рисков.'
  }
]

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Detects the work type from file name + rubric + content (with confidence).
 */
export function detectWorkTypeWithConfidence(
  fileName: string,
  rubricName: string,
  content: string
): { workType: string; confidence: number } {
  const combined = `${fileName} ${rubricName} ${content.substring(0, 500)}`.toLowerCase()

  const patterns: Array<{ type: string; patterns: RegExp[] }> = [
    { type: 'Курсовая работа', patterns: [/курсов/, /курсовая/] },
    { type: 'Дипломная работа', patterns: [/диплом/, /выпускн/, /вкр/] },
    { type: 'Реферат', patterns: [/реферат/] },
    { type: 'Лабораторная работа', patterns: [/лаборатор/, /лаб\.?\s*раб/, /лаб\.?\s*работ/] },
    { type: 'Практическая работа', patterns: [/практическ/] },
    { type: 'Контрольная работа', patterns: [/контрольн/] },
    { type: 'Эссе', patterns: [/эссе/] },
    { type: 'Отчёт', patterns: [/отчёт/, /отчет/] },
    { type: 'Доклад', patterns: [/доклад/] },
  ]

  let bestType = 'Учебная работа'
  let bestConfidence = 0

  for (const { type, patterns: pats } of patterns) {
    for (const pat of pats) {
      const m = combined.match(pat)
      if (m) {
        const confidence = Math.min(0.95, 0.6 + m[0].length * 0.05)
        if (confidence > bestConfidence) {
          bestType = type
          bestConfidence = confidence
        }
      }
    }
  }

  return { workType: bestType, confidence: bestConfidence }
}

/**
 * Builds a domain-adapted prompt for a given criterion.
 */
export function buildCriterionPrompt(
  criterion: RubricCriterion,
  workType: string,
  contentAnalysis: ContentAnalysis,
  fileContent: string
): string {
  const domain = contentAnalysis.domain
  const guidance = DOMAIN_GUIDANCE[domain] || DOMAIN_GUIDANCE.mixed
  const wtInstr = WORK_TYPE_INSTRUCTIONS[workType]

  // Find matching category
  const catName = criterion.name.toLowerCase()
  let template = DEFAULT_PROMPT_TEMPLATE
  for (const cat of CATEGORIES) {
    if (cat.keywords.some(kw => catName.includes(kw))) {
      template = cat.promptTemplate
      break
    }
  }

  const domainGuidanceText = [
    ...guidance.keyIndicators.map(k => `  ✓ Ключевой индикатор: ${k}`),
    ...guidance.excellenceMarkers.slice(0, 2).map(e => `  ★ Маркер отличной работы: ${e}`),
    ...guidance.typicalFlaws.slice(0, 2).map(f => `  ⚠ Типичный дефект: ${f}`)
  ].join('\n')

  const wtInstruction = wtInstr
    ? `${wtInstr.extraInstruction}\n${wtInstr.scoreScale}\nПриоритет: ${wtInstr.priority}`
    : ''

  const preview = fileContent.substring(0, 2000)

  return `${template}

ПРОВЕРЯЕМЫЙ ТЕКСТ:
${preview}

ДОПОЛНИТЕЛЬНЫЙ КОНТЕКСТ:
${domainGuidanceText}`
}

/**
 * Returns domain-relevant few-shot examples for a criterion.
 */
export function getDomainFewShotExamples(
  domain: string,
  criterionName: string,
  count = 2
): DomainFewShot[] {
  // First try domain + keyword match
  const keyword = criterionName.split(/\s+/)[0].toLowerCase()
  const relevant = DOMAIN_FEW_SHOT.filter(ex =>
    ex.domain === domain
  )

  if (relevant.length > 0) {
    // Return diverse examples (different score levels)
    const sorted = relevant.sort((a, b) => b.score - a.score)
    return sorted.slice(0, Math.min(count, sorted.length))
  }

  // Fallback: any examples
  return DOMAIN_FEW_SHOT.slice(0, count)
}

/**
 * Builds the full system prompt prefix for LLM evaluation.
 * Combines domain guidance + work-type instructions + scoring scale.
 */
export function buildSystemPrompt(
  domain: string,
  workType: string
): string {
  const guidance = DOMAIN_GUIDANCE[domain] || DOMAIN_GUIDANCE.mixed
  const wtInstr = WORK_TYPE_INSTRUCTIONS[workType]

  const parts: string[] = []

  parts.push('Ты — строгий и объективный эксперт по проверке студенческих работ.')
  parts.push(`Домен работы: ${domain === 'technical' ? 'технический/STEM' : domain === 'humanities' ? 'гуманитарный' : domain === 'business' ? 'экономический/бизнес' : 'смешанный'}.`)

  if (wtInstr) {
    parts.push(`Тип работы: ${workType}.`)
    parts.push(wtInstr.extraInstruction)
  }

  parts.push(`\nКлючевые индикаторы качества для этого домена:`)
  for (const ind of guidance.keyIndicators) {
    parts.push(`  • ${ind}`)
  }

  parts.push(`\nТипичные ошибки, которые стоит искать:`)
  for (const flaw of guidance.typicalFlaws) {
    parts.push(`  ⚠ ${flaw}`)
  }

  parts.push('\nБудь строг, но справедлив. Не завышай оценки — лучше указать на недостатки, чем пропустить их.')

  return parts.join('\n')
}

/**
 * Returns reference examples for a work type.
 * Inlined to avoid circular deps — the actual examples are in ragService.
 */
export function getWorkTypeReference(workType: string): ReferenceExample | null {
  const ref = REFERENCE_EXAMPLES.find(ex =>
    workType.toLowerCase().includes(ex.workType.toLowerCase())
  ) || null
  return ref
}

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

/**
 * Calculates the optimal temperature for a criterion based on complexity and domain.
 * Lower for technical (need precision), slightly higher for humanities (need creativity).
 */
export function getOptimalTemperature(
  domain: string,
  complexity: number,
  baseTemp = 0.1
): number {
  const domainMod: Record<string, number> = {
    technical: -0.05,
    humanities: 0.05,
    business: 0,
    mixed: 0
  }

  const complexityMod = complexity > 0.6 ? 0.05 : -0.02
  const t = baseTemp + (domainMod[domain] || 0) + complexityMod
  return Math.max(0.05, Math.min(0.3, t))
}

/**
 * Determines the optimal maxTokens for a criterion response.
 */
export function getOptimalMaxTokens(
  criterionName: string,
  complexity: 'low' | 'medium' | 'high'
): number {
  const needsDetail = /обоснован|анализ|качеств|содержан|аргумент|раскрыт/i.test(criterionName)
  if (needsDetail || complexity === 'high') return 500
  if (complexity === 'medium') return 400
  return 300
}

/**
 * Builds a scoring scale reference string for injection into prompts.
 */
export function buildScoreScale(maxScore: number, workType: string): string {
  const wt = WORK_TYPE_INSTRUCTIONS[workType]?.scoreScale
  const scale = wt || `${maxScore * 0.9}-${maxScore}/10 = отлично, ${maxScore * 0.7}-${maxScore * 0.9} = хорошо, ${maxScore * 0.5}-${maxScore * 0.7} = удовлетворительно, ниже ${maxScore * 0.5} = неудовлетворительно`

  return `ШКАЛА ОЦЕНКИ:\n${scale}`
}
