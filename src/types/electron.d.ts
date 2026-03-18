export {}

declare module '*.png' {
  const url: string
  export default url
}

export interface RawAiModel {
  fileName: string
  path: string
  size: number
}

declare global {
  interface Window {
    electronAPI?: {
      platform: string
      versions: { node: string; electron: string }
      startLlamaServer: (modelPath: string, port: number) => Promise<{ success: boolean; error?: string }>
      switchLlamaModel: (modelPath: string, port: number) => Promise<{ success: boolean; error?: string }>
      stopLlamaServer: () => Promise<void>
      getLlamaStatus: () => Promise<boolean>
      openModelFileDialog: () => Promise<string | null>
      listAiModels: () => Promise<{ success: boolean; error?: string; models: RawAiModel[] }>
      fetchUrl: (url: string, headers?: Record<string, string>) => Promise<{ ok: boolean; status: number; text: string; error?: string }>
      onUpdateProgress: (callback: (progress: number) => void) => void
      removeAllListeners: (channel: string) => void
    }
  }
}
