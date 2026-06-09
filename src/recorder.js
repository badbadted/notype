// 錄音模組（主程序）— 隱藏視窗跑 MediaRecorder，音訊存暫存檔供 STT 讀取
const { BrowserWindow, app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { log } = require('./logger');

let recorderWindow = null;
let currentAudioPath = null;

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
  const send = () => win.webContents.send('start-recording');
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
  else send();
}

function stopRecording() {
  if (recorderWindow && !recorderWindow.isDestroyed()) {
    recorderWindow.webContents.send('stop-recording');
  }
}

// 將 renderer 傳回的音訊 buffer 存成暫存 webm 檔
function saveAudioBuffer(audioBuffer) {
  cleanupTempAudio();
  const buf = Buffer.from(audioBuffer);
  currentAudioPath = path.join(tempDir(), `rec-${process.pid}.webm`);
  fs.writeFileSync(currentAudioPath, buf);
  log.info('[recorder] 音訊已存', currentAudioPath, buf.length, 'bytes');
  return currentAudioPath;
}

function cleanupTempAudio() {
  if (currentAudioPath && fs.existsSync(currentAudioPath)) {
    try { fs.unlinkSync(currentAudioPath); } catch { /* 忽略 */ }
  }
  currentAudioPath = null;
}

module.exports = { createRecorderWindow, startRecording, stopRecording, saveAudioBuffer, cleanupTempAudio };
