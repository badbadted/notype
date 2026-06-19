// 錄音模組（主程序）— 隱藏視窗跑 MediaRecorder，音訊存暫存檔供 STT 讀取
const { BrowserWindow, app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { log } = require('./logger');

let recorderWindow = null;
let currentAudioPath = null;
// 冷啟動競態防護（H5）：start 因視窗尚未載入而延後送出時，若 stop 先到，
// 記住 pendingStop，待 start 真正送出後立刻補送 stop，確保短按一定能收尾。
let startDispatched = false;
let pendingStop = false;

function tempDir() {
  const dir = path.join((app && app.getPath('temp')) || os.tmpdir(), 'notype');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// 隱藏錄音視窗（主程序無法直接用 MediaRecorder）
function createRecorderWindow() {
  if (recorderWindow && !recorderWindow.isDestroyed()) return recorderWindow;

  recorderWindow = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: {
      preload: path.join(__dirname, 'recorder-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  recorderWindow.loadFile(path.join(__dirname, 'recorder-page.html'));
  recorderWindow.on('closed', () => { recorderWindow = null; });
  return recorderWindow;
}

function startRecording() {
  const win = createRecorderWindow();
  startDispatched = false;
  pendingStop = false;
  const send = () => {
    if (win.isDestroyed()) return;
    win.webContents.send('start-recording');
    startDispatched = true;
    // start 送出後，若期間已收到 stop（短按），立刻補送 stop
    if (pendingStop) {
      pendingStop = false;
      win.webContents.send('stop-recording');
    }
  };
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
  else send();
}

function stopRecording() {
  // start 尚未真正送出（視窗冷啟動中）→ 先記下，待 start 送出後補送，避免 stop 先於 start 而落空
  if (!startDispatched) {
    pendingStop = true;
    return;
  }
  if (recorderWindow && !recorderWindow.isDestroyed()) {
    recorderWindow.webContents.send('stop-recording');
  }
}

// 將 renderer 傳回的音訊 buffer 存成暫存 webm 檔。
// 檔名帶唯一 id（pid + 時間戳 + 隨機），避免兩輪並發共用同一固定路徑而互相覆蓋／誤刪（M3）。
// 回傳的路徑由呼叫端以區域變數持有並傳給 cleanupTempAudio，不再依賴模組共用變數。
function saveAudioBuffer(audioBuffer) {
  const buf = Buffer.from(audioBuffer);
  const id = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const audioPath = path.join(tempDir(), `rec-${id}.webm`);
  fs.writeFileSync(audioPath, buf);
  currentAudioPath = audioPath; // 仍記錄最後一次，供未帶參數的呼叫沿用（相容）
  log.info('[recorder] 音訊已存', audioPath, buf.length, 'bytes');
  return audioPath;
}

// 刪除指定的暫存音訊檔；未帶參數時退回清掉最後一次記錄的路徑（相容舊呼叫）。
// 帶 audioPath 時只刪自己這輪的檔，不會誤刪另一輪並發產生的檔（M3）。
function cleanupTempAudio(audioPath) {
  const target = audioPath || currentAudioPath;
  if (target && fs.existsSync(target)) {
    try { fs.unlinkSync(target); } catch { /* 忽略 */ }
  }
  if (target === currentAudioPath) currentAudioPath = null;
}

module.exports = { createRecorderWindow, startRecording, stopRecording, saveAudioBuffer, cleanupTempAudio };
