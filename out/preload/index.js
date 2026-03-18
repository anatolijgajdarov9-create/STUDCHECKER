"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    electron: process.versions.electron
  },
  startLlamaServer: (modelPath, port) => electron.ipcRenderer.invoke("llama:start", modelPath, port),
  switchLlamaModel: (modelPath, port) => electron.ipcRenderer.invoke("llama:switch", modelPath, port),
  stopLlamaServer: () => electron.ipcRenderer.invoke("llama:stop"),
  getLlamaStatus: () => electron.ipcRenderer.invoke("llama:status"),
  openModelFileDialog: () => electron.ipcRenderer.invoke("dialog:open-model"),
  listAiModels: () => electron.ipcRenderer.invoke("fs:list-aimodels"),
  fetchUrl: (url, headers) => electron.ipcRenderer.invoke("http:fetch", url, headers),
  onUpdateProgress: (callback) => electron.ipcRenderer.on("update-progress", (_event, progress) => callback(progress)),
  removeAllListeners: (channel) => electron.ipcRenderer.removeAllListeners(channel)
});
