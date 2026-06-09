// 全域快捷鍵 + 錄音流程控制（按住 Alt+Space 錄音，放開停止）
const { globalShortcut } = require('electron');
const koffi = require('koffi');
const { getStore } = require('./store');
const { startRecording, stopRecording, saveAudioBuffer, cleanupTempAudio } = require('./recorder');
const { showOverlay, hideOverlay } = require('./overlay');
const { transcribe } = require('./api/stt');
const { polishText, getActiveRole } = require('./api/llm');
const { typeText, copyToClipboard, pressEnter } = require('./typer');
const { log } = require('./logger');

const user32 = koffi.load('user32.dll');
const GetAsyncKeyState = user32.func('short __stdcall GetAsyncKeyState(int vKey)');

let isRecording = false;
let keyPollTimer = null;
let pollVks = [0x78]; // 預設 F9，由 registerShortcut 依設定更新

const isKeyDown = (vk) => (GetAsyncKeyState(vk) & 0x8000) !== 0;

// 將 Electron accelerator（如 "F9" / "Control+Shift+Space"）解析為要輪詢的 VK 碼
function acceleratorToVks(accel) {
  const map = {
    control: 0x11, ctrl: 0x11, commandorcontrol: 0x11, cmdorctrl: 0x11,
    shift: 0x10, alt: 0x12, option: 0x12, space: 0x20,
  };
  return accel.split('+').map((tRaw) => {
    const t = tRaw.trim().toLowerCase();
    if (map[t] !== undefined) return map[t];
    if (/^f([1-9]|1[0-2])$/.test(t)) return 0x70 + (parseInt(t.slice(1), 10) - 1); // F1..F12
    if (/^[a-z]$/.test(t)) return t.toUpperCase().charCodeAt(0);                    // A..Z
    if (/^[0-9]$/.test(t)) return 0x30 + parseInt(t, 10);                           // 0..9
    return null;
  }).filter((v) => v !== null);
}

// 自我修復：設定的熱鍵若無法註冊（被系統/他 App 佔用，或舊檔殘留 Alt+Space），
// 自動退到可用的候選鍵並回寫設定，避免使用者卡在「按了沒反應」。
const FALLBACKS = ['F9', 'CommandOrControl+Shift+Space', 'Alt+Z', 'F10'];

function tryRegister(accel) {
  try {
    return globalShortcut.register(accel, () => { if (!isRecording) startRec(); });
  } catch { return false; }
}

function registerShortcut() {
  globalShortcut.unregisterAll();
  const store = getStore();
  const wanted = store.get('hotkey') || 'F9';

  const candidates = [wanted, ...FALLBACKS.filter((f) => f !== wanted)];
  for (const accel of candidates) {
    if (tryRegister(accel)) {
      pollVks = acceleratorToVks(accel);
      if (accel !== wanted) {
        store.set('hotkey', accel);
        log.warn(`[shortcut] "${wanted}" 無法註冊，已改用 ${accel} 並回寫設定`);
      } else {
        log.info(`[shortcut] 已註冊 ${accel}（按住說話）`);
      }
      registerSubmitToggleHotkey(); // 一併註冊「說完自動送出」開關熱鍵
      return accel;
    }
  }
  log.error('[shortcut] 所有候選熱鍵都註冊失敗');
  return null;
}

// 快速開關「說完自動送出」的熱鍵（與主熱鍵分開註冊，同樣自我修復）
const SUBMIT_FALLBACKS = ['F10', 'F8', 'CommandOrControl+Shift+Enter'];
function registerSubmitToggleHotkey() {
  const store = getStore();
  const wanted = store.get('submitToggleHotkey') || 'F10';
  const candidates = [wanted, ...SUBMIT_FALLBACKS.filter((f) => f !== wanted)];
  for (const accel of candidates) {
    let ok = false;
    try { ok = globalShortcut.register(accel, toggleAutoSubmit); } catch { ok = false; }
    if (ok) {
      if (accel !== wanted) { store.set('submitToggleHotkey', accel); log.warn(`[shortcut] 送出開關熱鍵改用 ${accel}`); }
      else log.info(`[shortcut] 已註冊送出開關熱鍵 ${accel}`);
      return accel;
    }
  }
  log.warn('[shortcut] 送出開關熱鍵全部註冊失敗（仍可從設定頁切換）');
  return null;
}

// 切換「說完自動送出」開/關，浮窗閃示狀態
function toggleAutoSubmit() {
  if (isRecording) return; // 錄音中不切換
  const store = getStore();
  const now = !(store.get('autoSubmit') === true);
  store.set('autoSubmit', now);
  log.info('[shortcut] 即時送出 →', now);
  showOverlay('toggle', now ? '已開啟' : '已關閉');
  hideOverlay(1200);
}

function startRec() {
  if (isRecording) return;
  // 沒設金鑰時不錄音，提示去設定
  const store = getStore();
  const provider = store.get('sttProvider') || 'groq';
  const keyField = provider === 'openai' ? 'openaiApiKey' : 'groqApiKey';
  if (!store.get(keyField)) {
    showOverlay('error', '尚未設定 API Key');
    hideOverlay(2500);
    return;
  }

  isRecording = true;
  // 浮窗顯示目前潤稿角色（潤稿開啟時）
  const role = store.get('llmEnabled') === true ? getActiveRole(store) : null;
  showOverlay('recording', role ? role.name : '');
  startRecording();

  // 每 80ms 檢查熱鍵是否放開（任一鍵放開即停止）
  keyPollTimer = setInterval(() => {
    if (pollVks.some((vk) => !isKeyDown(vk))) stopRec();
  }, 80);
}

function stopRec() {
  if (!isRecording) return;
  isRecording = false;
  if (keyPollTimer) { clearInterval(keyPollTimer); keyPollTimer = null; }
  stopRecording(); // → recorder onstop → 'audio-data' IPC → handleAudioData
}

// 由 main.js 的 ipcMain.on('audio-data') 呼叫
async function handleAudioData(audioBuffer) {
  const store = getStore();
  try {
    const audioPath = saveAudioBuffer(audioBuffer);

    showOverlay('processing');
    const rawText = await transcribe(audioPath);
    log.info('[flow] STT 結果長度', rawText.length);

    if (!rawText) {
      showOverlay('done', '沒有偵測到語音');
      hideOverlay(1500);
      return;
    }

    showOverlay('polishing');
    const finalText = await polishText(rawText);

    if (store.get('copyToClipboard') === true) {
      copyToClipboard(finalText);
      showOverlay('done', '已複製到剪貼簿');
    } else {
      await typeText(finalText);
      // 說完自動送出：貼上後按 Enter（聊天視窗用）
      if (store.get('autoSubmit') === true) {
        await pressEnter();
        showOverlay('done', '已送出');
      } else {
        showOverlay('done', '已貼上');
      }
    }
    hideOverlay(1500);
  } catch (err) {
    log.error('[flow] 處理失敗', err);
    showOverlay('error', err && err.message ? err.message.slice(0, 40) : '處理失敗');
    hideOverlay(3500);
  } finally {
    cleanupTempAudio();
  }
}

function unregisterShortcut() {
  if (keyPollTimer) { clearInterval(keyPollTimer); keyPollTimer = null; }
  globalShortcut.unregisterAll();
}

module.exports = { registerShortcut, unregisterShortcut, handleAudioData };
