// 全域快捷鍵 + 錄音流程控制（按住 F9 錄音、放開停止；輕按 F9 切換連續聽寫）
const { globalShortcut, clipboard } = require('electron');
const koffi = require('koffi');
const { getStore } = require('./store');
const {
  startRecording, stopRecording, cancelRecording, startListening, stopListening, saveAudioBuffer, cleanupTempAudio,
} = require('./recorder');
const { showOverlay, hideOverlay } = require('./overlay');
const { setMicState } = require('./micbutton');
const { transcribe } = require('./api/stt');
const { polishText, reviseText, getActiveRole } = require('./api/llm');
const { typeText, copyToClipboard, pressEnter, copySelection, paste, selectLeft, backupClipboard, restoreClipboard } = require('./typer');
const { log } = require('./logger');

const user32 = koffi.load('user32.dll');
const GetAsyncKeyState = user32.func('short __stdcall GetAsyncKeyState(int vKey)');

let isRecording = false;
let isProcessing = false; // STT/LLM pipeline 進行中旗標，避免並發兩輪互踩暫存檔（M3）
// isProcessing 看守：任何路徑漏放旗標（例外、卡住）都會在 40s 後自動重置，
// 避免熱鍵被永久卡死（F7/F9 靜默沒反應）。正常釋放時 clear。
let _procWatchdog = null;
function setProcessing(v) {
  isProcessing = v;
  if (_procWatchdog) { clearTimeout(_procWatchdog); _procWatchdog = null; }
  if (v) {
    _procWatchdog = setTimeout(() => {
      log.warn('[flow] isProcessing 逾時 40s 未釋放，強制重置（backstop）');
      isProcessing = false;
      _procWatchdog = null;
    }, 40000);
  }
}
let keyPollTimer = null;
let pollVks = [0x78]; // 目前錄音熱鍵的輪詢鍵（由 startRec/startReviseRec 設定）
let mainVks = [0x78]; // 語音輸入主熱鍵（F9）的 VK
let reviseVks = [0x76]; // 語音改寫熱鍵（F7）的 VK
let captureMode = 'insert'; // 'insert'=語音輸入；'revise'=語音改寫（依指令改寫選取文字）
let reviseSelectionPromise = null; // 改寫模式：按下時複製選取文字的 Promise
let reviseBackup = null; // 改寫模式：使用者原剪貼簿備份
// 記住「上一段剛用 F9 輸入的文字」，讓 F7 不必手動選字就能改寫剛講的內容。
// 只在自動貼上模式且未送出時有效；游標若被移動則可能失準（就地取代的本質限制）。
let lastInsertText = '';

// ── 連續聽寫狀態 ──────────────────────────────────────
// 輕按 F9（按住不到 TAP_MS）→ 進入連續聽寫：renderer 以 VAD 自動切句，每句辨識後貼上，再按一次 F9 結束。
// 按住 F9 超過 TAP_MS → 維持原本的按住說話。
const TAP_MS = 300;
let pressStartedAt = 0;
let isListening = false;    // 連續聽寫中
let listenSingle = false;   // 單句模式：說完一句就自動結束
let listenStopping = false; // 已要求停止，等 renderer 回報 'stopped'
let listenStopWatchdog = null;
let isSpeaking = false;     // VAD 判定目前有人在說話
let segPending = 0;         // 排隊中/處理中的句子數
let segChain = Promise.resolve(); // 句子依序處理，避免並發互踩暫存檔與貼上順序
let listenCopyBuffer = '';  // 只複製到剪貼簿模式：本次聽寫累積的文字
let idleTimer = null;
let waitReleaseTimer = null; // 結束聽寫後等 F9 放開，期間忽略按鍵自動連發
let overlayRestoreTimer = null;

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
    return globalShortcut.register(accel, onMainHotkey);
  } catch { return false; }
}

// 主熱鍵按下：聽寫中 → 結束聽寫；否則開始錄音（放開時再判斷是輕按還是按住）
function onMainHotkey() {
  if (waitReleaseTimer) return; // 剛結束聽寫、鍵還沒放開 → 忽略自動連發
  if (isListening) {
    stopListen();
    waitForRelease(mainVks);
    return;
  }
  if (!isRecording) startRec();
}

// 浮動麥克風鈕：滑鼠點一下開始連續聽寫，再點一下結束。
// 不經熱鍵、沒有「按住」可言，所以直接進連續聽寫（輕按設成單句時則說完一句自動結束）。
function toggleListenFromButton() {
  if (isListening) { stopListen(); return; }
  if (isRecording || waitReleaseTimer) return;
  if (isProcessing) { showOverlay('error', '處理中，請稍候'); hideOverlay(1500); log.info('[flow] 麥克風鈕被 isProcessing 擋'); return; }
  const store = getStore();
  const provider = store.get('sttProvider') || 'groq';
  const keyField = provider === 'openai' ? 'openaiApiKey' : 'groqApiKey';
  if (!store.get(keyField)) {
    showOverlay('error', '尚未設定 API Key');
    hideOverlay(2500);
    return;
  }
  log.info('[mic] 麥克風鈕 → 開始聽寫');
  startListen(store.get('tapAction') === 'single');
}

function waitForRelease(vks) {
  if (waitReleaseTimer) clearInterval(waitReleaseTimer);
  waitReleaseTimer = setInterval(() => {
    if (vks.some((vk) => !isKeyDown(vk))) { clearInterval(waitReleaseTimer); waitReleaseTimer = null; }
  }, 80);
}

function registerShortcut() {
  globalShortcut.unregisterAll();
  const store = getStore();
  const wanted = store.get('hotkey') || 'F9';

  const candidates = [wanted, ...FALLBACKS.filter((f) => f !== wanted)];
  for (const accel of candidates) {
    if (tryRegister(accel)) {
      mainVks = acceleratorToVks(accel);
      pollVks = mainVks;
      if (accel !== wanted) {
        store.set('hotkey', accel);
        log.warn(`[shortcut] "${wanted}" 無法註冊，已改用 ${accel} 並回寫設定`);
      } else {
        log.info(`[shortcut] 已註冊 ${accel}（按住說話）`);
      }
      registerSubmitToggleHotkey(); // 一併註冊「說完自動送出」開關熱鍵
      registerPolishHotkey(); // 一併註冊「選字即潤稿」熱鍵
      registerReviseHotkey(); // 一併註冊「語音改寫」熱鍵
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

// 選字即潤稿的熱鍵（自我修復）
const POLISH_FALLBACKS = ['F8', 'CommandOrControl+Shift+P', 'Alt+X'];
function registerPolishHotkey() {
  const store = getStore();
  const wanted = store.get('polishHotkey') || 'F8';
  const candidates = [wanted, ...POLISH_FALLBACKS.filter((f) => f !== wanted)];
  for (const accel of candidates) {
    let ok = false;
    try { ok = globalShortcut.register(accel, polishSelection); } catch { ok = false; }
    if (ok) {
      if (accel !== wanted) { store.set('polishHotkey', accel); log.warn(`[shortcut] 選字潤稿熱鍵改用 ${accel}`); }
      else log.info(`[shortcut] 已註冊選字潤稿熱鍵 ${accel}`);
      return accel;
    }
  }
  log.warn('[shortcut] 選字潤稿熱鍵註冊失敗');
  return null;
}

// 選字即潤稿：複製目前選取 → 依生效角色潤稿 → 就地貼回取代，最後還原使用者原剪貼簿
async function polishSelection() {
  if (isListening) { flashListenBusy(); return; }
  if (isRecording || isProcessing) return;
  const store = getStore();
  if (store.get('llmEnabled') !== true) { showOverlay('error', '潤稿未啟用'); hideOverlay(2500); return; }

  const role = getActiveRole(store);
  const provider = (role && role.model) || store.get('llmProvider') || 'groq';
  const keyField = provider === 'openai' ? 'openaiApiKey' : 'groqApiKey';
  if (!store.get(keyField)) { showOverlay('error', '尚未設定 API Key'); hideOverlay(2500); return; }

  isProcessing = true;
  const backup = backupClipboard(); // 使用者原本剪貼簿（多格式）
  try {
    const selected = await copySelection(); // Ctrl+C → 讀取選取文字
    if (!selected.trim()) {
      showOverlay('error', '沒有選取文字');
      hideOverlay(2000);
      return;
    }
    showOverlay('polishing', role ? role.name : '');
    const out = await polishText(selected);
    clipboard.writeText(out);
    await paste(); // Ctrl+V 取代選取
    showOverlay('done', '已潤稿取代');
    hideOverlay(1500);
  } catch (err) {
    log.error('[polish-sel] 失敗', err);
    showOverlay('error', err && err.message ? err.message.slice(0, 40) : '潤稿失敗');
    hideOverlay(3000);
  } finally {
    setTimeout(() => { try { restoreClipboard(backup); } catch { /* 忽略 */ } }, 250);
    isProcessing = false;
  }
}

// 語音改寫的熱鍵（按住說指令；自我修復）
const REVISE_FALLBACKS = ['F7', 'CommandOrControl+Shift+E', 'Alt+C'];
function registerReviseHotkey() {
  const store = getStore();
  const wanted = store.get('reviseHotkey') || 'F7';
  const candidates = [wanted, ...REVISE_FALLBACKS.filter((f) => f !== wanted)];
  for (const accel of candidates) {
    let ok = false;
    try { ok = globalShortcut.register(accel, () => { if (!isRecording) startReviseRec(); }); } catch { ok = false; }
    if (ok) {
      reviseVks = acceleratorToVks(accel);
      if (accel !== wanted) { store.set('reviseHotkey', accel); log.warn(`[shortcut] 語音改寫熱鍵改用 ${accel}`); }
      else log.info(`[shortcut] 已註冊語音改寫熱鍵 ${accel}`);
      return accel;
    }
  }
  log.warn('[shortcut] 語音改寫熱鍵註冊失敗');
  return null;
}

// 語音改寫：按住熱鍵時 → 複製目前選取文字 + 開始錄「修改指令」，放開後由 handleReviseAudio 處理
function startReviseRec() {
  if (isRecording) return;
  if (isListening) { flashListenBusy(); return; }
  if (isProcessing) { showOverlay('error', '處理中，請稍候'); hideOverlay(1500); log.info('[revise] F7 被 isProcessing 擋'); return; }
  const store = getStore();
  if (store.get('llmEnabled') !== true) { showOverlay('error', '潤稿未啟用'); hideOverlay(2500); return; }
  const role = getActiveRole(store);
  const provider = (role && role.model) || store.get('llmProvider') || 'groq';
  const keyField = provider === 'openai' ? 'openaiApiKey' : 'groqApiKey';
  if (!store.get(keyField)) { showOverlay('error', '尚未設定 API Key'); hideOverlay(2500); return; }

  captureMode = 'revise';
  reviseBackup = backupClipboard();          // 使用者原剪貼簿
  reviseSelectionPromise = copySelection();   // 背景複製選取（Ctrl+C），放開後才 await
  isRecording = true;
  pollVks = reviseVks;
  showOverlay('recording', '口述要怎麼改');
  startRecording();
  keyPollTimer = setInterval(() => {
    if (pollVks.some((vk) => !isKeyDown(vk))) stopRec();
  }, 80);
}

// 切換「說完自動送出」開/關，浮窗閃示狀態
function toggleAutoSubmit() {
  if (isRecording) return; // 錄音中不切換
  const store = getStore();
  const now = !(store.get('autoSubmit') === true);
  store.set('autoSubmit', now);
  log.info('[shortcut] 即時送出 →', now);
  showOverlay('toggle', now ? '已開啟' : '已關閉');
  restoreOverlay(1200);
}

function startRec() {
  if (isRecording) return;
  if (isProcessing) { showOverlay('error', '處理中，請稍候'); hideOverlay(1500); log.info('[flow] F9 被 isProcessing 擋'); return; }
  // 沒設金鑰時不錄音，提示去設定
  const store = getStore();
  const provider = store.get('sttProvider') || 'groq';
  const keyField = provider === 'openai' ? 'openaiApiKey' : 'groqApiKey';
  if (!store.get(keyField)) {
    showOverlay('error', '尚未設定 API Key');
    hideOverlay(2500);
    return;
  }

  captureMode = 'insert';
  isRecording = true;
  pollVks = mainVks;
  pressStartedAt = Date.now();
  // 浮窗顯示目前潤稿角色（潤稿開啟時）
  const role = store.get('llmEnabled') === true ? getActiveRole(store) : null;
  showOverlay('recording', role ? role.name : '');
  startRecording();

  // 每 80ms 檢查熱鍵是否放開（任一鍵放開即停止）；按不到 TAP_MS 視為輕按 → 改進入連續聽寫
  keyPollTimer = setInterval(() => {
    if (!pollVks.some((vk) => !isKeyDown(vk))) return;
    const tapAction = store.get('tapAction') || 'continuous';
    if (tapAction !== 'off' && Date.now() - pressStartedAt < TAP_MS) {
      cancelRec();
      startListen(tapAction === 'single');
    } else {
      stopRec();
    }
  }, 80);
}

// 取消錄音（丟棄音訊，不送辨識）
function cancelRec() {
  if (!isRecording) return;
  isRecording = false;
  if (keyPollTimer) { clearInterval(keyPollTimer); keyPollTimer = null; }
  cancelRecording();
}

function stopRec() {
  if (!isRecording) return;
  isRecording = false;
  if (keyPollTimer) { clearInterval(keyPollTimer); keyPollTimer = null; }
  stopRecording(); // → recorder onstop → 'audio-data' IPC → handleAudioData
}

// 由 main.js 的 ipcMain.on('audio-data') 呼叫
async function handleAudioData(audioBuffer) {
  // 語音改寫模式 → 交給專屬處理（含自己的空音訊與清理），並重置模式
  if (captureMode === 'revise') {
    captureMode = 'insert';
    return handleReviseAudio(audioBuffer);
  }

  // 空音訊（短按未真正錄到聲音 / 冷啟動競態收尾）→ 直接收尾，不送 STT，也不佔用 processing 旗標
  if (!audioBuffer || audioBuffer.byteLength === 0 || audioBuffer.length === 0) {
    log.info('[flow] 空音訊，略過（可能為短按）');
    showOverlay('done', '沒有偵測到語音');
    hideOverlay(1200);
    return;
  }

  // 上一輪 STT/LLM 還在跑時又來一輪 → 忽略，避免兩輪寫/刪暫存檔互踩（M3）
  if (isProcessing) {
    log.warn('[flow] 前一輪仍在處理中，忽略本次（避免並發互踩暫存檔）');
    showOverlay('error', '處理中，請稍候');
    hideOverlay(1500);
    return;
  }
  await runInsertPipeline(audioBuffer, { ext: 'webm', continuous: false });
}

// 語音輸入共用流程：存檔 → STT → 潤稿 → 貼上/複製。按住說話與連續聽寫共用。
// continuous=true 時：過濾短句幻覺、不自動關浮窗（由聽寫流程接手）、剪貼簿模式累積文字。
// 回傳 { ok, text, doneMsg }；呼叫端須確保同一時間只有一輪在跑（isProcessing 檢查 / segChain 排隊）。
async function runInsertPipeline(audioBuffer, { ext = 'webm', continuous = false } = {}) {
  const store = getStore();
  setProcessing(true);

  // 本輪專屬暫存檔路徑，全程用區域變數傳遞，cleanup 只刪自己這輪的檔
  // 注意：saveAudioBuffer 內部 Buffer.from / fs.writeFileSync 可能丟錯（磁碟滿、無權限），
  // 必須放進 try，否則旗標永遠卡 true → 後續所有 F9 觸發被忽略，只能重啟 App（D1）。
  let audioPath;
  try {
    audioPath = saveAudioBuffer(audioBuffer, ext);
    showOverlay('processing', continuous ? '連續聽寫・語音轉文字' : '');
    const rawText = await transcribe(audioPath, { strictFilter: continuous });
    log.info('[flow] STT 結果長度', rawText.length, continuous ? '(連續)' : '');

    if (!rawText) {
      if (!continuous) {
        showOverlay('done', '沒有偵測到語音');
        hideOverlay(1500);
      }
      return { ok: true, text: '' };
    }

    showOverlay('polishing');
    const finalText = await polishText(rawText);
    let doneMsg;

    if (store.get('copyToClipboard') === true) {
      if (continuous) {
        listenCopyBuffer += finalText;
        copyToClipboard(listenCopyBuffer); // 累積本次聽寫全部內容，避免後一句蓋掉前一句
      } else {
        copyToClipboard(finalText);
      }
      lastInsertText = ''; // 沒貼進欄位，無法就地改寫
      doneMsg = '已複製到剪貼簿';
    } else {
      await typeText(finalText);
      // 說完自動送出：貼上後按 Enter（聊天視窗用）
      if (store.get('autoSubmit') === true) {
        await pressEnter();
        lastInsertText = ''; // 已送出，游標移走，不再記
        doneMsg = '已送出';
      } else {
        lastInsertText = finalText; // 記住剛輸入的內容，F7 可直接改寫
        doneMsg = '已貼上';
      }
    }
    if (!continuous) {
      showOverlay('done', doneMsg);
      hideOverlay(1500);
    }
    return { ok: true, text: finalText, doneMsg };
  } catch (err) {
    log.error('[flow] 處理失敗', err);
    showOverlay('error', err && err.message ? err.message.slice(0, 40) : '處理失敗');
    if (!continuous) hideOverlay(3500);
    return { ok: false, text: '' };
  } finally {
    // audioPath 可能因 saveAudioBuffer 丟錯而為 undefined；
    // 不可直接傳 undefined 給 cleanupTempAudio（會退回刪 currentAudioPath，誤刪他輪檔）。
    if (audioPath) cleanupTempAudio(audioPath); // 只刪本輪自己的檔，不影響其他輪
    setProcessing(false); // 任何錯誤路徑都會走到這，旗標必釋放
  }
}

// ── 連續聽寫 ──────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hotkeyLabel() {
  return (getStore().get('hotkey') || 'F9').replace(/CommandOrControl|Control/gi, 'Ctrl');
}

function showListeningOverlay(detail) {
  if (overlayRestoreTimer) { clearTimeout(overlayRestoreTimer); overlayRestoreTimer = null; }
  if (isSpeaking) {
    showOverlay('recording', `連續聽寫・再按 ${hotkeyLabel()} 結束`);
  } else {
    showOverlay('listening', detail || (listenSingle ? '說完一句自動結束' : `再按 ${hotkeyLabel()} 結束`));
  }
}

// 暫時性提示結束後：聽寫中 → 回到聆聽浮窗；否則關閉浮窗
function restoreOverlay(delay) {
  if (!isListening) { hideOverlay(delay); return; }
  if (overlayRestoreTimer) clearTimeout(overlayRestoreTimer);
  overlayRestoreTimer = setTimeout(() => {
    overlayRestoreTimer = null;
    if (isListening && !isProcessing) showListeningOverlay();
  }, delay);
}

function flashListenBusy() {
  showOverlay('error', `連續聽寫中，請先按 ${hotkeyLabel()} 結束`);
  restoreOverlay(1800);
}

function clearIdleTimer() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
}

// 閒置自動結束：避免忘了關、麥克風整天開著
function resetIdleTimer() {
  clearIdleTimer();
  const sec = Number(getStore().get('listenIdleTimeoutSec'));
  if (!isListening || !(sec > 0)) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (!isListening) return;
    if (isSpeaking) { resetIdleTimer(); return; } // 還在講話，不打斷
    log.info(`[listen] 閒置 ${sec}s，自動結束`);
    stopListen('閒置過久，已自動結束');
  }, sec * 1000);
}

function startListen(single) {
  if (isListening) return;
  if (listenStopping) { showOverlay('error', '聽寫結束中，請稍候'); hideOverlay(1500); return; }
  const store = getStore();
  isListening = true;
  listenSingle = single === true;
  isSpeaking = false;
  listenCopyBuffer = '';
  const silenceMs = Number(store.get('vadSilenceMs')) || 1200;
  log.info('[listen] 開始連續聽寫', listenSingle ? '(單句)' : '', 'silenceMs=', silenceMs);
  showListeningOverlay('啟動麥克風…');
  startListening({ silenceMs });
  resetIdleTimer();
  setMicState('listening');
}

function stopListen(reason) {
  if (!isListening) return;
  isListening = false;
  isSpeaking = false;
  listenStopping = true;
  setMicState('idle');
  clearIdleTimer();
  if (overlayRestoreTimer) { clearTimeout(overlayRestoreTimer); overlayRestoreTimer = null; }
  if (listenStopWatchdog) clearTimeout(listenStopWatchdog);
  listenStopWatchdog = setTimeout(() => {
    listenStopWatchdog = null;
    if (listenStopping) { log.warn('[listen] 5s 未收到 stopped，強制重置'); listenStopping = false; }
  }, 5000);
  stopListening(); // renderer 會把講到一半的那句也送出（submitUserSpeechOnPause）
  log.info('[listen] 結束連續聽寫', reason || '');
  if (segPending === 0 && !isProcessing) {
    showOverlay('listenoff', reason || '');
    hideOverlay(1500);
  }
}

// renderer 的 VAD 事件
function handleListenEvent(name) {
  switch (name) {
    case 'ready':
      log.info('[listen] 麥克風就緒');
      if (isListening && !isProcessing) showListeningOverlay();
      break;
    case 'speech-start':
      isSpeaking = true;
      resetIdleTimer();
      if (isListening && !isProcessing) showListeningOverlay();
      break;
    case 'misfire':
      isSpeaking = false;
      if (isListening && !isProcessing) showListeningOverlay();
      break;
    case 'stopped':
      listenStopping = false;
      if (listenStopWatchdog) { clearTimeout(listenStopWatchdog); listenStopWatchdog = null; }
      if (isListening) { // 非使用者要求的停止（例如麥克風 / VAD 啟動失敗，錯誤已由 recorder-error 顯示）
        log.warn('[listen] renderer 已停止聆聽，同步結束');
        isListening = false;
        isSpeaking = false;
        setMicState('idle');
        clearIdleTimer();
      }
      break;
    default:
      break;
  }
}

// renderer 切好的一句話（16kHz WAV）→ 排隊依序辨識貼上
function handleSegment(audioBuffer) {
  isSpeaking = false;
  if (!audioBuffer || !(audioBuffer.byteLength || audioBuffer.length)) return;
  segPending++;
  if (listenSingle && isListening) stopListen(); // 單句模式：收到第一句就結束（segPending 已 +1，不會先關浮窗）
  resetIdleTimer();
  segChain = segChain
    .then(() => processSegment(audioBuffer))
    .catch((err) => log.error('[listen] 句子處理失敗', err));
}

async function processSegment(audioBuffer) {
  let res = { ok: false };
  try {
    res = await runInsertPipeline(audioBuffer, { ext: 'wav', continuous: true });
    if (!res.ok) await sleep(2000); // 讓使用者看得到錯誤訊息
  } finally {
    segPending--;
    if (isListening) {
      showListeningOverlay(res.ok && res.text ? `${res.doneMsg}・繼續聽…` : undefined);
    } else if (segPending === 0) {
      if (res.ok && res.text) showOverlay('done', res.doneMsg);
      hideOverlay(1200);
    }
  }
}

// 語音改寫：辨識「修改指令」→ 依指令改寫先前選取的文字 → 就地貼回取代 → 還原原剪貼簿
async function handleReviseAudio(audioBuffer) {
  log.info('[revise] 進入處理，音訊 bytes=', audioBuffer ? (audioBuffer.byteLength || audioBuffer.length || 0) : 0);
  const backup = reviseBackup; reviseBackup = null;
  const selPromise = reviseSelectionPromise; reviseSelectionPromise = null;
  const restore = () => setTimeout(() => { try { restoreClipboard(backup); } catch { /* 忽略 */ } }, 250);

  // 沒錄到指令（短按/無聲）→ 還原剪貼簿並提示
  if (!audioBuffer || audioBuffer.byteLength === 0 || audioBuffer.length === 0) {
    showOverlay('error', '沒聽到修改指令');
    hideOverlay(2000);
    restore();
    return;
  }
  if (isProcessing) { showOverlay('error', '處理中，請稍候'); hideOverlay(1500); restore(); return; }
  setProcessing(true);

  let audioPath;
  try {
    audioPath = saveAudioBuffer(audioBuffer);
    showOverlay('processing', '辨識指令');
    const instruction = await transcribe(audioPath);
    const sel = (await (selPromise || Promise.resolve(''))) || '';
    const backupText = (backup && backup.text) || '';

    if (!instruction || !instruction.trim()) { showOverlay('error', '沒聽到修改指令'); hideOverlay(2500); return; }

    // 決定要改的目標：① 有手動選取 → 用選取（仍高亮，貼上直接取代）
    // ② 沒選取但剛用 F9 輸入過 → 用那段，並先 Shift+← 選回它再取代（免手動選字）
    const hasSelection = sel.trim() && sel !== backupText;
    let target;
    let reselectLen = 0;
    if (hasSelection) {
      target = sel;
    } else if (lastInsertText.trim()) {
      target = lastInsertText;
      reselectLen = [...lastInsertText].length;
    } else {
      showOverlay('error', '沒有可改的文字（先選取或先用 F9 輸入）');
      hideOverlay(3000);
      return;
    }

    log.info('[revise] 指令=', instruction.slice(0, 30), '| 來源=', hasSelection ? '選取' : '剛輸入', '| 目標長=', target.length, '| reselect=', reselectLen);
    showOverlay('polishing', '套用修改');
    const revised = await reviseText(target, instruction);
    clipboard.writeText(revised);
    if (reselectLen > 0) await selectLeft(reselectLen); // 沒選取時，先選回剛輸入的文字
    await paste(); // Ctrl+V 取代
    lastInsertText = revised; // 更新，讓 F7 可連續再修
    log.info('[revise] 完成，改後長=', revised.length);
    showOverlay('done', '已依指令修改');
    hideOverlay(1500);
  } catch (err) {
    log.error('[revise] 失敗', err);
    showOverlay('error', err && err.message ? err.message.slice(0, 40) : '改寫失敗');
    hideOverlay(3000);
  } finally {
    if (audioPath) cleanupTempAudio(audioPath);
    restore();
    setProcessing(false);
  }
}

function unregisterShortcut() {
  if (keyPollTimer) { clearInterval(keyPollTimer); keyPollTimer = null; }
  if (isListening) stopListen();
  globalShortcut.unregisterAll();
}

module.exports = {
  registerShortcut, unregisterShortcut, handleAudioData, handleSegment, handleListenEvent,
  toggleListenFromButton,
};
