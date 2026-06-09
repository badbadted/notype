# NoType — AI 語音輸入工具（Windows）

用說的取代打字。按住 **F9** 說話，放開即自動辨識 → AI 潤稿 → 文字貼進當前游標位置。常駐系統匣，自帶 API Key（BYOK）。

## 功能

- **全域熱鍵**：按住 F9 錄音、放開停止（單鍵 push-to-talk）
- **雲端 STT**：OpenAI Whisper / Groq Whisper 二選一，中英混雜優化
- **AI 潤稿**：移除贅詞、自動標點、修正文法；可選風格或自訂提示詞
- **輸入到任何 App**：剪貼簿 + 模擬 Ctrl+V，相容中文輸入法
- **狀態浮窗**：錄音 / 辨識 / 潤稿 / 完成 / 錯誤
- **跨機打包防護**：disableHardwareAcceleration + no-sandbox + 例外處理 + debug log

## 開發 / 執行

```bash
npm install
npm run icon      # 產生系統匣圖示（首次）
npm start         # 啟動（開發）
```

啟動後在系統匣圖示按右鍵或左鍵開「設定」，填入 API Key 並測試，即可開始按 F9 說話。

## 打包（Windows）

```bash
npm run build            # 產出 nsis 安裝檔 + portable（dist/）
npm run build:portable   # 只產 portable exe
```

## 取得 API Key

- **Groq**（推薦，免費額度大）：<https://console.groq.com/keys>
- **OpenAI**：<https://platform.openai.com/api-keys>

> API Key 只存在本機設定檔，不經任何第三方伺服器。

## 技術架構

| 模組 | 說明 |
|------|------|
| `src/main.js` | Electron 主程序、IPC、跨機防護 |
| `src/shortcut.js` | 全域熱鍵 + 按住偵測（koffi `GetAsyncKeyState`）+ 流程控制 |
| `src/recorder*.js/html` | 隱藏視窗 `MediaRecorder` 錄音 |
| `src/api/stt.js` | OpenAI / Groq Whisper 轉錄（合一） |
| `src/api/llm.js` | LLM 潤稿（可自訂提示詞） |
| `src/typer.js` | koffi `keybd_event` 模擬 Ctrl+V 輸入 |
| `src/overlay.*` | 狀態浮窗 |
| `src/settings/*` | 設定頁（mono-gray 主題） |

藍本參考 [`mathruffian-dot/notype`](https://github.com/mathruffian-dot/notype)，本版重做並改良（打包防護、UX、中英混雜、自訂潤稿、F9 熱鍵 + 自我修復）。

## 已知限制

- STT / LLM 需網路與有效 API Key
- 熱鍵 `Alt+Space` 被 Windows 系統選單保留，預設改用 `F9`（註冊失敗會自動退到其他可用鍵）
