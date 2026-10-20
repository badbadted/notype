// 置頂守護（主程序）— 讓 focusable:false 的浮窗（麥克風鈕、狀態浮窗）持續待在最上層。
// Windows 上 setAlwaysOnTop 的層級（'screen-saver' 等）無效，所有置頂視窗同一層，誰最後被叫起來誰在上面；
// 而不搶焦點的視窗永遠不會被啟用，被壓下去就不會自己浮回來。Win+D、全螢幕程式退出、
// 螢幕配置變更、休眠喚醒後，Windows 還可能直接拿掉置頂屬性。所以顯示期間定時補設，事件發生時立即補設。
// 只動 Z 順序（SWP_NOACTIVATE），不會搶走使用者的焦點。
const { screen, powerMonitor } = require('electron');
const { log } = require('./logger');

const INTERVAL_MS = 1500;

const windows = new Set();
let timer = null;
let systemHooked = false;

function raise(win) {
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  try {
    win.setAlwaysOnTop(true, 'screen-saver');
    win.moveTop();
  } catch (err) {
    log.warn('[top] 重新置頂失敗', err);
  }
}

function raiseAll() {
  for (const win of windows) raise(win);
}

function anyVisible() {
  for (const win of windows) {
    if (!win.isDestroyed() && win.isVisible()) return true;
  }
  return false;
}

// 有浮窗顯示才跑計時器，全部隱藏就停掉
function syncTimer() {
  if (anyVisible()) {
    if (!timer) timer = setInterval(raiseAll, INTERVAL_MS);
  } else if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// 系統事件（螢幕插拔／改解析度、解除鎖定、休眠喚醒）後立即補設；喚醒時視窗管理員可能還在重排，延遲再補一次
function hookSystemEvents() {
  if (systemHooked) return;
  systemHooked = true;
  const raiseNowAndLater = () => {
    raiseAll();
    setTimeout(raiseAll, 1000);
  };
  screen.on('display-added', raiseNowAndLater);
  screen.on('display-removed', raiseNowAndLater);
  screen.on('display-metrics-changed', raiseNowAndLater);
  powerMonitor.on('resume', raiseNowAndLater);
  powerMonitor.on('unlock-screen', raiseNowAndLater);
}

function keepOnTop(win) {
  if (!win || win.isDestroyed() || windows.has(win)) return;
  windows.add(win);
  hookSystemEvents();
  win.on('show', () => { raise(win); syncTimer(); });
  win.on('hide', syncTimer);
  win.on('closed', () => { windows.delete(win); syncTimer(); });
  syncTimer();
}

module.exports = { keepOnTop };
