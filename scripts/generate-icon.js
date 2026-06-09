// 程式化產生 256x256 麥克風圖示 PNG + ICO（Windows 系統匣需 ≥256 才不模糊）
// SVG 在 Electron 系統匣支援不完整，故用 pngjs 直接繪點陣。
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const SIZE = 256;
const png = new PNG({ width: SIZE, height: SIZE });

// 色：藍底圓 + 白麥克風
const BG = [37, 99, 235, 255]; // #2563eb
const FG = [255, 255, 255, 255];
const TRANSPARENT = [0, 0, 0, 0];

function setPixel(x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const idx = (SIZE * y + x) << 2;
  png.data[idx] = r;
  png.data[idx + 1] = g;
  png.data[idx + 2] = b;
  png.data[idx + 3] = a;
}

const cx = SIZE / 2;
const cy = SIZE / 2;
const R = SIZE / 2 - 4;

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const dx = x - cx;
    const dy = y - cy;
    const inCircle = dx * dx + dy * dy <= R * R;
    setPixel(x, y, inCircle ? BG : TRANSPARENT);
  }
}

// 麥克風頭（圓角膠囊）
const micW = SIZE * 0.22;
const micTop = SIZE * 0.28;
const micH = SIZE * 0.30;
const micCx = cx;
const rCap = micW / 2;

function fillCapsule() {
  for (let y = micTop; y <= micTop + micH; y++) {
    for (let x = micCx - rCap; x <= micCx + rCap; x++) {
      const topCenterY = micTop + rCap;
      const botCenterY = micTop + micH - rCap;
      let inside = false;
      if (y < topCenterY) {
        inside = (x - micCx) ** 2 + (y - topCenterY) ** 2 <= rCap ** 2;
      } else if (y > botCenterY) {
        inside = (x - micCx) ** 2 + (y - botCenterY) ** 2 <= rCap ** 2;
      } else {
        inside = Math.abs(x - micCx) <= rCap;
      }
      if (inside) setPixel(Math.round(x), Math.round(y), FG);
    }
  }
}
fillCapsule();

// 支架弧線（U 形）+ 立柱 + 底座
const arcR = micW * 0.95;
const arcCy = micTop + micH * 0.55;
for (let a = 0; a <= Math.PI; a += 0.004) {
  const x = micCx + arcR * Math.cos(a);
  const y = arcCy + arcR * Math.sin(a);
  for (let t = -3; t <= 3; t++) {
    for (let s = -3; s <= 3; s++) setPixel(Math.round(x) + t, Math.round(y) + s, FG);
  }
}
// 立柱
const standTop = arcCy + arcR;
const standBot = SIZE * 0.80;
for (let y = standTop; y <= standBot; y++) {
  for (let x = micCx - 4; x <= micCx + 4; x++) setPixel(Math.round(x), Math.round(y), FG);
}
// 底座
for (let x = micCx - micW * 0.55; x <= micCx + micW * 0.55; x++) {
  for (let y = standBot; y <= standBot + 8; y++) setPixel(Math.round(x), Math.round(y), FG);
}

const assetsDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(assetsDir, { recursive: true });
const pngPath = path.join(assetsDir, 'icon.png');

png.pack().pipe(fs.createWriteStream(pngPath)).on('finish', async () => {
  console.log('已產生', pngPath);
  try {
    const mod = require('png-to-ico');
    const pngToIco = typeof mod === 'function' ? mod : mod.default;
    const buf = await pngToIco(pngPath);
    const icoPath = path.join(assetsDir, 'icon.ico');
    fs.writeFileSync(icoPath, buf);
    console.log('已產生', icoPath);
  } catch (e) {
    console.warn('png-to-ico 失敗（先安裝 devDependencies）：', e.message);
  }
});
