/**
 * Scoring Normalizer — межкритериальная нормализация оценок.
 *
 * Проблема: 8b модели склонны завышать или занижать оценки в зависимости
 * от формулировки промпта и домена. Нормализация выравнивает распределение
 * оценок по критериям, используя z-score и обнаружение выбросов.
 *
 * Flow:
 *  1. Собрать все сырые оценки критериев
 *  2. Обнаружить выбросы (IQR method)
 *  3. Применить z-score нормализацию если распределение широкое
 *  4. Вернуть скорректированные оценки с флагами
 */

import type { CriterionResult, RubricCriterion } from '../types'

// ── Statistics utilities ─────────────────────────────────────────────────────

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((s, v) => s + v, 0) / values.length
}

function stdDev(values: number[]): number {
  const m = mean(values)
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

function iqr(values: number[]): { q1: number; q3: number; iqr: number } {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const lower = sorted.slice(0, mid)
  const upper = sorted.slice(mid + (sorted.length % 2 === 0 ? 0 : 1))
  const q1 = median(lower.length > 0 ? lower : sorted)
  const q3 = median(upper.length > 0 ? upper : sorted)
  return { q1, q3, iqr: q3 - q1 }
}

// ── Outlier detection ────────────────────────────────────────────────────────

export interface OutlierInfo {
  criterionName: string
  originalScore: number
  normalizedScore: number
  zScore: number
  isOutlier: boolean
  outlierDirection: 'high' | 'low' | null
  adjustment: number
}

/**
 * Detects outliers using IQR method and computes z-scores.
 */
export function detectOutliers(results: CriterionResult[]): OutlierInfo[] {
  if (results.length < 3) {
    return results.map(r => ({
      criterionName: r.criterionName,
      originalScore: r.score,
      normalizedScore: r.score,
      zScore: 0,
      isOutlier: false,
      outlierDirection: null,
      adjustment: 0
    }))
  }

  const normalizedScores = results.map(r => r.score / r.maxScore)
  const m = mean(normalizedScores)
  const sd = stdDev(normalizedScores)
  const { q1, q3, iqr: iqrVal } = iqr(normalizedScores)

  const lowerBound = q1 - 1.5 * iqrVal
  const upperBound = q3 + 1.5 * iqrVal

  return results.map((r, i) => {
    const ns = normalizedScores[i]
    const zScore = sd > 0 ? (ns - m) / sd : 0
    const isOutlier = ns < lowerBound || ns > upperBound
    const direction: 'high' | 'low' | null =
      ns > upperBound ? 'high' : ns < lowerBound ? 'low' : null

    // Shrink outlier scores toward the mean (gentle correction)
    let adjustment = 0
    if (isOutlier && direction === 'high') {
      adjustment = (upperBound - ns) * 0.5 // Pull halfway toward boundary
    } else if (isOutlier && direction === 'low') {
      adjustment = (lowerBound - ns) * 0.5
    }

    const adjustedScore = Math.max(0, Math.min(1, ns + adjustment))
    const normalizedScore = Math.round(adjustedScore * r.maxScore)

    return {
      criterionName: r.criterionName,
      originalScore: r.score,
      normalizedScore,
      zScore: Math.round(zScore * 100) / 100,
      isOutlier,
      outlierDirection: direction,
      adjustment: Math.round(adjustment * 100) / 100
    }
  })
}

// ── Score distribution analysis ──────────────────────────────────────────────

export interface DistributionInfo {
  mean: number
  median: number
  stdDev: number
  min: number
  max: number
  range: number
  skewness: 'left' | 'right' | 'symmetric'
  isBalanced: boolean // true when stdDev < 0.15 (scores are close)
}

export function analyzeDistribution(results: CriterionResult[]): DistributionInfo {
  const scores = results.map(r => r.score / r.maxScore)
  const m = mean(scores)
  const md = median(scores)
  const sd = stdDev(scores)
  const min = Math.min(...scores)
  const max = Math.max(...scores)

  // Skewness: mean > median → right skew (tail to high), mean < median → left
  const skewness = m > md + 0.05 ? 'right' : m < md - 0.05 ? 'left' : 'symmetric'
  const isBalanced = sd < 0.15

  return {
    mean: Math.round(m * 100) / 100,
    median: Math.round(md * 100) / 100,
    stdDev: Math.round(sd * 1000) / 1000,
    min: Math.round(min * 100) / 100,
    max: Math.round(max * 100) / 100,
    range: Math.round((max - min) * 100) / 100,
    skewness,
    isBalanced
  }
}

// ── Normalization ─────────────────────────────────────────────────────────────

export interface NormalizedResult {
  result: CriterionResult
  outlierInfo?: OutlierInfo
  warning?: string
}

/**
 * Normalizes criterion scores using z-score + IQR outlier detection.
 *
 * Only adjusts if:
 *  - At least 3 criteria (need distribution)
 *  - Standard deviation > 0.1 (scores are spread out)
 *  - Outliers are detected
 *
 * Returns original results with optional adjustments and warnings.
 */
export function normalizeScores(
  results: CriterionResult[],
  criteria: RubricCriterion[]
): NormalizedResult[] {
  if (results.length < 3) {
    return results.map(r => ({ result: r }))
  }

  const distribution = analyzeDistribution(results)
  const outliers = detectOutliers(results)

  // Don't normalize if scores are already balanced
  if (distribution.isBalanced) {
    return results.map(r => ({ result: r }))
  }

  return results.map((r, i) => {
    const outlier = outliers[i]
    if (!outlier.isOutlier) {
      return { result: r }
    }

    // Create adjusted result
    const adjusted: CriterionResult = {
      ...r,
      score: outlier.normalizedScore,
      normalizedScore: Math.round((outlier.normalizedScore / r.maxScore) * 1000) / 10,
      weightedScore: Math.round(
        (outlier.normalizedScore / r.maxScore) * (r.weight / 100) * 10
      ) / 10,
      justification: r.justification +
        `\n\n⚠️ Оценка скорректирована: исходная ${r.score}/${r.maxScore} → ${outlier.normalizedScore}/${r.maxScore} ` +
        `(z-score: ${outlier.zScore}, выброс ${outlier.outlierDirection === 'high' ? 'завышен' : 'занижен'})`
    }

    return {
      result: adjusted,
      outlierInfo: outlier,
      warning: `Критерий "${r.criterionName}": оценка ${r.score}/${r.maxScore} является выбросом (${outlier.outlierDirection}). ` +
        `Скорректировано до ${outlier.normalizedScore}/${r.maxScore}.`
    }
  })
}

// ── Consistency score ────────────────────────────────────────────────────────

/**
 * Returns 0–100 consistency score for the overall evaluation.
 * Higher = more consistent (scores follow expected distribution).
 */
export function consistencyScore(results: CriterionResult[]): number {
  if (results.length < 3) return 100 // Too few to judge

  const { stdDev: sd, isBalanced } = analyzeDistribution(results)
  const outliers = detectOutliers(results)
  const outlierCount = outliers.filter(o => o.isOutlier).length

  // Base score: lower stdDev → higher consistency
  let score = 100 - sd * 200 // sd=0.2 → 60, sd=0.4 → 20
  score -= outlierCount * 15 // Each outlier costs 15 points
  if (!isBalanced) score -= 10

  return Math.max(0, Math.min(100, Math.round(score)))
}

// ── Summary report ───────────────────────────────────────────────────────────

export interface NormalizationReport {
  distribution: DistributionInfo
  outliers: OutlierInfo[]
  consistencyScore: number
  adjustments: number // number of adjusted scores
  warnings: string[]
}

export function buildNormalizationReport(
  results: CriterionResult[],
  criteria: RubricCriterion[]
): NormalizationReport {
  const normalized = normalizeScores(results, criteria)
  const distribution = analyzeDistribution(results)
  const outliers = detectOutliers(results)
  const warnings = normalized.map(n => n.warning).filter(Boolean) as string[]

  return {
    distribution,
    outliers,
    consistencyScore: consistencyScore(results),
    adjustments: normalized.filter(n => n.outlierInfo).length,
    warnings
  }
}
