const { contextBridge, ipcRenderer } = require('electron');

// 主程序 ↔ 隱藏錄音視窗的橋接
contextBridge.exposeInMainWorld('recApi', {
  onStart: (cb) => ipcRenderer.on('start-recording', () => cb()),
  onStop: (cb) => ipcRenderer.on('stop-recording', () => cb()),
  sendAudio: (uint8) => ipcRenderer.send('audio-data', uint8),
  reportError: (msg) => ipcRenderer.send('recorder-error', msg),
});
