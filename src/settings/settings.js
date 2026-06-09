// 設定頁渲染邏輯 — 透過 window.notype 與主程序 IPC 通訊
const $ = (id) => document.getElementById(id);
let s = {};            // 本地設定鏡像
let roles = [];        // 角色清單（本地暫存，儲存時寫回）
let activeRoleId = null;
let editingId = null;  // 編輯器目前編輯的角色 id；null=新增

// ── 載入 ──────────────────────────────────────────────
async function load() {
  s = await window.notype.getSettings();
  roles = Array.isArray(s.roles) ? JSON.parse(JSON.stringify(s.roles)) : [];
  activeRoleId = s.activeRoleId || (roles[0] && roles[0].id) || null;

  setSeg('sttSeg', s.sttProvider);
  $('language').value = s.language || 'zh';
  setToggle('llmEnabled', s.llmEnabled);
  setToggle('launchAtStartup', s.launchAtStartup);
  setToggle('autoSubmit', s.autoSubmit);
  setRadio(s.copyToClipboard === true);
  renderRoles();
  syncKeyField();
  syncLlmDim();
  syncBanner();

  const ver = await window.notype.getVersion();
  $('ver').textContent = `NoType v${ver}`;
  $('hotkeyKbd').textContent = prettyHotkey(s.hotkey);
  const sh = $('submitHk');
  if (sh) sh.textContent = prettyHotkey(s.submitToggleHotkey || 'F10');
}

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
function syncLlmDim() {
  const off = !$('llmEnabled').classList.contains('on');
  const area = $('roleArea');
  area.style.opacity = off ? '.4' : '1';
  area.style.pointerEvents = off ? 'none' : 'auto';
}
function syncBanner() {
  const hasKey = (s[activeKeyName()] || '').trim().length > 0;
  $('banner').classList.toggle('show', !hasKey);
}

// ── 角色管理 ──────────────────────────────────────────
function esc(str) {
  return String(str || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function renderRoles() {
  const list = $('rolesList');
  list.innerHTML = roles.map((r) => `
    <div class="role ${r.id === activeRoleId ? 'active' : ''}" data-id="${esc(r.id)}">
      <span class="rdot"></span>
      <div class="rgrow">
        <div class="rnm">${esc(r.name)}</div>
        <div class="rdesc">${esc(r.desc || r.prompt || '')}</div>
      </div>
      <div class="racts">
        <span class="ric" data-act="edit" title="編輯">✏️</span>
        ${roles.length > 1 ? '<span class="ric" data-act="del" title="刪除">🗑️</span>' : ''}
      </div>
    </div>`).join('');
}
function selectRole(id) { activeRoleId = id; renderRoles(); }
function deleteRole(id) {
  if (roles.length <= 1) return;
  roles = roles.filter((r) => r.id !== id);
  if (activeRoleId === id) activeRoleId = roles[0].id;
  if (editingId === id) closeEditor();
  renderRoles();
}
function openEditor(id) {
  editingId = id;
  const r = roles.find((x) => x.id === id);
  $('edTitle').textContent = r ? '編輯角色' : '新增角色';
  $('edName').value = r ? r.name : '';
  $('edPrompt').value = r ? r.prompt : '';
  setSeg('edModel', (r && r.model) || s.llmProvider || 'groq');
  $('roleEditor').hidden = false;
  $('edName').focus();
}
function closeEditor() { editingId = null; $('roleEditor').hidden = true; }
function saveRole() {
  const name = $('edName').value.trim();
  const prompt = $('edPrompt').value.trim();
  if (!name) { $('edName').focus(); return; }
  if (!prompt) { $('edPrompt').focus(); return; }
  const model = getSeg('edModel') || 'groq';
  if (editingId) {
    const r = roles.find((x) => x.id === editingId);
    if (r) { r.name = name; r.prompt = prompt; r.model = model; r.desc = ''; }
  } else {
    const id = 'r_' + Date.now();
    roles.push({ id, name, prompt, model, desc: '' });
    activeRoleId = id; // 新增即設為生效
  }
  closeEditor();
  renderRoles();
}

// 事件委派：角色列表
$('rolesList').addEventListener('click', (e) => {
  const ic = e.target.closest('.ric');
  const row = e.target.closest('.role');
  if (!row) return;
  const id = row.dataset.id;
  if (ic) {
    if (ic.dataset.act === 'edit') openEditor(id);
    else if (ic.dataset.act === 'del') deleteRole(id);
  } else {
    selectRole(id);
  }
});
$('addRole').addEventListener('click', () => openEditor(null));
$('edModel').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setSeg('edModel', b.dataset.v); });
$('edCancel').addEventListener('click', closeEditor);
$('edSaveRole').addEventListener('click', saveRole);

// ── 其他事件 ──────────────────────────────────────────
$('sttSeg').addEventListener('click', (e) => {
  const btn = e.target.closest('button'); if (!btn) return;
  setSeg('sttSeg', btn.dataset.v);
  syncKeyField();
  syncBanner();
});
$('llmEnabled').addEventListener('click', function () { this.classList.toggle('on'); syncLlmDim(); });
$('launchAtStartup').addEventListener('click', function () { this.classList.toggle('on'); });
$('autoSubmit').addEventListener('click', function () { this.classList.toggle('on'); });
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
    roles,
    activeRoleId,
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
