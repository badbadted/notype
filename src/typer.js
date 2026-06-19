// 鍵盤模擬輸入（koffi 呼叫 Windows keybd_event）— 剪貼簿 + Ctrl+V，相容中文輸入法與所有 App
const { clipboard } = require('electron');
const koffi = require('koffi');
const { log } = require('./logger');

const user32 = koffi.load('user32.dll');
const keybd_event = user32.func('void __stdcall keybd_event(uint8_t bVk, uint8_t bScan, uint32_t dwFlags, uintptr_t dwExtraInfo)');

const VK_LMENU = 0xA4;   // Left Alt
const VK_RMENU = 0xA5;   // Right Alt
const VK_MENU = 0x12;    // Alt（通用）
const VK_SPACE = 0x20;
const VK_CONTROL = 0x11;
const VK_V = 0x56;
const VK_RETURN = 0x0D;
const KEYEVENTF_KEYUP = 0x0002;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 強制釋放所有可能卡住的修飾鍵（按住 Alt+Space 錄音後，系統常仍認為 Alt 被按住）
function releaseAllModifiers() {
  keybd_event(VK_LMENU, 0, KEYEVENTF_KEYUP, 0);
  keybd_event(VK_RMENU, 0, KEYEVENTF_KEYUP, 0);
  keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0);
  keybd_event(VK_SPACE, 0, KEYEVENTF_KEYUP, 0);
  keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0);
}

async function simulateCtrlV() {
  releaseAllModifiers();        // 貼上前先清掉卡住的 Alt，避免變成 Alt+Ctrl+V
  await sleep(150);
  keybd_event(VK_CONTROL, 0, 0, 0);
  await sleep(40);
  keybd_event(VK_V, 0, 0, 0);
  await sleep(40);
  keybd_event(VK_V, 0, KEYEVENTF_KEYUP, 0);
  await sleep(40);
  keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0);
  await sleep(40);
  releaseAllModifiers();        // 收尾再清一次
}

// ── 剪貼簿多格式備份 / 還原（H2）──────────────────────────────
// 只用 writeText 還原會洗掉使用者原本的圖片 / 檔案 / RTF / HTML。
// 改為依 availableFormats 抓取所有可保存格式，還原時依原格式寫回。

// 備份目前剪貼簿的所有可保存格式。回傳一個結構供 restoreClipboard 寫回。
function backupClipboard() {
  const formats = clipboard.availableFormats() || [];
  const backup = { text: '', html: '', rtf: '', image: null, bookmark: null, buffers: {}, empty: formats.length === 0 };
  try {
    backup.text = clipboard.readText() || '';
    if (formats.some((f) => f.includes('html'))) backup.html = clipboard.readHTML() || '';
    if (formats.some((f) => f.includes('rtf'))) backup.rtf = clipboard.readRTF() || '';
    if (formats.some((f) => f.startsWith('image'))) {
      const img = clipboard.readImage();
      if (img && !img.isEmpty()) backup.image = img;
    }
    // 書籤（URL + 標題），Windows 上常見於從瀏覽器複製連結
    try {
      const bm = clipboard.readBookmark();
      if (bm && (bm.url || bm.title)) backup.bookmark = bm;
    } catch { /* 平台不支援時略過 */ }
  } catch (err) {
    log.warn('[typer] 備份剪貼簿失敗，僅保留純文字', err);
  }
  return backup;
}

// 依備份結構還原剪貼簿，盡量保留原始多格式內容。
function restoreClipboard(backup) {
  if (!backup) return;
  try {
    // 原本剪貼簿是空的 → 還原成空，避免殘留注入文字
    if (backup.empty && !backup.text && !backup.image && !backup.html && !backup.rtf && !backup.bookmark) {
      clipboard.clear();
      return;
    }
    const data = {};
    if (backup.text) data.text = backup.text;
    if (backup.html) data.html = backup.html;
    if (backup.rtf) data.rtf = backup.rtf;
    if (backup.image) data.image = backup.image;
    if (backup.bookmark && backup.bookmark.url) {
      data.bookmark = backup.bookmark.title || backup.bookmark.url;
      data.text = data.text || backup.bookmark.url;
    }
    if (Object.keys(data).length > 0) clipboard.write(data);
    else clipboard.clear();
  } catch (err) {
    log.warn('[typer] 還原剪貼簿失敗，退回純文字還原', err);
    try { clipboard.writeText(backup.text || ''); } catch { /* 已盡力 */ }
  }
}

// ── type-and-restore 序列化鎖（H3）────────────────────────────
// 連續快速觸發時，若上一次的「還原」尚未執行，第二次備份會抓到「上次注入的文字」
// 當成原內容，最終把注入值回寫剪貼簿。用 Promise 鏈確保同一時間只跑一次完整流程，
// 並在還原前比對「目前剪貼簿是否仍是我們剛注入的文字」避免回寫自己的注入值。
let _chain = Promise.resolve();
// 貼上完成後再等的緩衝（讓目標 App 把剪貼簿真正讀完）。
// 原為 1000ms，會讓潤稿後的敏感文字在剪貼簿滯留近 1 秒（M1）。
// simulateCtrlV 內部已有 ~410ms 的 sleep 確保貼上落地，此處只需短緩衝即可立即還原。
const RESTORE_DELAY = 150;

// 透過剪貼簿 + Ctrl+V 把文字送進當前游標位置，事後還原剪貼簿（序列化，多格式保留）
// 回傳的 Promise 在「貼上完成」即 resolve（UX 快），但備份→還原全程掛在 _chain 上序列化：
// 下一次呼叫的 backupClipboard 必定等到上一次還原跑完，杜絕把上次注入值當原內容回寫（H3）。
function typeText(text) {
  if (!text) return Promise.resolve();

  let pasteDone;
  const pastePromise = new Promise((resolve) => { pasteDone = resolve; });

  const run = async () => {
    try {
      log.info('[typer] 輸入文字長度', text.length);
      const backup = backupClipboard(); // 鏈已序列化，不會抓到上一次的注入值
      clipboard.writeText(text);
      await sleep(180);
      await simulateCtrlV();
      pasteDone(); // 貼上完成 → 通知呼叫端可顯示「已貼上」
      // 還原前等貼上落地，再確認剪貼簿仍是我們注入的文字才還原，
      // 避免使用者在空檔手動複製了新內容、或把注入值當原文回寫
      await sleep(RESTORE_DELAY);
      const current = clipboard.readText();
      if (current === text) restoreClipboard(backup);
      else log.info('[typer] 剪貼簿已被外部變更，略過還原');
    } catch (err) {
      log.warn('[typer] type-and-restore 失敗', err);
      pasteDone(); // 確保呼叫端不會卡住
    }
  };

  // 串到鏈尾：前一個 type-and-restore（含還原）完成後，下一個才開始備份
  _chain = _chain.then(run, run);
  return pastePromise;
}

function copyToClipboard(text) {
  if (text) clipboard.writeText(text);
}

// 模擬按一下 Enter（聊天視窗送出用）
async function pressEnter() {
  await sleep(60);
  keybd_event(VK_RETURN, 0, 0, 0);
  await sleep(30);
  keybd_event(VK_RETURN, 0, KEYEVENTF_KEYUP, 0);
}

module.exports = { typeText, copyToClipboard, pressEnter, releaseAllModifiers };
