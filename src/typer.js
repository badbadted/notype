// 鍵盤模擬輸入（koffi 呼叫 Windows keybd_event）— 剪貼簿 + Ctrl+V，相容中文輸入法與所有 App
const { clipboard } = require('electron');
const koffi = require('koffi');
const { log } = require('./logger');

const user32 = koffi.load('user32.dll');
const keybd_event = user32.func('void __stdcall keybd_event(uint8_t bVk, uint8_t bScan, uint32_t dwFlags, uintptr_t dwExtraInfo)');

const VK_LMENU = 0xA4;   // Left Alt
const VK_RMENU = 0xA5;   // Right Alt
const VK_MENU = 0x12;    // Alt（通用）
const VK_SPACE = 0x20;
const VK_CONTROL = 0x11;
const VK_V = 0x56;
const KEYEVENTF_KEYUP = 0x0002;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 強制釋放所有可能卡住的修飾鍵（按住 Alt+Space 錄音後，系統常仍認為 Alt 被按住）
function releaseAllModifiers() {
  keybd_event(VK_LMENU, 0, KEYEVENTF_KEYUP, 0);
  keybd_event(VK_RMENU, 0, KEYEVENTF_KEYUP, 0);
  keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0);
  keybd_event(VK_SPACE, 0, KEYEVENTF_KEYUP, 0);
  keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0);
}

async function simulateCtrlV() {
  releaseAllModifiers();        // 貼上前先清掉卡住的 Alt，避免變成 Alt+Ctrl+V
  await sleep(150);
  keybd_event(VK_CONTROL, 0, 0, 0);
  await sleep(40);
  keybd_event(VK_V, 0, 0, 0);
  await sleep(40);
  keybd_event(VK_V, 0, KEYEVENTF_KEYUP, 0);
  await sleep(40);
  keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0);
  await sleep(40);
  releaseAllModifiers();        // 收尾再清一次
}

// 透過剪貼簿 + Ctrl+V 把文字送進當前游標位置，事後還原剪貼簿
async function typeText(text) {
  if (!text) return;
  log.info('[typer] 輸入文字長度', text.length);
  const original = clipboard.readText();
  clipboard.writeText(text);
  await sleep(180);
  await simulateCtrlV();
  setTimeout(() => clipboard.writeText(original), 1000);
}

function copyToClipboard(text) {
  if (text) clipboard.writeText(text);
}

module.exports = { typeText, copyToClipboard, releaseAllModifiers };
