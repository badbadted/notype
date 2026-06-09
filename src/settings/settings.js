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
  setRadio(s.copyToClipboard === true);
  syncKeyField();
  syncCustomPrompt();
  syncLlmDim();
  syncBanner();
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
    launchAtStartup: $('launchAtStartup').classList.contains('on'),
  };
  await window.notype.saveSettings(payload);
  s = { ...s, ...payload };
  $('savedTip').classList.add('show');
  setTimeout(() => $('savedTip').classList.remove('show'), 1800);
});

$('btnClose').addEventListener('click', () => window.close());

load();
