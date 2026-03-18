"use strict";
const electron = require("electron");
const path = require("path");
const child_process = require("child_process");
const fs = require("fs");
let llamaProcess = null;
let llamaRunning = false;
let currentModelPath = "";
function getLlamaExePath() {
  if (electron.app.isPackaged) {
    return path.join(process.resourcesPath, "temp", "llama-server.exe");
  }
  return path.join(__dirname, "../../temp", "llama-server.exe");
}
function getAiModelsPath() {
  if (electron.app.isPackaged) {
    return path.join(path.dirname(electron.app.getPath("exe")), "aimodels");
  }
  return path.join(electron.app.getAppPath(), "aimodels");
}
async function waitForServerReady(port, timeoutMs = 12e4) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/models`);
      if (res.ok) return true;
    } catch {
    }
    await new Promise((r) => setTimeout(r, 2e3));
  }
  return false;
}
function spawnLlamaProcess(modelPath, port) {
  return new Promise((resolve) => {
    const exePath = getLlamaExePath();
    const args = ["-m", modelPath, "--port", String(port), "--host", "127.0.0.1"];
    try {
      llamaProcess = child_process.spawn(exePath, args, { detached: false, stdio: "pipe" });
      llamaProcess.on("error", (err) => {
        llamaRunning = false;
        llamaProcess = null;
        currentModelPath = "";
        resolve({ success: false, error: err.message });
      });
      llamaProcess.on("exit", () => {
        llamaRunning = false;
        llamaProcess = null;
        currentModelPath = "";
      });
      setTimeout(() => {
        if (llamaProcess && !llamaProcess.killed) {
          resolve({ success: true });
        } else {
          resolve({ success: false, error: "Процесс завершился сразу после запуска" });
        }
      }, 1500);
    } catch (err) {
      resolve({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
}
function stopLlamaServer() {
  if (llamaProcess) {
    llamaProcess.kill();
    llamaProcess = null;
  }
  llamaRunning = false;
  currentModelPath = "";
}
function getAppIcon() {
  if (electron.app.isPackaged) {
    return path.join(process.resourcesPath, "logo_studchecker.png");
  }
  const ico = path.join(__dirname, "../../build/icon.ico");
  const png = path.join(__dirname, "../../logo_studchecker.png");
  return require("fs").existsSync(ico) ? ico : png;
}
function createWindow() {
  const mainWindow = new electron.BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    icon: getAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  });
  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    electron.shell.openExternal(details.url);
    return { action: "deny" };
  });
  if (process.env["ELECTRON_RENDERER_URL"]) {
    const rendererUrl = process.env["ELECTRON_RENDERER_URL"];
    mainWindow.loadURL(rendererUrl);
    mainWindow.webContents.on("did-fail-load", (_e, errorCode) => {
      if (errorCode === -102 || errorCode === -6) {
        setTimeout(() => mainWindow.loadURL(rendererUrl), 1e3);
      }
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
electron.ipcMain.handle("llama:start", async (_event, modelPath, port) => {
  if (llamaRunning && currentModelPath === modelPath) return { success: true };
  stopLlamaServer();
  const result = await spawnLlamaProcess(modelPath, port);
  if (!result.success) return result;
  currentModelPath = modelPath;
  llamaRunning = true;
  const ready = await waitForServerReady(port);
  if (!ready) return { success: false, error: "Сервер не ответил в течение 2 минут" };
  return { success: true };
});
electron.ipcMain.handle("llama:switch", async (_event, modelPath, port) => {
  if (llamaRunning && currentModelPath === modelPath) return { success: true };
  stopLlamaServer();
  await new Promise((r) => setTimeout(r, 1200));
  const result = await spawnLlamaProcess(modelPath, port);
  if (!result.success) return result;
  currentModelPath = modelPath;
  llamaRunning = true;
  const ready = await waitForServerReady(port);
  if (!ready) return { success: false, error: "Сервер не ответил в течение 2 минут" };
  return { success: true };
});
electron.ipcMain.handle("llama:stop", async () => {
  stopLlamaServer();
});
electron.ipcMain.handle("llama:status", async () => llamaRunning);
electron.ipcMain.handle("dialog:open-model", async () => {
  const result = await electron.dialog.showOpenDialog({
    title: "Выберите модель (.gguf)",
    filters: [{ name: "GGUF Model", extensions: ["gguf"] }],
    properties: ["openFile"]
  });
  return result.canceled ? null : result.filePaths[0];
});
electron.ipcMain.handle("fs:list-aimodels", async () => {
  const modelsDir = getAiModelsPath();
  try {
    if (!fs.existsSync(modelsDir)) {
      return { success: false, error: `Папка aimodels не найдена: ${modelsDir}`, models: [] };
    }
    const files = fs.readdirSync(modelsDir).filter((f) => f.toLowerCase().endsWith(".gguf"));
    const models = files.map((file) => {
      const filePath = path.join(modelsDir, file);
      const stat = fs.statSync(filePath);
      return { fileName: file, path: filePath, size: stat.size };
    });
    return { success: true, models };
  } catch (e) {
    return { success: false, error: String(e), models: [] };
  }
});
electron.ipcMain.handle(
  "http:fetch",
  async (_, url, headers) => {
    return new Promise((resolve) => {
      try {
        const request = electron.net.request({ method: "GET", url, redirect: "follow" });
        request.setHeader(
          "User-Agent",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        );
        request.setHeader("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8");
        request.setHeader("Accept-Language", "ru-RU,ru;q=0.9,en;q=0.8");
        if (headers) {
          for (const [key, val] of Object.entries(headers)) {
            request.setHeader(key, val);
          }
        }
        let responseData = "";
        let statusCode = 0;
        const timeout = setTimeout(() => {
          try {
            request.abort();
          } catch {
          }
          resolve({ ok: false, status: 0, text: "", error: "timeout" });
        }, 2e4);
        request.on("response", (response) => {
          statusCode = response.statusCode;
          response.on("data", (chunk) => {
            responseData += chunk.toString();
            if (responseData.length > 2e6) {
              try {
                response.destroy();
              } catch {
              }
            }
          });
          response.on("end", () => {
            clearTimeout(timeout);
            resolve({ ok: statusCode < 400, status: statusCode, text: responseData });
          });
          response.on("error", (e) => {
            clearTimeout(timeout);
            resolve({ ok: false, status: statusCode, text: "", error: e.message });
          });
        });
        request.on("error", (e) => {
          clearTimeout(timeout);
          resolve({ ok: false, status: 0, text: "", error: e.message });
        });
        request.end();
      } catch (e) {
        resolve({ ok: false, status: 0, text: "", error: String(e) });
      }
    });
  }
);
electron.app.disableHardwareAcceleration();
electron.app.commandLine.appendSwitch("disable-gpu");
electron.app.commandLine.appendSwitch("disable-software-rasterizer");
electron.app.whenReady().then(() => {
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("before-quit", () => {
  stopLlamaServer();
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
