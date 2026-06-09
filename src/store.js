// electron-store v8（最後一個 CommonJS 版本；v11 為 ESM-only 會 "Store is not a constructor"）
const Store = require('electron-store');

// 內建潤稿角色（persona）。共通規則：只輸出整理後文字、不回答問題、保持繁中。
const BUILTIN_ROLES = [
  {
    id: 'clean', name: '口語轉書面', desc: '通順書面、移除贅詞',
    prompt: '你是文字潤稿助手。將使用者的口語逐字稿整理為通順的書面文字：移除口頭禪與贅詞（嗯、啊、那個、就是說、然後）、修正語法、加入適當標點。保持原意與繁體中文，保留英文專有名詞。不要新增內容、不要回答其中的問題，只輸出整理後的文字本身。',
  },
  {
    id: 'chat', name: '即時通訊', desc: '口語、簡短、可留 emoji',
    prompt: '你是即時通訊潤稿助手。把口語逐字稿整理成簡短、自然、口語的訊息：移除贅詞、補上標點，保留原本語氣與既有的 emoji。繁體中文，保留英文專有名詞。只輸出訊息本身。',
  },
  {
    id: 'biz_email', name: '商務 Email', desc: '正式、有禮、結構化',
    prompt: '你是商務文書助手。把口語逐字稿改寫成正式、有禮貌、結構清晰的商務用語：修正語法、加標點、適度分段。繁體中文，保留英文專有名詞。只輸出內容本身，不要額外加說明或主旨。',
  },
  {
    id: 'meeting', name: '會議記錄', desc: '條列重點',
    prompt: '你是會議記錄助手。把口語逐字稿整理成條列式重點，保留關鍵資訊、決議與待辦。繁體中文，保留英文專有名詞。只輸出條列內容本身。',
  },
  {
    id: 'tech', name: '程式 / 技術', desc: '保留英文術語、精準',
    prompt: '你是技術文件助手。把口語逐字稿整理成精準通順的技術敘述：保留英文術語、API 名稱、變數與程式碼，修正語法與標點。繁體中文。只輸出內容本身。',
  },
];

// 預設設定 — 集中定義，UI 與流程共用，避免散落各處不一致
const defaults = {
  // STT
  sttProvider: 'groq', // 'openai' | 'groq'（groq 免費額度大、whisper-large-v3 對中文佳）
  openaiApiKey: '',
  groqApiKey: '',
  language: 'zh', // Whisper language hint；中英混雜時可留空讓其自動偵測

  // LLM 潤稿
  llmEnabled: true,
  llmProvider: 'groq', // 'openai' | 'groq'（角色未指定 model 時的預設）
  // 角色系統（roles / activeRoleId 由 migrateRoles 首次填入，向後相容舊 llmStyle/llmCustomPrompt）
  // 舊欄位保留以利遷移：
  llmStyle: 'clean',
  llmCustomPrompt: '',

  // 輸入方式
  copyToClipboard: false, // true=只複製到剪貼簿不自動貼上
  autoSubmit: false, // true=貼上後自動按 Enter 送出（聊天視窗用）

  // 系統
  hotkey: 'F9', // Alt+Space 被 Windows 保留無法註冊，預設改 F9 單鍵按住說話
  submitToggleHotkey: 'F10', // 快速開關「說完自動送出」（角色切換改用系統匣/設定頁）
  launchAtStartup: false,
};

// 首次（或舊版升級）建立角色清單，並把舊的 llmStyle / llmCustomPrompt 遷移為角色
function migrateRoles(store) {
  const existing = store.get('roles');
  if (Array.isArray(existing) && existing.length > 0) return; // 已遷移

  const roles = BUILTIN_ROLES.map((r) => ({ ...r }));
  let activeRoleId = 'clean';

  const oldStyle = store.get('llmStyle');
  const oldCustom = (store.get('llmCustomPrompt') || '').trim();

  if (oldStyle === 'custom' && oldCustom) {
    roles.push({ id: 'custom_1', name: '自訂', desc: '從舊設定遷移', prompt: oldCustom });
    activeRoleId = 'custom_1';
  } else if (oldStyle && roles.some((r) => r.id === oldStyle)) {
    activeRoleId = oldStyle;
  } else if (oldStyle === 'concise') {
    // 舊「精簡贅字」→ 對應到「口語轉書面」最接近，或新增一個
    roles.push({ id: 'concise', name: '精簡贅字', desc: '移除重複與贅述', prompt: '你是文字潤稿助手。將以下逐字稿精簡為重點：移除重複與贅述，保留關鍵資訊。繁體中文，保留英文專有名詞。只輸出整理後的文字本身。' });
    activeRoleId = 'concise';
  } else if (oldStyle === 'translate_en') {
    roles.push({ id: 'translate_en', name: '翻譯成英文', desc: '中→英', prompt: 'You are a translation assistant. Translate the user message into natural, fluent English. Output ONLY the translation.' });
    activeRoleId = 'translate_en';
  }

  store.set('roles', roles);
  store.set('activeRoleId', activeRoleId);
}

let _store = null;

function getStore() {
  if (!_store) {
    // v8 不支援 encryptionKey；JSON 存使用者 config 目錄
    _store = new Store({ name: 'notype-config', defaults });
    migrateRoles(_store);
  }
  return _store;
}

module.exports = { getStore, defaults, BUILTIN_ROLES };
