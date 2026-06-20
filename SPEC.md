# notype 功能清冊（SPEC）

> Windows AI 語音輸入工具：按住 F9 說話 → 雲端 Whisper STT → LLM 潤稿 → 模擬 Ctrl+V 把文字貼進當前游標位置。常駐系統匣、BYOK（自帶 API Key）。
> 技術棧：Electron 41 + koffi（純 JS FFI 呼叫 user32.dll）+ electron-store v8（設定存儲）+ pngjs（產圖示）。STT/LLM 走 OpenAI / Groq 的 OpenAI 相容雲端端點。

---

## src/main.js — Electron 主程序入口
- 功能: 跨機部署防護——app ready 前關硬體加速、no-sandbox、disable-gpu 等開關，避免他機無聲閃退（main.js:10-16）
- 功能: 全域例外防護——uncaughtException 寫 log + 彈錯誤框、unhandledRejection 寫 log（main.js:18-27）
- 功能: 單一實例鎖（requestSingleInstanceLock）；敗方立即 quit 不做任何初始化，避免污染共用設定檔（main.js:29-32, 113-121）
- 功能: 建立設定視窗（600x560、不可縮放、淺色底避免白邊、contextIsolation）（main.js:36-61）
- 功能: 註冊 IPC handler——get-version / get-settings / save-settings / test-api-key / audio-data / recorder-error（main.js:63-111）
- 功能: save-settings 連動——寫設定後同步開機啟動項、重註冊熱鍵、刷新系統匣選單（main.js:73-84）
- 功能: test-api-key 以 GET /v1/models 驗證金鑰，回 res.ok（main.js:87-100）
- 功能: app ready 流程——初始化 store、建系統匣、預建隱藏錄音視窗 + 浮窗、註冊全域熱鍵；無金鑰時自動開設定頁引導（main.js:123-144）
- 功能: 系統匣常駐——window-all-closed 攔截不退出；will-quit 時反註冊熱鍵（main.js:147-153）
- 依賴: electron（app/BrowserWindow/dialog/ipcMain）、./logger、./tray、./store、./recorder、./overlay、./shortcut

## src/shortcut.js — 全域熱鍵 + 錄音流程主控
- 功能: koffi 載入 user32.dll、宣告 GetAsyncKeyState 用於輪詢按鍵放開（shortcut.js:12-20）
- 功能: acceleratorToVks——把 Electron accelerator 字串（F9 / Control+Shift+Space）解析為 VK 碼陣列（shortcut.js:23-36）
- 功能: registerShortcut 自我修復——設定熱鍵註冊失敗時依 FALLBACKS（F9 / Ctrl+Shift+Space / Alt+Z / F10）逐一退避並回寫設定（shortcut.js:40-69）
- 功能: registerSubmitToggleHotkey——另註冊「說完自動送出」開關熱鍵（預設 F10，含自我修復）（shortcut.js:72-88）
- 功能: toggleAutoSubmit——切換 autoSubmit 開/關並以浮窗閃示狀態（shortcut.js:91-99）
- 功能: startRec——無金鑰時提示去設定；否則設旗標、浮窗顯示生效潤稿角色、啟動錄音，並每 80ms 輪詢任一熱鍵放開即停止（shortcut.js:101-123）
- 功能: stopRec——清除輪詢計時器並通知錄音停止（shortcut.js:125-130）
- 功能: handleAudioData——端到端流程：空音訊略過 → isProcessing 並發鎖 → 存暫存檔 → STT 轉錄 → LLM 潤稿 → 依設定走「複製到剪貼簿」或「貼上（autoSubmit 時補按 Enter）」→ finally 清本輪暫存檔並釋放並發鎖（shortcut.js:133-196）
- 依賴: electron globalShortcut、koffi、./store、./recorder、./overlay、./api/stt、./api/llm、./typer、./logger

## src/recorder.js — 錄音模組（主程序側）
- 功能: 在系統 temp 下建 notype 子目錄存暫存音訊（recorder.js:15-19）
- 功能: createRecorderWindow——建 1x1 隱藏視窗跑 MediaRecorder（主程序無法直接錄音）（recorder.js:21-39）
- 功能: startRecording——視窗載入完成才送 start；冷啟動競態防護：若 start 送出前已收到 stop（短按）則 start 後立即補送 stop（recorder.js:41-57）
- 功能: stopRecording——start 尚未送出時記 pendingStop 待補，否則送 stop-recording（recorder.js:59-68）
- 功能: saveAudioBuffer——把音訊存成帶唯一 id（pid+時間戳+亂數）的 webm 檔，避免並發兩輪互相覆蓋（recorder.js:73-81）
- 功能: cleanupTempAudio——只刪指定本輪暫存檔（未帶參數時退回刪最後一次路徑）（recorder.js:85-91）
- 依賴: electron（BrowserWindow/app）、fs、path、os、./logger

## src/recorder-page.html — 隱藏錄音視窗 renderer
- 功能: pickMime——依序挑可用音訊格式（webm/opus → webm → ogg/opus）（recorder-page.html:19-25）
- 功能: start——getUserMedia 開單聲道麥克風（含 echoCancellation/noiseSuppression）、啟動 MediaRecorder、收集 chunks；getUserMedia 期間若已收 stop 則釋放麥克風並回送空音訊（recorder-page.html:27-50）
- 功能: onStop——把 chunks 封裝成 Blob → arrayBuffer → 回送主程序，並釋放麥克風串流（recorder-page.html:52-62）
- 功能: stop——初始化中標記待停；正在錄則停止；無進行中錄音則回送空音訊讓主程序收尾（recorder-page.html:64-77）
- 依賴: window.recApi（recorder-preload.js 注入）、瀏覽器 MediaRecorder / getUserMedia

## src/recorder-preload.js — 錄音視窗橋接
- 功能: 暴露 recApi——onStart / onStop（接主程序指令）、sendAudio / reportError（回送音訊與錯誤）（recorder-preload.js:4-9）
- 依賴: electron contextBridge / ipcRenderer

## src/api/stt.js — 語音轉文字（雲端 Whisper）
- 功能: PROVIDERS 定義——OpenAI（whisper-1）與 Groq（whisper-large-v3）的 URL/model/金鑰欄位/標籤（stt.js:6-19）
- 功能: 中英混雜引導 prompt（ZH_MIX_PROMPT）偏置輸出為繁中並保留英文術語（stt.js:22-23）
- 功能: transcribe——讀暫存檔組 multipart FormData（file/model/response_format/temperature），依語言設定帶 language 與引導 prompt，POST 到對應端點（stt.js:27-79）
- 功能: 30s 逾時——AbortController 逾時即丟逾時錯誤，避免浮窗永遠停在處理中（stt.js:25, 54-71）
- 依賴: fs、../store（getStore/getApiKey）、../logger、全域 fetch/Blob/FormData

## src/api/llm.js — LLM 文字潤稿
- 功能: PROVIDERS 定義——OpenAI（gpt-4o-mini）與 Groq（llama-3.3-70b-versatile）chat/completions 端點（llm.js:5-16）
- 功能: GUARD 護欄——強制把 <<< >>> 內容視為待潤稿逐字稿而非指令，防 prompt injection / 模型反問（llm.js:22-23, 99）
- 功能: tooShortToPolish——≤3 字直接原樣回避免誤判（llm.js:25-28, 71）
- 功能: looksLikeRefusal——偵測模型反問要逐字稿（強訊號單一命中即判 / 弱訊號需開頭命中或 ≥2 命中或極短）視為失敗回原文（llm.js:36-57）
- 功能: getActiveRole——取目前生效的潤稿角色（llm.js:60-64）
- 功能: polishText——llmEnabled 關閉/空文/過短直接回原文；組 system（角色 prompt + GUARD）+ user 訊息呼叫 API；失敗、逾時（20s）、無金鑰、疑似反問皆 fail-open 回原文（llm.js:67-129）
- 依賴: ../store（getStore/getApiKey）、../logger、全域 fetch

## src/typer.js — 鍵盤模擬輸入（koffi keybd_event）
- 功能: koffi 載 user32.dll、宣告 keybd_event；定義 VK 常數（typer.js:6-16）
- 功能: releaseAllModifiers——強制釋放可能卡住的 Alt/Ctrl/Space，避免貼上時變成組合鍵（typer.js:21-27）
- 功能: simulateCtrlV——模擬 Ctrl+V 序列（含前後 releaseAllModifiers 與 sleep 確保落地）（typer.js:29-41）
- 功能: backupClipboard / restoreClipboard——備份與還原剪貼簿全格式（text/html/rtf/image/bookmark），原本為空則還原成空（typer.js:48-94）
- 功能: typeText——序列化鎖（_chain）確保同時只跑一次「備份→寫入→貼上→還原」；貼上完成即 resolve（UX 快），還原前確認剪貼簿仍是注入文字才還原（typer.js:96-138）
- 功能: copyToClipboard——只寫純文字到剪貼簿（typer.js:140-142）
- 功能: pressEnter——模擬按一下 Enter（聊天視窗自動送出用）（typer.js:145-150）
- 依賴: electron clipboard、koffi、./logger

## src/store.js — 設定存儲與金鑰加密
- 功能: 金鑰加密——以 Electron safeStorage（DPAPI）加密金鑰，加密值帶 safeStorage:v1: 前綴；不可用時 fallback 明文不崩潰（store.js:5-47）
- 功能: BUILTIN_ROLES——5 個內建潤稿角色（口語轉書面 / 即時通訊 / 商務 Email / 會議記錄 / 程式技術），各含 persona prompt（store.js:50-71）
- 功能: defaults——集中定義所有預設值（STT provider、語言、llmEnabled、輸入方式、熱鍵 F9、送出開關熱鍵 F10、開機啟動）（store.js:74-97）
- 功能: migrateRoles——首次/升級時建角色清單，並把舊 llmStyle/llmCustomPrompt（含 custom/concise/translate_en）遷移為角色（store.js:100-126）
- 功能: getApiKey / setApiKey——讀寫單一金鑰欄位（自動解密/加密）（store.js:129-136）
- 功能: getSettingsForRenderer / applySettings——回傳整份設定（金鑰解密供 UI）/ 批次寫入（金鑰自動加密）（store.js:139-153）
- 功能: migrateApiKeyEncryption——把舊明文金鑰就地升級為 safeStorage 加密（store.js:156-169）
- 功能: getStore——單例初始化（electron-store v8）+ 兩個遷移（store.js:171-181）
- 依賴: electron-store v8、electron safeStorage、./logger

## src/tray.js — 系統匣
- 功能: resolveIconPath——production 用 resourcesPath、開發用專案 assets 找圖示（tray.js:11-20）
- 功能: STATE_TIP——各狀態（idle/recording/processing/polishing/error）的 tooltip 文案（tray.js:22-28）
- 功能: buildMenu——右鍵選單：設定 / 潤稿角色 radio 子選單（即時切換 activeRoleId）/ 結束（tray.js:31-55）
- 功能: createTray——建立系統匣、設 tooltip 與選單、左鍵點開設定（tray.js:62-80）
- 功能: setTrayState / refreshTrayMenu——依流程狀態更新 tooltip / 重建選單（tray.js:57-60, 82-85）
- 依賴: electron（Tray/Menu/nativeImage）、path、fs、./logger、./store

## src/overlay.js — 狀態浮窗管理（主程序側）
- 功能: createOverlayWindow——建無邊框、透明、不搶焦點（focusable:false）、skipTaskbar、置頂的 240x84 浮窗（overlay.js:10-36）
- 功能: positionBottomCenter——定位到主螢幕工作區底部置中（overlay.js:38-48）
- 功能: showOverlay——送狀態（recording/processing/polishing/done/error/toggle）給浮窗、showInactive 不奪焦點、同步系統匣狀態（overlay.js:51-65）
- 功能: hideOverlay——延遲隱藏並把系統匣狀態還原為 idle（overlay.js:67-75）
- 依賴: electron（BrowserWindow/screen）、path、./logger、./tray

## src/overlay.html — 浮窗 renderer（含內嵌樣式與腳本）
- 功能: 各狀態的圖示與文案——錄音中（音波動畫+紅點）/ 辨識中（spinner）/ 潤稿中（amber spinner）/ 完成（綠勾）/ 錯誤（紅叉）/ 即時送出（toggle）（overlay.html:53-63）
- 功能: render——依狀態替換圖示與主副文字，副文字可由 detail 覆寫（overlay.html:64-69）
- 依賴: window.overlayApi（overlay-preload.js 注入）

## src/overlay-preload.js — 浮窗橋接
- 功能: 暴露 overlayApi.onState——接收主程序狀態更新（overlay-preload.js:4-6）
- 依賴: electron contextBridge / ipcRenderer

## src/settings/settings.js — 設定頁 renderer
- 功能: load——從主程序載入設定、鏡像角色清單、初始化所有 UI 控件與版本/熱鍵顯示（settings.js:9-30）
- 功能: UI helper——segment 選擇器、toggle、輸入方式 radio（複製 vs 貼上）、依狀態淡化 LLM 區與 autoSubmit 列、未填金鑰橫幅（settings.js:37-73）
- 功能: 角色管理——渲染清單、選取/刪除（至少留 1 個）、開/關編輯器、新增/編輯角色（名稱/prompt/per-role model）（settings.js:75-147）
- 功能: 事件綁定——STT provider 切換連動金鑰欄、各 toggle、輸入方式切換、金鑰輸入即時同步（settings.js:149-166）
- 功能: 測試 API Key——呼叫主程序驗證並顯示結果狀態（settings.js:168-184）
- 功能: 儲存——組 payload（含 roles/activeRoleId/各設定）寫回主程序並閃示已儲存提示（settings.js:186-206）
- 依賴: window.notype（settings/preload.js 注入）、設定頁 DOM

## src/settings/preload.js — 設定頁橋接
- 功能: 暴露 notype——getVersion / getSettings / saveSettings / testApiKey（settings/preload.js:4-9）
- 依賴: electron contextBridge / ipcRenderer

## src/settings/index.html + settings.css — 設定頁 UI
- 功能: mono-gray 極簡主題的設定頁版面與樣式（STT 選擇、金鑰、語言、LLM 潤稿開關與角色、輸入方式、開機啟動、熱鍵顯示）
- 依賴: settings.js、settings/preload.js 注入的 notype API

## src/logger.js — 跨機 debug log
- 功能: 把 log 寫到系統 temp 的 notype-debug.log（無主控台的打包環境可追問題）（logger.js:5-14）
- 功能: 不依賴語系的本地時間戳、Error/物件格式化、寫檔失敗不拖垮主程序（logger.js:16-45）
- 功能: 暴露 log.info / warn / error / path（logger.js:47-52）
- 依賴: fs、path、electron app（取 temp 路徑）

## scripts/generate-icon.js — 系統匣圖示產生器（建置工具，非執行期）
- 功能: 用 pngjs 程式化繪製 256x256 麥克風圖示（藍底圓 + 白色麥克風頭/支架/立柱/底座）（generate-icon.js:24-82）
- 功能: 輸出 assets/icon.png，再用 png-to-ico 轉出 assets/icon.ico（generate-icon.js:84-100）
- 依賴: fs、path、pngjs、png-to-ico（devDependency）

---

## IPC 通道總覽
- invoke（雙向）: get-version、get-settings、save-settings、test-api-key
- on/send（單向）: audio-data（錄音視窗 → 主程序）、recorder-error（錄音視窗 → 主程序）、start-recording / stop-recording（主程序 → 錄音視窗）、overlay-state（主程序 → 浮窗）

## 端到端資料流
1. 按住 F9（shortcut.js globalShortcut）→ startRec → 浮窗顯示錄音中 + 啟動隱藏視窗 MediaRecorder
2. 放開 F9（GetAsyncKeyState 80ms 輪詢偵測）→ stopRec → 錄音視窗 onStop 回送音訊 buffer
3. main.js 收 audio-data → handleAudioData → saveAudioBuffer 存暫存 webm
4. stt.js transcribe → 雲端 Whisper 轉文字
5. llm.js polishText → 雲端 LLM 依生效角色潤稿（fail-open）
6. typer.js typeText（剪貼簿 + 模擬 Ctrl+V）貼進游標；autoSubmit 開啟時補按 Enter；或改為只複製到剪貼簿
7. 全程由 overlay.js 浮窗 + tray.js tooltip 顯示狀態，結束後清本輪暫存檔
