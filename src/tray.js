const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { log } = require('./logger');

let tray = null;

// production 用 process.resourcesPath，開發用專案內 assets
function resolveIconPath(name) {
  const candidates = [
    path.join(process.resourcesPath || '', 'assets', name),
    path.join(__dirname, '..', 'assets', name),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

// 各狀態對應的提示文字（圖示暫共用，後續切片可換不同狀態圖）
const STATE_TIP = {
  idle: 'NoType — 待命（按住 Alt+Space 說話）',
  recording: 'NoType — 錄音中…',
  processing: 'NoType — 辨識中…',
  polishing: 'NoType — 潤稿中…',
  error: 'NoType — 發生錯誤',
};

function createTray({ onSettings, onQuit }) {
  try {
    const iconPath = resolveIconPath('icon.png');
    let image = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
    if (image.isEmpty()) {
      log.warn('[tray] icon 為空，使用 Electron 預設空圖示');
    }

    tray = new Tray(image);
    tray.setToolTip(STATE_TIP.idle);

    const menu = Menu.buildFromTemplate([
      { label: '設定…', click: () => onSettings && onSettings() },
      { type: 'separator' },
      { label: '結束 NoType', click: () => onQuit && onQuit() },
    ]);
    tray.setContextMenu(menu);

    // 左鍵點擊也開設定
    tray.on('click', () => onSettings && onSettings());

    log.info('[tray] 系統匣已建立');
    return tray;
  } catch (err) {
    log.error('[tray] 建立系統匣失敗', err);
    return null;
  }
}

// 後續切片：依錄音流程狀態更新 tooltip（取代圖示閃爍）
function setTrayState(state) {
  if (!tray) return;
  tray.setToolTip(STATE_TIP[state] || STATE_TIP.idle);
}

module.exports = { createTray, setTrayState };
