// 滑鼠觸發鍵（主程序）— 管理 mousehook-worker 執行緒，把側鍵 / 中鍵的按下、放開轉成事件。
// 兩個用途各自一顆鍵：語音輸入（同 F9）、語音改寫（同 F7）。
// 兩個都沒選時完全不裝掛鉤；有選才啟動 worker，改選別顆鍵只改共用記憶體，不重開。
const path = require('path');
const { Worker } = require('worker_threads');
const koffi = require('koffi');
const { log } = require('./logger');

const BUTTON_CODES = { off: 0, x1: 1, x2: 2, middle: 3 };
const WM_QUIT = 0x0012;

const user32 = koffi.load('user32.dll');
const PostThreadMessageW = user32.func('bool __stdcall PostThreadMessageW(uint32 threadId, uint32 msg, uintptr_t wParam, intptr_t lParam)');

const shared = new SharedArrayBuffer(8); // [0]=語音輸入、[1]=語音改寫
const config = new Int32Array(shared);
let worker = null;
let workerThreadId = 0;
// handlers: { insert: { onDown, onUp }, revise: { onDown, onUp } }
const noop = { onDown: () => {}, onUp: () => {} };
let handlers = { insert: noop, revise: noop };

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

// triggers: { insert, revise }，值為 'off' | 'x1' | 'x2' | 'middle'；兩個同一顆時改寫視為不使用（語音輸入優先）
function setMouseTriggers(triggers, nextHandlers) {
  if (nextHandlers) handlers = { insert: nextHandlers.insert || noop, revise: nextHandlers.revise || noop };
  const insert = BUTTON_CODES[triggers.insert] || 0;
  let revise = BUTTON_CODES[triggers.revise] || 0;
  if (revise && revise === insert) {
    log.warn('[mouse] 語音輸入與語音改寫選了同一顆鍵，改寫先停用');
    revise = 0;
  }
  Atomics.store(config, 0, insert);
  Atomics.store(config, 1, revise);
  const any = insert || revise;
  if (any && !worker) startWorker();
  else if (!any && worker) stopWorker();
  log.info('[mouse] 滑鼠觸發鍵 → 語音輸入:', insert ? triggers.insert : '不使用', '／語音改寫:', revise ? triggers.revise : '不使用');
}

function stopMouseHook() {
  Atomics.store(config, 0, 0);
  Atomics.store(config, 1, 0);
  stopWorker();
}

module.exports = { setMouseTriggers, stopMouseHook };
