const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const { log } = require('./logger');
const { createTray } = require('./tray');
const { getStore } = require('./store');

// ── 跨機部署防護（必須在 app ready 前設定）──────────────────────
// 來源：feedback_electron_portable_packaging — 否則在其他電腦會無聲閃退
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-software-rasterizer');

// 防無聲閃退：未捕捉例外寫 log + 彈窗
process.on('uncaughtException', (err) => {
  log.error('[uncaughtException]', err);
  try {
    dialog.showErrorBox('NoType 發生錯誤', `${err.message}\n\nlog: ${log.path()}`);
  } catch { /* 視窗系統未就緒時略過 */ }
});
process.on('unhandledRejection', (reason) => {
  log.error('[unhandledRejection]', reason);
});

// 單一實例
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  log.info('已有實例在執行，退出');
  app.quit();
}

let settingsWindow = null;

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return settingsWindow;
  }

  settingsWindow = new BrowserWindow({
    width: 600,
    height: 560,
    resizable: false,
    title: 'NoType 設定',
    backgroundColor: '#0f172a', // 避免 Windows frameless/載入前白邊
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'settings', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  settingsWindow.loadFile(path.join(__dirname, 'settings', 'index.html'));
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
  return settingsWindow;
}

function registerIpc() {
  const store = getStore();

  // 讀取全部設定
  ipcMain.handle('get-settings', () => store.store);

  // 儲存設定（部分更新）
  ipcMain.handle('save-settings', (_event, settings) => {
    for (const [key, value] of Object.entries(settings)) {
      store.set(key, value);
    }
    // 同步開機啟動
    app.setLoginItemSettings({ openAtLogin: store.get('launchAtStartup') === true });
    // 快捷鍵可能變更 → 重新註冊（切片 6 接上 registerShortcut 後生效）
    if (typeof global.__notypeReregisterShortcut === 'function') {
      global.__notypeReregisterShortcut();
    }
    log.info('[ipc] 設定已儲存', Object.keys(settings));
    return true;
  });

  // 測試 API Key 是否有效
  ipcMain.handle('test-api-key', async (_event, provider, apiKey) => {
    if (!apiKey) return false;
    try {
      const url = provider === 'groq'
        ? 'https://api.groq.com/openai/v1/models'
        : 'https://api.openai.com/v1/models';
      const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
      await res.text(); // 排水避免 socket 洩漏
      return res.ok;
    } catch (err) {
      log.warn('[ipc] test-api-key 失敗', err);
      return false;
    }
  });
}

app.whenReady().then(() => {
  log.info('[main] app ready, log =', log.path());

  getStore(); // 初始化設定存儲
  registerIpc();

  createTray({
    onSettings: () => createSettingsWindow(),
    onQuit: () => app.quit(),
  });

  // 首次啟動或無視窗時開設定頁引導
  createSettingsWindow();
}).catch((err) => log.error('[main] whenReady 失敗', err));

// 系統匣常駐：視窗全關不退出
app.on('window-all-closed', (e) => {
  e.preventDefault();
});

module.exports = { createSettingsWindow };
