const { contextBridge, ipcRenderer } = require('electron');

// 浮動麥克風鈕：主程序 → 狀態；鈕 → 點擊與拖曳
contextBridge.exposeInMainWorld('micApi', {
  onState: (cb) => ipcRenderer.on('mic-state', (_e, state) => cb(state)),
  click: () => ipcRenderer.send('mic-click'),
  dragStart: () => ipcRenderer.send('mic-drag', 'start'),
  dragMove: () => ipcRenderer.send('mic-drag', 'move'),
  dragEnd: () => ipcRenderer.send('mic-drag', 'end'),
});
