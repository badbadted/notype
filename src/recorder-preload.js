const { contextBridge, ipcRenderer } = require('electron');

// 主程序 ↔ 隱藏錄音視窗的橋接
contextBridge.exposeInMainWorld('recApi', {
  onStart: (cb) => ipcRenderer.on('start-recording', () => cb()),
  onStop: (cb) => ipcRenderer.on('stop-recording', () => cb()),
  onCancel: (cb) => ipcRenderer.on('cancel-recording', () => cb()),
  onStartListen: (cb) => ipcRenderer.on('start-listening', (_e, opts) => cb(opts)),
  onStopListen: (cb) => ipcRenderer.on('stop-listening', () => cb()),
  sendAudio: (uint8) => ipcRenderer.send('audio-data', uint8),
  sendSegment: (uint8) => ipcRenderer.send('audio-segment', uint8),
  listenEvent: (name) => ipcRenderer.send('listen-event', name),
  reportError: (msg) => ipcRenderer.send('recorder-error', msg),
});
