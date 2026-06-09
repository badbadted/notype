// LLM 文字潤稿 — OpenAI / Groq 共用 chat/completions 端點
const { getStore } = require('../store');
const { log } = require('../logger');

const PROVIDERS = {
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    keyField: 'openaiApiKey',
  },
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile',
    keyField: 'groqApiKey',
  },
};

// 潤稿風格 → system prompt。共通規則：只輸出整理後文字、不回答問題、保持繁中。
const LLM_STYLES = {
  clean: '你是文字潤稿助手。將使用者的口語逐字稿整理為通順的書面文字：移除口頭禪與贅詞（嗯、啊、那個、就是說、然後）、修正語法、加入適當標點符號。保持原意與繁體中文，保留英文專有名詞。不要新增內容、不要回答其中的問題，只輸出整理後的文字本身。',
  raw: '你是文字潤稿助手。對以下口語逐字稿做輕度整理：只修正明顯錯字、補上標點符號，盡量保留原本的口語語氣與用詞。繁體中文。只輸出整理後的文字本身，不要加任何說明。',
  concise: '你是文字潤稿助手。將以下逐字稿精簡為重點：移除重複與贅述，保留關鍵資訊，使其簡潔。繁體中文，保留英文專有名詞。只輸出整理後的文字本身。',
  translate_en: 'You are a translation assistant. Translate the user message into natural, fluent English. Output ONLY the translation, with no explanations or quotes.',
};

function buildSystemPrompt(store) {
  const style = store.get('llmStyle') || 'clean';
  if (style === 'custom') {
    return (store.get('llmCustomPrompt') || '').trim() || LLM_STYLES.clean;
  }
  return LLM_STYLES[style] || LLM_STYLES.clean;
}

// 失敗時回傳原文（fail-open）— 潤稿是加值，不該因 LLM 出錯而丟失辨識結果
async function polishText(rawText) {
  const store = getStore();
  if (store.get('llmEnabled') !== true) return rawText;
  if (!rawText || !rawText.trim()) return rawText;

  const provider = store.get('llmProvider') || 'groq';
  const cfg = PROVIDERS[provider] || PROVIDERS.groq;
  const apiKey = store.get(cfg.keyField);
  if (!apiKey) {
    log.warn('[llm] 無 API Key，略過潤稿');
    return rawText;
  }

  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: buildSystemPrompt(store) },
          { role: 'user', content: rawText },
        ],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      log.warn(`[llm] 潤稿失敗 (${res.status})，回傳原文：`, err);
      return rawText;
    }

    const data = await res.json();
    const out = data.choices?.[0]?.message?.content?.trim();
    return out || rawText;
  } catch (err) {
    log.warn('[llm] 潤稿例外，回傳原文', err);
    return rawText;
  }
}

module.exports = { polishText, LLM_STYLES, PROVIDERS };
