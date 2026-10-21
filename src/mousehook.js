// 滑鼠觸發鍵（主程序）— 管理 mousehook-worker 執行緒，把側鍵 / 中鍵的按下、放開轉成事件。
// 沒選觸發鍵時完全不裝掛鉤；選了才啟動 worker，改選別顆鍵只改共用記憶體，不重開。
const path = require('path');
const { Worker } = require('worker_threads');
const koffi = require('koffi');
const { log } = require('./logger');

const BUTTON_CODES = { off: 0, x1: 1, x2: 2, middle: 3 };
const WM_QUIT = 0x0012;

const user32 = koffi.load('user32.dll');
const PostThreadMessageW = user32.func('bool __stdcall PostThreadMessageW(uint32 threadId, uint32 msg, uintptr_t wParam, intptr_t lParam)');

const shared = new SharedArrayBuffer(4);
const config = new Int32Array(shared);
let worker = null;
let workerThreadId = 0;
let handlers = { onDown: () => {}, onUp: () => {} };

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
    if (msg.type === 'down') handlers.onDown();
    else if (msg.type === 'up') handlers.onUp();
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

// trigger: 'off' | 'x1' | 'x2' | 'middle'
function setMouseTrigger(trigger, nextHandlers) {
  if (nextHandlers) handlers = nextHandlers;
  const code = BUTTON_CODES[trigger] || 0;
  Atomics.store(config, 0, code);
  if (code && !worker) startWorker();
  else if (!code && worker) stopWorker();
  log.info('[mouse] 滑鼠觸發鍵 →', code ? trigger : '不使用');
}

function stopMouseHook() {
  Atomics.store(config, 0, 0);
  stopWorker();
}

module.exports = { setMouseTrigger, stopMouseHook };
