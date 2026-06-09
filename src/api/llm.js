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

const FALLBACK_PROMPT = '你是文字潤稿助手。將口語逐字稿整理為通順的書面繁體中文：移除贅詞、修正語法、加標點，保留英文專有名詞。只輸出整理後的文字本身。';

// 取得目前生效的潤稿角色（persona）
function getActiveRole(store) {
  const roles = store.get('roles') || [];
  const id = store.get('activeRoleId');
  return roles.find((r) => r.id === id) || roles[0] || null;
}

// 失敗時回傳原文（fail-open）— 潤稿是加值，不該因 LLM 出錯而丟失辨識結果
async function polishText(rawText) {
  const store = getStore();
  if (store.get('llmEnabled') !== true) return rawText;
  if (!rawText || !rawText.trim()) return rawText;

  const role = getActiveRole(store);
  const systemPrompt = (role && role.prompt && role.prompt.trim()) || FALLBACK_PROMPT;
  // 角色可自帶 model，否則用全域預設 llmProvider
  const provider = (role && role.model) || store.get('llmProvider') || 'groq';
  const cfg = PROVIDERS[provider] || PROVIDERS.groq;
  const apiKey = store.get(cfg.keyField);
  if (!apiKey) {
    log.warn('[llm] 無 API Key，略過潤稿');
    return rawText;
  }
  log.info('[llm] 角色=', role ? role.name : '(無)', 'model=', provider);

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
          { role: 'system', content: systemPrompt },
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

module.exports = { polishText, getActiveRole, PROVIDERS };
