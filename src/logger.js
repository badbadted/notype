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
  // 同步輸出到主控台（開發時用）
  const fn = level === 'ERROR' ? console.error : console.log;
  fn(line.trimEnd());
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

module.exports = { log };
