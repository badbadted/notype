const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const { log } = require('./logger');
const { createTray, refreshTrayMenu } = require('./tray');
const { getStore, getSettingsForRenderer, applySettings } = require('./store');
const { createRecorderWindow } = require('./recorder');
const { createOverlayWindow, showOverlay, hideOverlay } = require('./overlay');
const { registerShortcut, unregisterShortcut, handleAudioData } = require('./shortcut');

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

// 單一實例：敗方必須立即退出且「完全不執行任何初始化」。
// 否則敗方仍會建系統匣、搶註冊熱鍵失敗後把 fallback 鍵寫回共用設定檔，
// 污染正常實例（曾導致 F9 被改成 Ctrl+Shift+Space、按 F9 沒反應）。
const gotTheLock = app.requestSingleInstanceLock();

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
    backgroundColor: '#fafafa', // 避免 Windows 載入前白邊（mono-gray 淺色主題）
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

  // 應用程式版本
  ipcMain.handle('get-version', () => app.getVersion());

  // 讀取全部設定（金鑰欄位解密為明文供設定頁顯示）
  ipcMain.handle('get-settings', () => getSettingsForRenderer(store));

  // 儲存設定（部分更新；金鑰欄位自動以 safeStorage 加密）
  ipcMain.handle('save-settings', (_event, settings) => {
    applySettings(store, settings);
    // 同步開機啟動
    app.setLoginItemSettings({ openAtLogin: store.get('launchAtStartup') === true });
    // 快捷鍵可能變更 → 重新註冊（切片 6 接上 registerShortcut 後生效）
    if (typeof global.__notypeReregisterShortcut === 'function') {
      global.__notypeReregisterShortcut();
    }
    refreshTrayMenu(); // 角色清單/生效角色可能變動 → 更新系統匣選單
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

  // 隱藏錄音視窗回傳的音訊 → 進入 STT→潤稿→輸入流程
  ipcMain.on('audio-data', (_event, audioBuffer) => { handleAudioData(audioBuffer); });

  // 錄音視窗回報錯誤（如麥克風存取失敗）
  ipcMain.on('recorder-error', (_event, msg) => {
    log.error('[recorder]', msg);
    showOverlay('error', String(msg).slice(0, 40));
    hideOverlay(3500);
  });
}

if (!gotTheLock) {
  log.info('[main] 已有實例在執行，立即退出（不做任何初始化）');
  app.quit();
} else {
  // 再次啟動 NoType（例如使用者重複點圖示）→ 把既有實例的設定視窗帶到前景
  app.on('second-instance', () => {
    log.info('[main] 偵測到第二次啟動，聚焦既有設定視窗');
    createSettingsWindow();
  });

  app.whenReady().then(() => {
    log.info('[main] app ready, log =', log.path());

    getStore(); // 初始化設定存儲
    registerIpc();

    createTray({
      onSettings: () => createSettingsWindow(),
      onQuit: () => app.quit(),
    });

    // 預建隱藏錄音視窗 + 浮窗，並註冊全域快捷鍵
    createRecorderWindow();
    createOverlayWindow();
    registerShortcut();
    global.__notypeReregisterShortcut = registerShortcut; // 設定變更時供 IPC 重註冊

    // 首次啟動開設定頁引導；已設金鑰則靜默常駐
    const store = getStore();
    const hasKey = store.get('groqApiKey') || store.get('openaiApiKey');
    if (!hasKey) createSettingsWindow();
  }).catch((err) => log.error('[main] whenReady 失敗', err));

  // 系統匣常駐：視窗全關不退出
  app.on('window-all-closed', (e) => {
    e.preventDefault();
  });

  app.on('will-quit', () => {
    unregisterShortcut();
  });
}

module.exports = { createSettingsWindow };
