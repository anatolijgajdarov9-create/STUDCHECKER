export interface Model {
  id: string
  name?: string
  object?: string
}

export interface RubricCriterion {
  id: string
  name: string
  weight: number
  maxScore: number
  description: string
}

export interface Rubric {
  id: string
  name: string
  criteria: RubricCriterion[]
}

export interface CriterionResult {
  criterionName: string
  weight: number
  score: number
  maxScore: number
  normalizedScore: number
  weightedScore: number
  justification: string
  recommendations: string
  strengths: string[]
  weaknesses: string[]
}

export interface AnalysisResult {
  id: string
  fileName: string
  timestamp: string
  rubricName: string
  modelUsed: string
  finalScore: number
  grade: string
  gradeDescription: string
  criteria: CriterionResult[]
  sourcesUsed?: string[]
  summaryComment?: string
}

export interface PlanItem {
  criterion: string
  prompt: string
  maxScore: number
}

export type LogType = 'info' | 'success' | 'error' | 'warning'

export interface LogEntry {
  id: string
  time: string
  message: string
  type: LogType
}

export type ExpertStepStatus = 'pending' | 'loading' | 'running' | 'completed' | 'error'

export interface ExpertStep {
  id: string
  name: string
  status: ExpertStepStatus
  score?: number
  maxScore?: number
  modelName?: string
}

export interface AiModel {
  fileName: string
  path: string
  size: number
  sizeLabel: string
  displayName: string
  capability: number
}

export interface ModelRequestLog {
  id: string
  time: string
  criterion: string
  prompt: string
  response: string
  durationMs: number
  status: 'ok' | 'error' | 'timeout'
}

export interface UrlCheck {
  url: string
  title: string
  status: 'pending' | 'fetching' | 'checked' | 'error'
  matchPercent: number
  borrowings: string[]
  errorMsg?: string
}

export interface PlagiarismReport {
  originalityScore: number
  checkedUrls: UrlCheck[]
}

export interface AppConfig {
  llamaUrl: string
  temperature: number
  maxTokens: number
  modelPath: string
  llamaPort: number
}

export interface RagEntry {
  id: string
  fileName: string
  rubricName: string
  grade: string
  finalScore: number
  timestamp: string
  /** Detected work type (курсовая, реферат, лаб. работа, etc.) */
  workType: string
  /** First 1500 chars for display */
  contentSummary: string
  /** Normalized TF vector (top 300 terms) for cosine similarity */
  termVector: Record<string, number>
  /** Per-criterion scores for context */
  criteriaResults: Array<{ name: string; score: number; maxScore: number; justification: string }>
}
