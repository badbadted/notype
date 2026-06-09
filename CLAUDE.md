# NoType — 專案開發筆記

## 簡介
Windows AI 語音輸入工具。按住 F9 說話 → 雲端 Whisper STT → LLM 潤稿 → 模擬 Ctrl+V 貼進當前游標。Electron + koffi，常駐系統匣，BYOK。

藍本：`mathruffian-dot/notype`（使用者既有專案），本版於 `C:\Ted\Github\notype` 重做並改良。

## 技術決策
- **框架**：Electron（系統匣常駐 + 設定頁）
- **STT/LLM**：雲端 OpenAI / Groq（OpenAI 相容端點，stt.js / llm.js 各自合一）
- **熱鍵**：`F9` 單鍵（`Alt+Space` 被 Windows 保留無法註冊）；`shortcut.js` 自我修復，註冊失敗自動退到 `CommandOrControl+Shift+Space` / `Alt+Z` / `F10` 並回寫設定
- **鍵盤模擬 / 按鍵偵測**：統一用 `koffi`（純 JS FFI，免 Visual Studio 編譯）呼叫 `keybd_event` / `GetAsyncKeyState`
- **設定存儲**：`electron-store` v8（v11 是 ESM-only 會壞）。注意：v8 建構時會把預設值寫進磁碟，改 code 預設對舊檔無效
- **UI**：mono-gray 極簡主題（使用者 3 方案比稿選定）
- **打包防護**：disableHardwareAcceleration + no-sandbox + disable-gpu 等 + uncaughtException + debug log（feedback_electron_portable_packaging）

## 踩坑紀錄
1. `Alt+Space` globalShortcut 註冊失敗 → Windows 系統選單保留鍵。改 F9 + 自我修復 fallback
2. electron-store v8 會持久化預設值 → 改 code 預設無效，需刪 `%APPDATA%\notype\notype-config.json` 或靠 fallback 自癒
3. `png-to-ico` v3 是 ESM default 匯出 → `mod.default ?? mod`

## 進度
- [x] 切片 0-7 完成：骨架、設定、UI、錄音、STT、LLM、熱鍵、串接
- [x] 已驗證：開機無閃退、F9 註冊、設定頁渲染、koffi Ctrl+V 貼字（Notepad 實測）
- [ ] 端到端語音流程：需使用者填 API Key + 真人講話實測
- [ ] 切片 8：electron-builder 打包（建議 voice flow 確認後再做）

## 驗證指令
```bash
npm start                                  # 啟動
cat "$env:TEMP\notype-debug.log"           # 看 debug log
# 設定頁填金鑰 → 按住 F9 說話 → 放開 → 文字應出現在游標處
```

## 工作注意
- 統一用 koffi，禁止需 Visual Studio 編譯的原生套件
- UI 文字一律繁體中文
- 路徑用 path.join，程序終止用 taskkill / PowerShell Stop-Process
