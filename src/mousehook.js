// 滑鼠觸發鍵（主程序）— 管理 mousehook-worker 執行緒，把側鍵 / 中鍵的按下、放開轉成事件。
// 四個用途各自一顆鍵：語音輸入（同 F9）、語音改寫（同 F7）、切換說完自動送出（同 F10）、小帥（0.1.25，固定滾輪中鍵，交給桌面小帥）。
// 全都沒選時完全不裝掛鉤；有選才啟動 worker，改選別顆鍵只改共用記憶體，不重開。
const path = require('path');
const { Worker } = require('worker_threads');
const koffi = require('koffi');
const { log } = require('./logger');

const BUTTON_CODES = { off: 0, x1: 1, x2: 2, middle: 3 };
const WM_QUIT = 0x0012;

const user32 = koffi.load('user32.dll');
const PostThreadMessageW = user32.func('bool __stdcall PostThreadMessageW(uint32 threadId, uint32 msg, uintptr_t wParam, intptr_t lParam)');

const ACTIONS = ['insert', 'revise', 'submitToggle', 'xiaoshuai']; // 共用記憶體格子順序 = 撞鍵時的優先順序（小帥格開啟時，shortcut.js 先把其他格的中鍵清掉）
const shared = new SharedArrayBuffer(4 * ACTIONS.length); // [0]=語音輸入、[1]=語音改寫、[2]=切換自動送出、[3]=小帥
const config = new Int32Array(shared);
let worker = null;
let workerThreadId = 0;
// handlers: { insert | revise | submitToggle | xiaoshuai: { onDown, onUp } }
const noop = { onDown: () => {}, onUp: () => {} };
let handlers = { insert: noop, revise: noop, submitToggle: noop, xiaoshuai: noop };

function workerScriptPath() {
  // 打包後 worker 腳本由 asarUnpack 解出（Worker 無法直接從 app.asar 載入檔案）
  return path.join(__dirname, 'mousehook-worker.js').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
}

function startWorker() {
  worker = new Worker(workerScriptPath(), {
    workerData: { shared, koffiPath: require.resolve('koffi') },
  });
  const self = worker;
  worker.on('message', (msg) => {
    const h = handlers[msg.action];
    if (msg.type === 'down' && h) h.onDown();
    else if (msg.type === 'up' && h) h.onUp();
    else if (msg.type === 'ready') {
      workerThreadId = msg.threadId;
      if (msg.ok) log.info('[mouse] 滑鼠觸發鍵掛鉤已安裝');
      else log.error('[mouse] SetWindowsHookEx 失敗，滑鼠觸發鍵無法使用');
    }
  });
  worker.on('error', (err) => log.error('[mouse] worker 錯誤', err));
  worker.on('exit', (code) => {
    if (worker === self) { worker = null; workerThreadId = 0; }
    log.info('[mouse] worker 結束', code);
  });
}

function stopWorker() {
  if (!worker) return;
  const w = worker;
  worker = null;
  if (workerThreadId) PostThreadMessageW(workerThreadId, WM_QUIT, 0, 0); // 讓 GetMessageW 迴圈結束並拆掉掛鉤
  workerThreadId = 0;
  setTimeout(() => { w.terminate().catch(() => {}); }, 500); // 保險：沒正常結束就強制收掉
}

// triggers: { insert, revise, submitToggle, xiaoshuai }，值為 'off' | 'x1' | 'x2' | 'middle'
// 撞鍵時依 ACTIONS 順序，前面的優先、後面的視為不使用（設定頁會擋，這裡是保險）
function setMouseTriggers(triggers, nextHandlers) {
  if (nextHandlers) handlers = Object.fromEntries(ACTIONS.map((a) => [a, nextHandlers[a] || noop]));
  const codes = [];
  ACTIONS.forEach((action, i) => {
    let code = BUTTON_CODES[triggers[action]] || 0;
    const taken = codes.indexOf(code);
    if (code && taken !== -1) {
      log.warn(`[mouse] ${action} 與 ${ACTIONS[taken]} 選了同一顆鍵，${action} 先停用`);
      code = 0;
    }
    codes.push(code);
    Atomics.store(config, i, code);
  });
  const any = codes.some(Boolean);
  if (any && !worker) startWorker();
  else if (!any && worker) stopWorker();
  log.info('[mouse] 滑鼠觸發鍵 →', ACTIONS.map((a, i) => `${a}:${codes[i] ? triggers[a] : 'off'}`).join(' '));
}

function stopMouseHook() {
  ACTIONS.forEach((_, i) => Atomics.store(config, i, 0));
  stopWorker();
}

module.exports = { setMouseTriggers, stopMouseHook };
