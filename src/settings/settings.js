// 設定頁渲染邏輯 — 透過 window.notype 與主程序 IPC 通訊
const $ = (id) => document.getElementById(id);
let s = {}; // 本地設定鏡像

// ── 載入 ──────────────────────────────────────────────
async function load() {
  s = await window.notype.getSettings();
  // STT 服務
  setSeg('sttSeg', s.sttProvider);
  setSeg('llmSeg', s.llmProvider);
  $('language').value = s.language || 'zh';
  $('llmStyle').value = s.llmStyle || 'clean';
  $('llmCustomPrompt').value = s.llmCustomPrompt || '';
  setToggle('llmEnabled', s.llmEnabled);
  setToggle('launchAtStartup', s.launchAtStartup);
  setToggle('autoSubmit', s.autoSubmit);
  setRadio(s.copyToClipboard === true);
  syncAutoSubmitDim();
  syncKeyField();
  syncCustomPrompt();
  syncLlmDim();
  syncBanner();

  // 版本號 + 目前實際生效的熱鍵（避免 UI 與實際註冊的鍵不一致造成「以為壞了」）
  const ver = await window.notype.getVersion();
  const hk = prettyHotkey(s.hotkey);
  $('ver').textContent = `NoType v${ver}`;
  $('hotkeyKbd').textContent = hk;
}

// 把 Electron accelerator 轉成好讀的顯示（CommandOrControl/Control → Ctrl）
function prettyHotkey(accel) {
  if (!accel) return 'F9';
  return accel.replace(/CommandOrControl|Control/gi, 'Ctrl').replace(/\+/g, ' + ');
}

// ── 元件 helper ───────────────────────────────────────
function setSeg(segId, value) {
  $(segId).querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === value));
}
function getSeg(segId) {
  const on = $(segId).querySelector('button.on');
  return on ? on.dataset.v : null;
}
function setToggle(id, on) { $(id).classList.toggle('on', on === true); }
function setRadio(copy) {
  $('optCopy').classList.toggle('sel', copy);
  $('optType').classList.toggle('sel', !copy);
  syncAutoSubmitDim();
}
function syncAutoSubmitDim() {
  // 「只複製到剪貼簿」模式沒有貼上動作，自動送出不適用 → 淡化
  const copyMode = $('optCopy').classList.contains('sel');
  const row = $('autoSubmitRow');
  if (!row) return;
  row.style.opacity = copyMode ? '.4' : '1';
  row.style.pointerEvents = copyMode ? 'none' : 'auto';
}

function activeKeyName() { return getSeg('sttSeg') === 'groq' ? 'groqApiKey' : 'openaiApiKey'; }
function syncKeyField() {
  $('apiKey').value = s[activeKeyName()] || '';
  $('keyStatus').textContent = '';
  $('keyStatus').className = 'status';
}
function syncCustomPrompt() {
  $('llmCustomPrompt').classList.toggle('show', $('llmStyle').value === 'custom');
}
function syncLlmDim() {
  // 潤稿關閉時，淡化模型/風格列（保留開關本身可點）
  const off = !$('llmEnabled').classList.contains('on');
  $('llmCard').querySelectorAll('.row:not(:first-child), #llmStyle, #llmCustomPrompt').forEach((el) => {
    el.style.opacity = off ? '.4' : '1';
    el.style.pointerEvents = off ? 'none' : 'auto';
  });
}
function syncBanner() {
  const hasKey = (s[activeKeyName()] || '').trim().length > 0;
  $('banner').classList.toggle('show', !hasKey);
}

// ── 事件綁定 ──────────────────────────────────────────
$('sttSeg').addEventListener('click', (e) => {
  const btn = e.target.closest('button'); if (!btn) return;
  setSeg('sttSeg', btn.dataset.v);
  syncKeyField();
  syncBanner();
});
$('llmSeg').addEventListener('click', (e) => {
  const btn = e.target.closest('button'); if (!btn) return;
  setSeg('llmSeg', btn.dataset.v);
});
$('llmEnabled').addEventListener('click', function () { this.classList.toggle('on'); syncLlmDim(); });
$('launchAtStartup').addEventListener('click', function () { this.classList.toggle('on'); });
$('autoSubmit').addEventListener('click', function () { this.classList.toggle('on'); });
$('llmStyle').addEventListener('change', syncCustomPrompt);
$('optType').addEventListener('click', () => setRadio(false));
$('optCopy').addEventListener('click', () => setRadio(true));
$('apiKey').addEventListener('input', () => {
  s[activeKeyName()] = $('apiKey').value.trim();
  syncBanner();
  $('keyStatus').textContent = '';
  $('keyStatus').className = 'status';
});

// 測試 API Key
$('btnTest').addEventListener('click', async () => {
  const provider = getSeg('sttSeg');
  const key = $('apiKey').value.trim();
  if (!key) { setStatus('bad', '請先填入 API Key'); return; }
  setStatus('testing', '測試中…');
  $('btnTest').disabled = true;
  try {
    const ok = await window.notype.testApiKey(provider, key);
    setStatus(ok ? 'ok' : 'bad', ok ? '✓ 金鑰有效' : '✗ 金鑰無效或網路錯誤');
  } catch {
    setStatus('bad', '✗ 測試失敗');
  } finally {
    $('btnTest').disabled = false;
  }
});
function setStatus(cls, txt) { $('keyStatus').className = 'status ' + cls; $('keyStatus').textContent = txt; }

// 儲存
$('btnSave').addEventListener('click', async () => {
  const payload = {
    sttProvider: getSeg('sttSeg'),
    openaiApiKey: s.openaiApiKey || '',
    groqApiKey: s.groqApiKey || '',
    language: $('language').value,
    llmEnabled: $('llmEnabled').classList.contains('on'),
    llmProvider: getSeg('llmSeg'),
    llmStyle: $('llmStyle').value,
    llmCustomPrompt: $('llmCustomPrompt').value,
    copyToClipboard: $('optCopy').classList.contains('sel'),
    autoSubmit: $('autoSubmit').classList.contains('on'),
    launchAtStartup: $('launchAtStartup').classList.contains('on'),
  };
  await window.notype.saveSettings(payload);
  s = { ...s, ...payload };
  $('savedTip').classList.add('show');
  setTimeout(() => $('savedTip').classList.remove('show'), 1800);
});

$('btnClose').addEventListener('click', () => window.close());

load();
