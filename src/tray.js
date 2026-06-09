const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { log } = require('./logger');
const { getStore } = require('./store');

let tray = null;
let _opts = {}; // 保存 onSettings / onQuit，供 menu 重建使用

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

const STATE_TIP = {
  idle: 'NoType — 待命（按住 F9 說話）',
  recording: 'NoType — 錄音中…',
  processing: 'NoType — 辨識中…',
  polishing: 'NoType — 潤稿中…',
  error: 'NoType — 發生錯誤',
};

// 建立 / 重建右鍵選單（含潤稿角色子選單）
function buildMenu() {
  const store = getStore();
  const roles = store.get('roles') || [];
  const activeRoleId = store.get('activeRoleId');

  const roleSubmenu = roles.map((r) => ({
    label: r.name,
    type: 'radio',
    checked: r.id === activeRoleId,
    click: () => {
      store.set('activeRoleId', r.id);
      refreshTrayMenu(); // 更新勾選狀態
    },
  }));

  return Menu.buildFromTemplate([
    { label: '設定…', click: () => _opts.onSettings && _opts.onSettings() },
    { type: 'separator' },
    roleSubmenu.length
      ? { label: '潤稿角色', submenu: roleSubmenu }
      : { label: '潤稿角色（無）', enabled: false },
    { type: 'separator' },
    { label: '結束 NoType', click: () => _opts.onQuit && _opts.onQuit() },
  ]);
}

function refreshTrayMenu() {
  if (!tray) return;
  try { tray.setContextMenu(buildMenu()); } catch (err) { log.warn('[tray] 重建選單失敗', err); }
}

function createTray({ onSettings, onQuit }) {
  try {
    _opts = { onSettings, onQuit };
    const iconPath = resolveIconPath('icon.png');
    const image = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
    if (image.isEmpty()) log.warn('[tray] icon 為空，使用 Electron 預設空圖示');

    tray = new Tray(image);
    tray.setToolTip(STATE_TIP.idle);
    tray.setContextMenu(buildMenu());
    tray.on('click', () => _opts.onSettings && _opts.onSettings());

    log.info('[tray] 系統匣已建立');
    return tray;
  } catch (err) {
    log.error('[tray] 建立系統匣失敗', err);
    return null;
  }
}

function setTrayState(state) {
  if (!tray) return;
  tray.setToolTip(STATE_TIP[state] || STATE_TIP.idle);
}

module.exports = { createTray, setTrayState, refreshTrayMenu };
