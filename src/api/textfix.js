// 辨識結果後處理：① OpenCC 轉台灣繁體與用語 ② 自訂詞庫（引導 Whisper + 辨識後固定替換）
// 參考 EasyType（WhisperKit + OpenCC + 術語詞庫）的做法；全部在本機做，不呼叫任何 API。
const OpenCC = require('opencc-js/cn2t');

// cn → twp：簡體字轉繁體，並把大陸用語換成台灣用語（軟件→軟體、視頻→影片、內存→記憶體）。
// 已經是繁體的文字不會被改動（2026-11-13 以樣本句實測）。
let _cn2tw = null;
function cn2tw(text) {
  if (!_cn2tw) _cn2tw = OpenCC.Converter({ from: 'cn', to: 'twp' });
  return _cn2tw(text);
}

const KANA = /[぀-ヿ]/; // 含平假名／片假名就是日文，不做繁簡轉換（會把日文漢字改壞）

// 只有中文情境才轉：語言設 zh 或自動偵測，且結果裡沒有日文假名
function shouldConvert(text, language) {
  if (!text) return false;
  const lang = language || 'zh';
  if (!(lang === 'auto' || lang.startsWith('zh'))) return false;
  return !KANA.test(text);
}

// ── 自訂詞庫 ─────────────────────────────────────────
// 格式（一行一條，# 開頭是註解）：
//   GitHub              → 只寫正確詞：加進 Whisper 引導；英文詞另外修正大小寫（github → GitHub）
//   硬盤, 硬板 = 硬碟     → 等號左邊是常被聽錯的寫法（逗號分隔），右邊是正確寫法
function parseVocabulary(raw) {
  const terms = []; // 正確詞（給 Whisper 引導用）
  const rules = []; // { from, to }
  for (const line0 of String(raw || '').split(/\r?\n/)) {
    const line = line0.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.split(/[=＝]/);
    if (m.length >= 2) {
      const to = m.slice(1).join('=').trim();
      if (!to) continue;
      for (const f of m[0].split(/[,，、]/).map((x) => x.trim()).filter(Boolean)) {
        if (f !== to) rules.push({ from: f, to });
      }
      terms.push(to);
    } else {
      terms.push(line);
      if (/[A-Za-z]/.test(line)) rules.push({ from: line, to: line }); // 修正英文大小寫
    }
  }
  return { terms: [...new Set(terms)], rules };
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isAsciiWord = (s) => /^[\x20-\x7e]+$/.test(s);

// 一次掃過整段文字做替換（不會把已替換的結果再替換一次）。
// 正確詞本身也放進比對清單、對應到自己，避免「錯字是正確詞的一部分」時重複套用。
function applyVocabulary(text, vocab) {
  if (!text || !vocab || vocab.rules.length === 0) return text;
  const map = new Map(); // 小寫比對鍵 → 正確寫法
  const add = (from, to) => { const k = from.toLowerCase(); if (!map.has(k)) map.set(k, to); };
  for (const r of vocab.rules) add(r.from, r.to);
  for (const r of vocab.rules) add(r.to, r.to);
  const keys = [...map.keys()].sort((a, b) => b.length - a.length);
  // 英文詞前後不能接英數字（避免 Hub 換到 GitHub 裡面）；中文詞直接比對
  const alts = keys.map((k) => (isAsciiWord(k) ? `(?<![A-Za-z0-9])${escRe(k)}(?![A-Za-z0-9])` : escRe(k)));
  const re = new RegExp(alts.join('|'), 'giu');
  return text.replace(re, (m) => map.get(m.toLowerCase()) ?? m);
}

// Whisper 引導用的詞彙片段。prompt 上限約 224 token，詞多時只取前面的詞，控制在約 150 字內。
const VOCAB_PROMPT_MAX = 150;
function vocabPrompt(vocab) {
  if (!vocab || vocab.terms.length === 0) return '';
  const picked = [];
  let len = 0;
  for (const t of vocab.terms) {
    if (len + t.length + 1 > VOCAB_PROMPT_MAX) break;
    picked.push(t);
    len += t.length + 1;
  }
  return picked.length ? `常用詞：${picked.join('、')}。` : '';
}

// 給任何「要貼給使用者的文字」用：STT 結果、潤稿／改寫後的文字
function fixText(text, { language, twConvert = true, vocab } = {}) {
  let out = text || '';
  if (twConvert && shouldConvert(out, language)) out = cn2tw(out);
  return applyVocabulary(out, vocab);
}

// 從設定讀出後處理參數（詞庫解析結果依原文快取，設定改了才重算）
let _vocabRaw = null;
let _vocab = null;
function optsFromStore(store) {
  const raw = store.get('vocabulary') || '';
  if (raw !== _vocabRaw) { _vocabRaw = raw; _vocab = parseVocabulary(raw); }
  return { language: store.get('language') || 'zh', twConvert: store.get('twConvert') !== false, vocab: _vocab };
}

module.exports = { fixText, parseVocabulary, applyVocabulary, vocabPrompt, optsFromStore, cn2tw, shouldConvert };
