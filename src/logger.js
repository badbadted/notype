const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// 跨機 debug：log 寫到系統 temp 目錄，方便在沒有主控台的打包環境追問題
let logFilePath = null;

function getLogPath() {
  if (!logFilePath) {
    const dir = app ? app.getPath('temp') : require('os').tmpdir();
    logFilePath = path.join(dir, 'notype-debug.log');
  }
  return logFilePath;
}

function ts() {
  // 不依賴語系的本地時間戳
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function write(level, args) {
  const line = `[${ts()}] [${level}] ${args.map(formatArg).join(' ')}\n`;
  try {
    fs.appendFileSync(getLogPath(), line, 'utf8');
  } catch {
    /* log 失敗不可拖垮主程序 */
  }
  // 同步輸出到主控台（開發時用）。
  // 由別的程式啟動時 stdout/stderr 可能是管線，對方關掉後寫入會丟 EPIPE；
  // 主控台只是輔助，寫不出去就算了，不能變成 uncaughtException 彈窗。
  if (consoleBroken) return;
  const fn = level === 'ERROR' ? console.error : console.log;
  try {
    fn(line.trimEnd());
  } catch (err) {
    if (isPipeError(err)) consoleBroken = true;
  }
}

let consoleBroken = false;

function isPipeError(err) {
  return !!err && (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED' || err.code === 'EOF');
}

// 非同步寫入失敗時 stream 會發 'error' 事件，沒人接就變 uncaughtException
for (const s of [process.stdout, process.stderr]) {
  if (s && typeof s.on === 'function') {
    s.on('error', (err) => {
      if (isPipeError(err)) consoleBroken = true;
    });
  }
}

function formatArg(a) {
  if (a instanceof Error) return `${a.message}\n${a.stack || ''}`;
  if (typeof a === 'object') {
    try {
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  }
  return String(a);
}

const log = {
  info: (...args) => write('INFO', args),
  warn: (...args) => write('WARN', args),
  error: (...args) => write('ERROR', args),
  path: getLogPath,
};

module.exports = { log, isPipeError };
