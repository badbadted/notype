// 滑鼠觸發鍵攔截（worker 執行緒）— 安裝 WH_MOUSE_LL 低階滑鼠掛鉤，抓指定的側鍵 / 中鍵。
// 為什麼放 worker：低階掛鉤的回呼在「安裝它的執行緒」上執行，而且全系統每一次滑鼠移動都會經過它。
// 放在主程序執行緒的話，主程序只要忙一下（寫檔、GC）整台電腦的滑鼠就會卡；回呼太慢 Windows 還會默默拆掉掛鉤。
// 這個執行緒只做一件事：GetMessageW 迴圈＋回呼內判斷要不要攔，攔到就通知主程序。
//
// 觸發鍵由主程序寫進共用記憶體（SharedArrayBuffer），回呼每次都讀最新值，改設定不必重開執行緒。
// 被選中的那顆鍵會被吞掉（回傳 1），否則側鍵在瀏覽器裡會同時觸發上一頁／下一頁。
const { parentPort, workerData } = require('worker_threads');
const koffi = require(workerData.koffiPath);

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

const POINT = koffi.struct('NT_POINT', { x: 'long', y: 'long' });
const MSLLHOOKSTRUCT = koffi.struct('NT_MSLLHOOKSTRUCT', {
  pt: POINT, mouseData: 'uint32', flags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr_t',
});
const MSG = koffi.struct('NT_MSG', {
  hwnd: 'intptr_t', message: 'uint32', wParam: 'uintptr_t', lParam: 'intptr_t', time: 'uint32', pt: POINT,
});
const LowLevelMouseProc = koffi.proto('intptr_t __stdcall NT_LowLevelMouseProc(int nCode, uintptr_t wParam, void *lParam)');

const SetWindowsHookExW = user32.func('intptr_t __stdcall SetWindowsHookExW(int idHook, NT_LowLevelMouseProc *lpfn, intptr_t hmod, uint32 threadId)');
const UnhookWindowsHookEx = user32.func('bool __stdcall UnhookWindowsHookEx(intptr_t hhk)');
const CallNextHookEx = user32.func('intptr_t __stdcall CallNextHookEx(intptr_t hhk, int nCode, uintptr_t wParam, void *lParam)');
const GetMessageW = user32.func('int __stdcall GetMessageW(_Out_ NT_MSG *msg, intptr_t hwnd, uint32 min, uint32 max)');
const GetModuleHandleW = kernel32.func('intptr_t __stdcall GetModuleHandleW(intptr_t name)');
const GetCurrentThreadId = kernel32.func('uint32 __stdcall GetCurrentThreadId()');

const WH_MOUSE_LL = 14;
const WM_MBUTTONDOWN = 0x0207, WM_MBUTTONUP = 0x0208;
const WM_XBUTTONDOWN = 0x020B, WM_XBUTTONUP = 0x020C;
// 共用記憶體裡的觸發鍵代碼（與 mousehook.js 的 BUTTON_CODES 對應）：0=關閉 1=上一頁鍵 2=下一頁鍵 3=中鍵
const config = new Int32Array(workerData.shared);

let hook = 0;

// 回呼要極快：只判斷、通知，不做任何 I/O
function onMouse(nCode, wParam, lParam) {
  if (nCode === 0 && (wParam === WM_XBUTTONDOWN || wParam === WM_XBUTTONUP || wParam === WM_MBUTTONDOWN || wParam === WM_MBUTTONUP)) {
    const info = koffi.decode(lParam, MSLLHOOKSTRUCT); // 只有按鍵事件才解碼，滑鼠移動直接放行
    const want = Atomics.load(config, 0);
    if (want !== 0) { // 不排除模擬點擊：用 AutoHotkey／X-Mouse 等工具改鍵的人，送來的側鍵就是模擬的
      let button = 0;
      let phase = null;
      if (wParam === WM_XBUTTONDOWN || wParam === WM_XBUTTONUP) {
        button = (info.mouseData >>> 16) & 0xffff; // HIWORD：XBUTTON1=1（上一頁）、XBUTTON2=2（下一頁）
        phase = wParam === WM_XBUTTONDOWN ? 'down' : 'up';
      } else if (wParam === WM_MBUTTONDOWN || wParam === WM_MBUTTONUP) {
        button = 3;
        phase = wParam === WM_MBUTTONDOWN ? 'down' : 'up';
      }
      if (phase && button === want) {
        parentPort.postMessage({ type: phase });
        return 1; // 吞掉，不讓前景程式收到（不會跳上一頁）
      }
    }
  }
  return CallNextHookEx(hook, nCode, wParam, lParam);
}

const proc = koffi.register(onMouse, koffi.pointer(LowLevelMouseProc));
hook = SetWindowsHookExW(WH_MOUSE_LL, proc, GetModuleHandleW(0), 0);
parentPort.postMessage({ type: 'ready', ok: hook !== 0, threadId: GetCurrentThreadId() });

if (hook) {
  // 掛鉤回呼由這個迴圈驅動；主程序以 PostThreadMessageW(WM_QUIT) 讓 GetMessageW 回 0 結束
  const msg = {};
  while (GetMessageW(msg, 0, 0, 0) > 0) { /* 低階掛鉤不需要 Translate/Dispatch */ }
  UnhookWindowsHookEx(hook);
}
koffi.unregister(proc);
