import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    electron: process.versions.electron
  },
  startLlamaServer: (modelPath: string, port: number) =>
    ipcRenderer.invoke('llama:start', modelPath, port),
  switchLlamaModel: (modelPath: string, port: number) =>
    ipcRenderer.invoke('llama:switch', modelPath, port),
  stopLlamaServer: () =>
    ipcRenderer.invoke('llama:stop'),
  getLlamaStatus: () =>
    ipcRenderer.invoke('llama:status'),
  openModelFileDialog: () =>
    ipcRenderer.invoke('dialog:open-model'),
  listAiModels: () =>
    ipcRenderer.invoke('fs:list-aimodels'),
  fetchUrl: (url: string, headers?: Record<string, string>) =>
    ipcRenderer.invoke('http:fetch', url, headers),
  onUpdateProgress: (callback: (progress: number) => void) =>
    ipcRenderer.on('update-progress', (_event, progress) => callback(progress)),
  removeAllListeners: (channel: string) => ipcRenderer.removeAllListeners(channel)
})
