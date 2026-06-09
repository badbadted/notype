const { contextBridge, ipcRenderer } = require('electron');

// 主程序 → 浮窗：狀態更新（recording / processing / polishing / done / error）
contextBridge.exposeInMainWorld('overlayApi', {
  onState: (cb) => ipcRenderer.on('overlay-state', (_e, state, detail) => cb(state, detail)),
});
