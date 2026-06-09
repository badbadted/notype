const { contextBridge, ipcRenderer } = require('electron');

// 設定頁與主程序的安全橋接（切片 1 補上實際 IPC 通道）
contextBridge.exposeInMainWorld('notype', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  testApiKey: (provider, apiKey) => ipcRenderer.invoke('test-api-key', provider, apiKey),
});
