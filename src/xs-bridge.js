// 小帥格（0.1.25）：滾輪中鍵收音後，把狀態與整段辨識文字交給桌面小帥 desk-xs（本機 127.0.0.1:18961）。
// NoType 只負責收音與語音轉文字；要不要做、怎麼回，全在 Mac mini 的 Luna，回話由客廳喇叭念。
// desk-xs 每次啟動重產通行碼寫在 %APPDATA%\desk-xs\bridge-token，這裡每次送之前重讀（desk-xs 重開也接得上）。
const fs = require('fs');
const path = require('path');
const http = require('http');
const { log } = require('./logger');

const PORT = 18961;
const PASS_PATH = path.join(process.env.APPDATA || '', 'desk-xs', 'bridge-token');

function readPass() {
  try { return fs.readFileSync(PASS_PATH, 'utf-8').trim(); } catch { return ''; }
}

/** 送一個請求給 desk-xs；回 { ok, status, error } */
function post(urlPath, body, timeoutMs = 1500) {
  const pass = readPass();
  if (!pass) return Promise.resolve({ ok: false, status: 0, error: '桌面小帥沒有開' });
  const data = Buffer.from(JSON.stringify(body));
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: urlPath, method: 'POST', timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, 'x-bridge-token': pass },
    }, (res) => {
      res.resume();
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ ok: false, status: 0, error: /ECONNREFUSED|timeout/.test(e.message) ? '桌面小帥沒有開' : e.message }));
    req.end(data);
  });
}

async function sendState(state, text) {
  const r = await post('/xs/state', text ? { state, text } : { state });
  if (!r.ok) log.warn('[xs] 狀態送不出去', state, r.status, r.error || '');
  return r;
}

async function sendText(text) {
  const r = await post('/xs/text', { text }, 3000);
  log.info('[xs] 辨識文字交給桌面小帥', r.ok ? 'OK' : `失敗 ${r.status} ${r.error || ''}`, '長度', text.length);
  return r;
}

module.exports = { sendState, sendText };
