// 語音轉文字（雲端）— OpenAI / Groq 共用同一 OpenAI 相容端點，差異只在 URL/model/key
const fs = require('fs');
const { getStore, getApiKey } = require('../store');
const { log } = require('../logger');

const PROVIDERS = {
  openai: {
    url: 'https://api.openai.com/v1/audio/transcriptions',
    model: 'whisper-1',
    keyField: 'openaiApiKey',
    label: 'OpenAI Whisper',
  },
  groq: {
    url: 'https://api.groq.com/openai/v1/audio/transcriptions',
    model: 'whisper-large-v3',
    keyField: 'groqApiKey',
    label: 'Groq Whisper',
  },
};

// 中英混雜引導：Whisper 的 prompt 會偏置輸出詞彙與書寫系統，
// 用繁體中文+英文混合的範例句引導其輸出繁體字並保留英文術語。
const ZH_MIX_PROMPT = '以下是繁體中文與英文混合的語音內容，請以繁體中文輸出，並保留英文專有名詞與技術術語。例如：這個 bug 我們用 React 的 useEffect 修好了。';

const STT_TIMEOUT_MS = 30000; // 30s：網路卡住時 abort 走錯誤路徑，避免 overlay 永久停在「處理中」

async function transcribe(audioFilePath) {
  const store = getStore();
  const provider = store.get('sttProvider') || 'groq';
  const cfg = PROVIDERS[provider] || PROVIDERS.groq;
  const apiKey = getApiKey(store, cfg.keyField);
  if (!apiKey) throw new Error(`未設定 ${cfg.label} 的 API Key`);

  const language = store.get('language') || 'zh';

  const audioData = fs.readFileSync(audioFilePath);
  const blob = new Blob([audioData], { type: 'audio/webm' });
  const form = new FormData();
  form.append('file', blob, 'recording.webm');
  form.append('model', cfg.model);
  form.append('response_format', 'json');
  form.append('temperature', '0');

  // language='auto' → 不帶 language 參數，讓模型自動偵測（中英混雜較準）
  if (language && language !== 'auto') {
    form.append('language', language.split('-')[0]); // zh-TW → zh
  }
  // 中文/自動偵測時加引導 prompt 提升繁中與中英混雜品質
  if (!language || language === 'auto' || language.startsWith('zh')) {
    form.append('prompt', ZH_MIX_PROMPT);
  }

  log.info('[stt]', cfg.label, 'lang=', language);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STT_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(cfg.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error(`${cfg.label} 連線逾時（${STT_TIMEOUT_MS / 1000}s），請檢查網路`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${cfg.label} 錯誤 (${res.status}): ${err}`);
  }

  const data = await res.json();
  return (data.text || '').trim();
}

module.exports = { transcribe, PROVIDERS };
