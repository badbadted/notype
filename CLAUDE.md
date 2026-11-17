# NoType — 專案開發筆記

## 簡介
Windows AI 語音輸入工具。按住 F9 說話 → 雲端 Whisper STT → LLM 潤稿 → 模擬 Ctrl+V 貼進當前游標。Electron + koffi，常駐系統匣，BYOK。

藍本：`mathruffian-dot/notype`（使用者既有專案），本版於 `C:\Ted\Github\notype` 重做並改良。

## 技術決策
- **框架**：Electron（系統匣常駐 + 設定頁）
- **STT/LLM**：雲端 OpenAI / Groq（OpenAI 相容端點，stt.js / llm.js 各自合一）；Groq STT 用 `whisper-large-v3-turbo`
- **辨識後處理**（0.1.23，參考 EasyType 的 WhisperKit＋OpenCC＋術語詞庫）：`src/api/textfix.js` 用 opencc-js 轉台灣繁體用語、套自訂詞庫；STT 結果與所有 LLM 輸出都過一次。詞庫同時塞進 Whisper prompt，回聲偵測要連詞庫片段一起比
- **熱鍵**：`F9` 單鍵（`Alt+Space` 被 Windows 保留無法註冊）；`shortcut.js` 自我修復，註冊失敗自動退到 `CommandOrControl+Shift+Space` / `Alt+Z` / `F10` 並回寫設定
- **鍵盤模擬 / 按鍵偵測**：統一用 `koffi`（純 JS FFI，免 Visual Studio 編譯）呼叫 `keybd_event` / `GetAsyncKeyState`
- **連續聽寫**：輕按 F9（<300ms）切換；renderer 用 `@ricky0123/vad-web` 0.0.30 + `onnxruntime-web` 1.23.2（皆 devDependencies、版本鎖死）做 VAD 切句，每句 16kHz WAV 回送主程序，`segChain` 依序跑 STT→潤稿→貼上。VAD 資源由 `scripts/copy-vad-assets.js` 複製到 `src/vendor/vad/`（gitignore），prestart / prebuild 自動執行
- **設定存儲**：`electron-store` v8（v11 是 ESM-only 會壞）。注意：v8 建構時會把預設值寫進磁碟，改 code 預設對舊檔無效
- **UI**：mono-gray 極簡主題（使用者 3 方案比稿選定）
- **打包防護**：disableHardwareAcceleration + no-sandbox + disable-gpu 等 + uncaughtException + debug log（feedback_electron_portable_packaging）

## 踩坑紀錄
1. `Alt+Space` globalShortcut 註冊失敗 → Windows 系統選單保留鍵。改 F9 + 自我修復 fallback
2. electron-store v8 會持久化預設值 → 改 code 預設無效，需刪 `%APPDATA%\notype\notype-config.json` 或靠 fallback 自癒
3. `png-to-ico` v3 是 ESM default 匯出 → `mod.default ?? mod`
4. onnxruntime-web 的 `wasmPaths` 相對路徑會以 ort/vad 自身 script 位置解析 → 找不到 wasm。VAD 資源路徑一律用 `new URL(..., location.href)` 轉絕對 URL
5. onnxruntime-web 整包 111MB，不可放 dependencies（會整包進 asar）；只複製需要的 6 個檔
6. recorder-page CSP 需 `'wasm-unsafe-eval'` 才能跑 wasm
7. 潤稿失敗是 fail-open（回原文），所以模型下架這類錯誤使用者看不出來，只會在 log 留 `[llm] 潤稿失敗 (404)`。懷疑潤稿沒作用時先查 log；Groq 下架清單在 console.groq.com/docs/deprecations
9. 要用程式測 focusable:false 浮窗上的滑鼠操作，別用 SetCursorPos 模擬真實滑鼠：視窗在另一個螢幕（不同縮放）時座標對不上，會點到使用者畫面上別的東西。改用 `npx electron . --remote-debugging-port=9333` 啟動，再經 CDP 的 `Input.dispatchMouseEvent` 對該頁送事件
10. 浮窗常被蓋到下面：Windows 不認 `setAlwaysOnTop` 的層級（`'screen-saver'` 只在 macOS 有效），所有置頂視窗同一層；`focusable:false` 的視窗不會被啟用，被壓下去就不會自己浮回來；Win+D、全螢幕退出、休眠喚醒還可能直接拿掉置頂屬性。統一由 `src/keep-on-top.js` 在浮窗顯示期間每 1.5 秒補設置頂＋`moveTop()`，螢幕變更／解鎖／喚醒時立即補設。新增浮窗一律呼叫 `keepOnTop(win)`
11. 滑鼠側鍵觸發用 WH_MOUSE_LL 低階掛鉤，一定要放在 worker 執行緒（`src/mousehook-worker.js`）自己跑 GetMessageW 迴圈：全系統每次滑鼠移動都會經過回呼，放主程序執行緒，主程序一忙整台電腦的滑鼠就卡，回呼太慢 Windows 還會默默拆掉掛鉤。被吞掉的鍵 GetAsyncKeyState 讀不到，放開要靠掛鉤事件。worker 腳本打包時要 asarUnpack。測「有沒有吞掉」：先在另一個程序裝觀察用掛鉤（排在鏈尾）再開 NoType，被吞掉的點擊觀察者就收不到
12. NoType 若由別的程式（終端機、Claude session、desk-xs 等）帶管線啟動，對方關掉後 `console.log` 會丟 EPIPE，舊版每次寫 log 就彈「EPIPE: broken pipe」錯誤窗。`logger.js` 已吞掉主控台寫入錯誤（log 檔照寫），`uncaughtException` 遇管線錯誤不彈窗（0.1.26）
8. 「從別的視窗按按鈕來啟動聽寫」行不通：按鈕所在視窗會拿走焦點，Ctrl+V 就貼不到原本的輸入框。要用滑鼠啟動只能靠 `focusable:false` 的視窗（如狀態浮窗；浮動麥克風鈕 0.1.16～0.1.21 即採此做法，0.1.22 已移除）

## 進度
- [x] 切片 0-7 完成：骨架、設定、UI、錄音、STT、LLM、熱鍵、串接
- [x] 已驗證：開機無閃退、F9 註冊、設定頁渲染、koffi Ctrl+V 貼字（Notepad 實測）
- [ ] 端到端語音流程：需使用者填 API Key + 真人講話實測
- [ ] 切片 8：electron-builder 打包（建議 voice flow 確認後再做）
- [x] 連續聽寫（0.1.15）：假麥克風（Chromium `--use-file-for-fake-audio-capture`）實測 VAD 切句、中途結束送半句、取消錄音、asar 內載入皆通過；主程序狀態機 13 項 mock 測試通過
- [ ] 連續聽寫：真人麥克風 + 雲端 STT 端到端實測

- [x] 浮動麥克風鈕（0.1.16）：開發版以模擬滑鼠點擊實測——點一下開始聽寫、再點一下結束，點擊前後前景視窗不變（不搶焦點）。拖曳與真人講話貼字待使用者實測
- [x] 麥克風鈕按住說話＋閒置自動結束可選 3／5／10 秒（0.1.17）：透過除錯埠在鈕的頁面內送滑鼠事件實測——按住開始錄、放開送辨識、聽寫中按下只結束，三項皆通過
- [x] 滑鼠觸發鍵（0.1.19）：設定頁可選側鍵上一頁／下一頁／滾輪中鍵，行為同 F9。開發版以 SendInput 送側鍵實測：按住錄音、輕按連續聽寫、聽寫中按下結束、選中的鍵被吞掉不傳給前景程式、改選別顆後原鍵放行、改回不使用時 worker 結束。2026-10-21 使用者以真人滑鼠側鍵實測通過
- [x] 語音改寫的滑鼠觸發鍵（0.1.20）：設定頁第二個下拉「滑鼠觸發：語音改寫」，行為同按住 F7；兩個不能選同一顆（設定頁擋儲存，主程序遇到時改寫停用）。開發版以 SendInput 實測按住錄指令、放開進改寫流程、同鍵時語音輸入優先、改寫鍵被吞掉、改選後原鍵放行。2026-10-21 使用者以真人滑鼠實測通過
- [ ] 滑鼠鍵切換「說完自動送出」（0.1.21）：設定頁「輸入方式」新增「滑鼠切換：說完自動送出」，按下同 F10；三個滑鼠鍵設定互斥（設定頁擋儲存，主程序依 語音輸入→改寫→切換送出 優先）。已通過 mousehook 三格/撞鍵 mock 測試 8 項、設定頁撞鍵提示與儲存 payload 瀏覽器測試；待使用者以真人滑鼠實測
- [x] 移除浮動麥克風鈕（0.1.22）：使用者已改用 F9 與滑鼠側鍵，不再需要；刪 micbutton.*、系統匣開關與 micButton 設定，舊設定檔殘留的兩個鍵不會被讀取
- [x] 浮窗自動回到最上層（0.1.18）：`keep-on-top.js` 讓狀態浮窗被蓋住後約 2 秒回到最上層。開發版自動測試通過；2026-10-21 使用者實測 Win+D、全螢幕影片退出、休眠喚醒後都會回來
- [ ] 台灣繁體轉換＋自訂詞庫＋turbo 模型（0.1.23）：textfix 與 stt 請求 mock 測試 23 項通過、開發版設定頁存讀與截圖確認；待使用者真人講話比較辨識速度與用字
- [ ] 鍵盤熱鍵開關（0.1.24）：設定頁「一般」加「鍵盤熱鍵」開關，關掉後 F9／F8／F7／F10 與自我修復候選鍵都不註冊，把鍵盤讓給桌面小帥等其他程式，只用滑鼠觸發鍵；關掉時一定要選「滑鼠觸發：語音輸入」否則擋儲存；浮窗與系統匣提示改顯示滑鼠鍵名稱。mock 測試 8 項（註冊／不回寫 hotkey／滑鼠鍵照套／標籤）與 jsdom 設定頁測試 9 項通過；待打包安裝後真人確認
- [ ] 小帥格（0.1.25）：設定頁「滾輪中鍵：小帥」開關（xsMiddle，預設關），開著時中鍵固定給桌面小帥 desk-xs（`C:\Ted\Projects\products\desk-xs`）：按住說話、放開把整段辨識文字（不潤稿、不貼上）經 `src/xs-bridge.js` 交給 desk-xs 本機橋接 127.0.0.1:18961，回話由 Mac mini 的 Luna 決定、客廳喇叭念；其他三格不能選中鍵。2026-11-17 開發版以假麥克風（Hanhan TTS「現在幾點」）＋模擬中鍵實測：掛鉤吞中鍵、STT 0.37～0.77 秒、desk-xs 收到並交 Luna、喇叭念出；待打包安裝與真人中鍵實測
- [x] Groq 潤稿模型換成 `openai/gpt-oss-120b`（0.1.16）：`llama-3.3-70b-versatile` 於 2026-08-16 下架後每次潤稿都回 404、退回原文。2026-10-21 使用者以真人語音確認潤稿品質 OK

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
