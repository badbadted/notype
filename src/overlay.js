// 狀態浮窗管理（主程序）— 無邊框、透明、置中螢幕底部、不搶焦點
const { BrowserWindow, screen } = require('electron');
const path = require('path');
const { log } = require('./logger');
const { setTrayState } = require('./tray');

let overlayWindow = null;
let hideTimer = null;

function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow;

  overlayWindow = new BrowserWindow({
    width: 240,
    height: 84,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false, // 不搶焦點，使用者打字目標不受影響
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWindow.loadFile(path.join(__dirname, 'overlay.html'));
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.on('closed', () => { overlayWindow = null; });
  return overlayWindow;
}

function positionBottomCenter(win) {
  try {
    const { workArea } = screen.getPrimaryDisplay();
    const [w, h] = win.getSize();
    const x = Math.round(workArea.x + (workArea.width - w) / 2);
    const y = Math.round(workArea.y + workArea.height - h - 60);
    win.setPosition(x, y);
  } catch (err) {
    log.warn('[overlay] 定位失敗', err);
  }
}

// state: recording | processing | polishing | done | error
function showOverlay(state, detail) {
  const win = createOverlayWindow();
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }

  const send = () => win.webContents.send('overlay-state', state, detail || '');
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', send);
  } else {
    send();
  }

  positionBottomCenter(win);
  if (!win.isVisible()) win.showInactive(); // 顯示但不奪焦點
  setTrayState(state);
}

function hideOverlay(delay = 0) {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
      overlayWindow.hide();
    }
    setTrayState('idle');
  }, delay);
}

module.exports = { createOverlayWindow, showOverlay, hideOverlay };
