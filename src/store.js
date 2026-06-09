// electron-store v8（最後一個 CommonJS 版本；v11 為 ESM-only 會 "Store is not a constructor"）
const Store = require('electron-store');

// 預設設定 — 集中定義，UI 與流程共用，避免散落各處不一致
const defaults = {
  // STT
  sttProvider: 'groq', // 'openai' | 'groq'（groq 免費額度大、whisper-large-v3 對中文佳）
  openaiApiKey: '',
  groqApiKey: '',
  language: 'zh', // Whisper language hint；中英混雜時可留空讓其自動偵測

  // LLM 潤稿
  llmEnabled: true,
  llmProvider: 'groq', // 'openai' | 'groq'
  llmStyle: 'clean', // 對應 LLM_STYLES key；'custom' 時用 llmCustomPrompt
  llmCustomPrompt: '',

  // 輸入方式
  copyToClipboard: false, // true=只複製到剪貼簿不自動貼上

  // 系統
  hotkey: 'Alt+Space', // 預留自訂（目前流程固定偵測 Left Alt + Space）
  launchAtStartup: false,
};

let _store = null;

function getStore() {
  if (!_store) {
    // v8 不支援 encryptionKey；JSON 存使用者 config 目錄
    _store = new Store({ name: 'notype-config', defaults });
  }
  return _store;
}

module.exports = { getStore, defaults };
