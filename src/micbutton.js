// 浮動麥克風鈕（主程序）— 永遠置頂的小圓鈕，滑鼠點一下開始 / 結束連續聽寫。
// 與狀態浮窗同樣 focusable:false：點它不會搶走焦點，辨識結果照常貼進使用者原本的輸入位置。
const { BrowserWindow, screen } = require('electron');
const path = require('path');
const { log } = require('./logger');
const { getStore } = require('./store');

const SIZE = 56;

let micWindow = null;
let micState = 'idle'; // 'idle' | 'listening'（連續聽寫中）| 'recording'（按住說話中）
let dragOffset = null; // 拖曳中：游標相對視窗左上角的位移

function isMicButtonEnabled() {
  return getStore().get('micButton') !== false;
}

function defaultPosition() {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - SIZE - 40,
    y: workArea.y + workArea.height - SIZE - 120,
  };
}

// 螢幕配置變了（拔掉外接螢幕、改解析度）時，把鈕拉回看得到的地方
function clampToScreen(pos) {
  const area = screen.getDisplayNearestPoint(pos).workArea;
  return {
    x: Math.round(Math.min(Math.max(pos.x, area.x), area.x + area.width - SIZE)),
    y: Math.round(Math.min(Math.max(pos.y, area.y), area.y + area.height - SIZE)),
  };
}

function savedPosition() {
  const saved = getStore().get('micButtonPos');
  const isValid = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y);
  return clampToScreen(isValid ? saved : defaultPosition());
}

// 一律連同寬高一起設：高 DPI 下只 setPosition 會讓透明無框視窗越拖越大
function moveTo(pos) {
  micWindow.setBounds({ x: pos.x, y: pos.y, width: SIZE, height: SIZE });
}

function sendState() {
  if (!micWindow || micWindow.isDestroyed()) return;
  micWindow.webContents.send('mic-state', micState);
}

function createMicButton() {
  if (micWindow && !micWindow.isDestroyed()) return micWindow;

  const pos = savedPosition();
  micWindow = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    x: pos.x,
    y: pos.y,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false, // 不搶焦點：點它之後，文字仍貼進原本的輸入位置
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'micbutton-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  micWindow.loadFile(path.join(__dirname, 'micbutton.html'));
  micWindow.setAlwaysOnTop(true, 'screen-saver');
  micWindow.webContents.once('did-finish-load', () => {
    sendState();
    if (isMicButtonEnabled()) micWindow.showInactive();
    log.info('[mic] 浮動麥克風鈕就緒', pos, isMicButtonEnabled() ? '' : '(已關閉)');
  });
  micWindow.on('closed', () => { micWindow = null; });
  return micWindow;
}

function setMicButtonEnabled(enabled) {
  getStore().set('micButton', enabled === true);
  const win = createMicButton();
  if (enabled === true) {
    moveTo(savedPosition());
    if (!win.webContents.isLoading()) win.showInactive();
  } else if (win.isVisible()) {
    win.hide();
  }
  log.info('[mic] 浮動麥克風鈕 →', enabled === true ? '顯示' : '隱藏');
}

function setMicState(state) {
  const next = state === 'listening' || state === 'recording' ? state : 'idle';
  if (next === micState) return;
  micState = next;
  sendState();
}

function dragStart() {
  if (!micWindow || micWindow.isDestroyed()) return;
  const cursor = screen.getCursorScreenPoint();
  const [x, y] = micWindow.getPosition();
  dragOffset = { x: cursor.x - x, y: cursor.y - y };
}

function dragMove() {
  if (!micWindow || micWindow.isDestroyed() || !dragOffset) return;
  const cursor = screen.getCursorScreenPoint();
  moveTo({ x: cursor.x - dragOffset.x, y: cursor.y - dragOffset.y });
}

function dragEnd() {
  if (!micWindow || micWindow.isDestroyed() || !dragOffset) return;
  dragOffset = null;
  const [x, y] = micWindow.getPosition();
  const pos = clampToScreen({ x, y });
  moveTo(pos);
  getStore().set('micButtonPos', pos);
}

module.exports = {
  createMicButton, setMicButtonEnabled, isMicButtonEnabled, setMicState,
  dragStart, dragMove, dragEnd,
};
