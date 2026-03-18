import { app, shell, BrowserWindow, ipcMain, dialog, net } from 'electron'
import { join, dirname } from 'path'
import { spawn, ChildProcess } from 'child_process'
import fs from 'fs'

let llamaProcess: ChildProcess | null = null
let llamaRunning = false
let currentModelPath = ''

function getLlamaExePath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'temp', 'llama-server.exe')
  }
  return join(__dirname, '../../temp', 'llama-server.exe')
}

function getAiModelsPath(): string {
  if (app.isPackaged) {
    return join(dirname(app.getPath('exe')), 'aimodels')
  }
  return join(app.getAppPath(), 'aimodels')
}

async function waitForServerReady(port: number, timeoutMs = 120000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/models`)
      if (res.ok) return true
    } catch {}
    await new Promise<void>((r) => setTimeout(r, 2000))
  }
  return false
}

function spawnLlamaProcess(modelPath: string, port: number): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const exePath = getLlamaExePath()
    const args = ['-m', modelPath, '--port', String(port), '--host', '127.0.0.1']

    try {
      llamaProcess = spawn(exePath, args, { detached: false, stdio: 'pipe' })

      llamaProcess.on('error', (err) => {
        llamaRunning = false
        llamaProcess = null
        currentModelPath = ''
        resolve({ success: false, error: err.message })
      })

      llamaProcess.on('exit', () => {
        llamaRunning = false
        llamaProcess = null
        currentModelPath = ''
      })

      setTimeout(() => {
        if (llamaProcess && !llamaProcess.killed) {
          resolve({ success: true })
        } else {
          resolve({ success: false, error: 'Процесс завершился сразу после запуска' })
        }
      }, 1500)
    } catch (err: unknown) {
      resolve({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  })
}

function stopLlamaServer(): void {
  if (llamaProcess) {
    llamaProcess.kill()
    llamaProcess = null
  }
  llamaRunning = false
  currentModelPath = ''
}

function getAppIcon(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'logo_studchecker.png')
  }
  // Use .ico in dev if available (better Windows taskbar rendering)
  const ico = join(__dirname, '../../build/icon.ico')
  const png = join(__dirname, '../../logo_studchecker.png')
  return require('fs').existsSync(ico) ? ico : png
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    icon: getAppIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    const rendererUrl = process.env['ELECTRON_RENDERER_URL']
    mainWindow.loadURL(rendererUrl)

    mainWindow.webContents.on('did-fail-load', (_e, errorCode) => {
      if (errorCode === -102 || errorCode === -6) {
        setTimeout(() => mainWindow.loadURL(rendererUrl), 1000)
      }
    })
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ── IPC: llama-server ────────────────────────────────────────────────────────

ipcMain.handle('llama:start', async (_event, modelPath: string, port: number) => {
  if (llamaRunning && currentModelPath === modelPath) return { success: true }
  stopLlamaServer()
  const result = await spawnLlamaProcess(modelPath, port)
  if (!result.success) return result
  currentModelPath = modelPath
  llamaRunning = true
  const ready = await waitForServerReady(port)
  if (!ready) return { success: false, error: 'Сервер не ответил в течение 2 минут' }
  return { success: true }
})

// Stop current model, load new one, wait until ready
ipcMain.handle('llama:switch', async (_event, modelPath: string, port: number) => {
  if (llamaRunning && currentModelPath === modelPath) return { success: true }
  stopLlamaServer()
  await new Promise<void>((r) => setTimeout(r, 1200))
  const result = await spawnLlamaProcess(modelPath, port)
  if (!result.success) return result
  currentModelPath = modelPath
  llamaRunning = true
  const ready = await waitForServerReady(port)
  if (!ready) return { success: false, error: 'Сервер не ответил в течение 2 минут' }
  return { success: true }
})

ipcMain.handle('llama:stop', async () => {
  stopLlamaServer()
})

ipcMain.handle('llama:status', async () => llamaRunning)

// ── IPC: file system ─────────────────────────────────────────────────────────

ipcMain.handle('dialog:open-model', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Выберите модель (.gguf)',
    filters: [{ name: 'GGUF Model', extensions: ['gguf'] }],
    properties: ['openFile']
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('fs:list-aimodels', async () => {
  const modelsDir = getAiModelsPath()
  try {
    if (!fs.existsSync(modelsDir)) {
      return { success: false, error: `Папка aimodels не найдена: ${modelsDir}`, models: [] }
    }
    const files = fs.readdirSync(modelsDir).filter((f) => f.toLowerCase().endsWith('.gguf'))
    const models = files.map((file) => {
      const filePath = join(modelsDir, file)
      const stat = fs.statSync(filePath)
      return { fileName: file, path: filePath, size: stat.size }
    })
    return { success: true, models }
  } catch (e: unknown) {
    return { success: false, error: String(e), models: [] }
  }
})

// ── IPC: HTTP fetch proxy (bypasses CORS for plagiarism checker) ─────────────

ipcMain.handle(
  'http:fetch',
  async (
    _,
    url: string,
    headers?: Record<string, string>
  ): Promise<{ ok: boolean; status: number; text: string; error?: string }> => {
    return new Promise((resolve) => {
      try {
        const request = net.request({ method: 'GET', url, redirect: 'follow' })

        request.setHeader(
          'User-Agent',
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        )
        request.setHeader('Accept', 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8')
        request.setHeader('Accept-Language', 'ru-RU,ru;q=0.9,en;q=0.8')

        if (headers) {
          for (const [key, val] of Object.entries(headers)) {
            request.setHeader(key, val)
          }
        }

        let responseData = ''
        let statusCode = 0

        const timeout = setTimeout(() => {
          try { request.abort() } catch {}
          resolve({ ok: false, status: 0, text: '', error: 'timeout' })
        }, 20000)

        request.on('response', (response) => {
          statusCode = response.statusCode
          response.on('data', (chunk) => {
            responseData += chunk.toString()
            // Limit response size to 2MB
            if (responseData.length > 2_000_000) {
              try { response.destroy() } catch {}
            }
          })
          response.on('end', () => {
            clearTimeout(timeout)
            resolve({ ok: statusCode < 400, status: statusCode, text: responseData })
          })
          response.on('error', (e: Error) => {
            clearTimeout(timeout)
            resolve({ ok: false, status: statusCode, text: '', error: e.message })
          })
        })

        request.on('error', (e: Error) => {
          clearTimeout(timeout)
          resolve({ ok: false, status: 0, text: '', error: e.message })
        })

        request.end()
      } catch (e: unknown) {
        resolve({ ok: false, status: 0, text: '', error: String(e) })
      }
    })
  }
)

// ── App lifecycle ────────────────────────────────────────────────────────────

// Disable GPU hardware acceleration to prevent GPU process crashes (exit_code=34)
// on systems with incompatible or outdated GPU drivers.
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-software-rasterizer')

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  stopLlamaServer()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
