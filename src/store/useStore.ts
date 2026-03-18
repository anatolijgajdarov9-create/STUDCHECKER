import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  Model,
  Rubric,
  AnalysisResult,
  LogEntry,
  ExpertStep,
  AppConfig,
  LogType,
  ModelRequestLog,
  PlagiarismReport
} from '../types'

const DEFAULT_RUBRIC: Rubric = {
  id: 'default_academic',
  name: 'Стандартная академическая рубрика',
  criteria: [
    { id: 'c1', name: 'Соответствие теме', weight: 20, maxScore: 10, description: 'Насколько работа соответствует заявленной теме' },
    { id: 'c2', name: 'Оригинальность', weight: 20, maxScore: 10, description: 'Уникальность подхода, отсутствие плагиата' },
    { id: 'c3', name: 'Структура работы', weight: 20, maxScore: 10, description: 'Логичность построения, наличие введения/заключения' },
    { id: 'c4', name: 'Качество содержания', weight: 20, maxScore: 10, description: 'Глубина раскрытия темы, качество аргументации' },
    { id: 'c5', name: 'Оформление и стиль', weight: 20, maxScore: 10, description: 'Соответствие требованиям, грамотность' }
  ]
}

interface AppState {
  // Config
  config: AppConfig

  // Connection
  isConnected: boolean

  // Models
  models: Model[]
  selectedModelId: string | null

  // File queue
  fileQueue: Array<{ name: string; content: string }>
  // kept for backward-compat (points to queue[0])
  currentFileName: string | null
  fileContent: string

  // Rubrics
  rubrics: Rubric[]
  selectedRubricId: string | null

  // Analysis
  isAnalyzing: boolean
  analysisProgress: number
  expertSteps: ExpertStep[]
  logs: LogEntry[]

  // Sources (reference documents injected into model context)
  sources: Array<{ name: string; content: string }>

  // Model request journal
  requestLogs: ModelRequestLog[]

  // Plagiarism
  plagiarismReport: PlagiarismReport | null

  // Results
  currentResult: AnalysisResult | null
  history: AnalysisResult[]

  // UI modals
  showResultsModal: boolean
  showSettingsModal: boolean
  showRubricModal: boolean
  editingRubricId: string | null

  // Actions
  setConfig: (config: Partial<AppConfig>) => void
  setConnected: (val: boolean) => void
  setModels: (models: Model[]) => void
  setSelectedModel: (id: string | null) => void
  setFile: (name: string | null, content: string) => void
  clearFile: () => void
  addFilesToQueue: (files: Array<{ name: string; content: string }>) => void
  removeFromQueue: (index: number) => void
  clearQueue: () => void
  addRubric: (rubric: Rubric) => void
  updateRubric: (rubric: Rubric) => void
  deleteRubric: (id: string) => void
  setSelectedRubric: (id: string | null) => void
  setAnalyzing: (val: boolean) => void
  setProgress: (val: number) => void
  setExpertSteps: (steps: ExpertStep[]) => void
  updateExpertStep: (id: string, updates: Partial<ExpertStep>) => void
  addLog: (message: string, type?: LogType) => void
  clearLogs: () => void
  addSource: (source: { name: string; content: string }) => void
  removeSource: (index: number) => void
  clearSources: () => void
  addRequestLog: (entry: Omit<ModelRequestLog, 'id' | 'time'>) => void
  clearRequestLogs: () => void
  setPlagiarismReport: (report: PlagiarismReport | null) => void
  setCurrentResult: (result: AnalysisResult | null) => void
  saveToHistory: (result: AnalysisResult) => void
  deleteFromHistory: (id: string) => void
  clearHistory: () => void
  setShowResultsModal: (val: boolean) => void
  setShowSettingsModal: (val: boolean) => void
  setShowRubricModal: (val: boolean) => void
  openRubricModal: (editId?: string) => void
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      config: {
        llamaUrl: 'http://localhost:8080',
        temperature: 0.3,
        maxTokens: 4096,
        modelPath: '',
        llamaPort: 8080
      },

      isConnected: false,
      models: [],
      selectedModelId: null,
      fileQueue: [],
      currentFileName: null,
      fileContent: '',

      rubrics: [DEFAULT_RUBRIC],
      selectedRubricId: 'default_academic',

      isAnalyzing: false,
      analysisProgress: 0,
      expertSteps: [],
      logs: [],

      sources: [],
      requestLogs: [],
      plagiarismReport: null,
      currentResult: null,
      history: [],

      showResultsModal: false,
      showSettingsModal: false,
      showRubricModal: false,
      editingRubricId: null,

      setConfig: (updates) =>
        set((s) => ({ config: { ...s.config, ...updates } })),

      setConnected: (val) => set({ isConnected: val }),

      setModels: (models) => set({ models }),

      setSelectedModel: (id) => set({ selectedModelId: id }),

      setFile: (name, content) =>
        set({ currentFileName: name, fileContent: content }),

      clearFile: () =>
        set({ currentFileName: null, fileContent: '' }),

      addFilesToQueue: (files) =>
        set((s) => {
          const existing = new Set(s.fileQueue.map((f) => f.name))
          const fresh = files.filter((f) => !existing.has(f.name))
          const next = [...s.fileQueue, ...fresh]
          return {
            fileQueue: next,
            currentFileName: next[0]?.name ?? null,
            fileContent: next[0]?.content ?? ''
          }
        }),

      removeFromQueue: (index) =>
        set((s) => {
          const next = s.fileQueue.filter((_, i) => i !== index)
          return {
            fileQueue: next,
            currentFileName: next[0]?.name ?? null,
            fileContent: next[0]?.content ?? ''
          }
        }),

      clearQueue: () =>
        set({ fileQueue: [], currentFileName: null, fileContent: '' }),

      addRubric: (rubric) =>
        set((s) => ({ rubrics: [...s.rubrics, rubric] })),

      updateRubric: (rubric) =>
        set((s) => ({ rubrics: s.rubrics.map((r) => (r.id === rubric.id ? rubric : r)) })),

      deleteRubric: (id) =>
        set((s) => ({
          rubrics: s.rubrics.filter((r) => r.id !== id),
          selectedRubricId:
            s.selectedRubricId === id
              ? (s.rubrics.find((r) => r.id !== id)?.id ?? null)
              : s.selectedRubricId
        })),

      setSelectedRubric: (id) => set({ selectedRubricId: id }),

      setAnalyzing: (val) => set({ isAnalyzing: val }),

      setProgress: (val) => set({ analysisProgress: val }),

      setExpertSteps: (steps) => set({ expertSteps: steps }),

      updateExpertStep: (id, updates) =>
        set((s) => ({
          expertSteps: s.expertSteps.map((step) =>
            step.id === id ? { ...step, ...updates } : step
          )
        })),

      addLog: (message, type = 'info') => {
        const entry: LogEntry = {
          id: Date.now().toString() + Math.random(),
          time: new Date().toLocaleTimeString(),
          message,
          type
        }
        set((s) => ({ logs: [...s.logs.slice(-199), entry] }))
      },

      clearLogs: () => set({ logs: [] }),

      addSource: (source) =>
        set((s) => ({ sources: [...s.sources, source] })),

      removeSource: (index) =>
        set((s) => ({ sources: s.sources.filter((_, i) => i !== index) })),

      clearSources: () => set({ sources: [] }),

      addRequestLog: (entry) => {
        const log: ModelRequestLog = {
          id: Date.now().toString() + Math.random(),
          time: new Date().toLocaleTimeString(),
          ...entry
        }
        set((s) => ({ requestLogs: [...s.requestLogs.slice(-299), log] }))
      },

      clearRequestLogs: () => set({ requestLogs: [] }),

      setPlagiarismReport: (report) => set({ plagiarismReport: report }),

      setCurrentResult: (result) => set({ currentResult: result }),

      saveToHistory: (result) =>
        set((s) => {
          const history = [result, ...s.history].slice(0, 30)
          return { history }
        }),

      deleteFromHistory: (id) =>
        set((s) => ({ history: s.history.filter((h) => h.id !== id) })),

      clearHistory: () => set({ history: [] }),

      setShowResultsModal: (val) => set({ showResultsModal: val }),
      setShowSettingsModal: (val) => set({ showSettingsModal: val }),
      setShowRubricModal: (val) => set({ showRubricModal: val, editingRubricId: val ? get().editingRubricId : null }),
      openRubricModal: (editId) => set({ showRubricModal: true, editingRubricId: editId ?? null })
    }),
    {
      name: 'studchecker-storage',
      partialize: (state) => ({
        config: state.config,
        rubrics: state.rubrics,
        selectedRubricId: state.selectedRubricId,
        history: state.history
      })
    }
  )
)

export const getSelectedRubric = (state: AppState) =>
  state.rubrics.find((r) => r.id === state.selectedRubricId) ?? null
