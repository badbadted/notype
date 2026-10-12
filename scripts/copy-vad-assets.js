// 將連續聽寫需要的 VAD 執行檔從 node_modules 複製到 src/vendor/vad/。
// onnxruntime-web 整包 100MB+，打包只帶這幾個檔案；兩個套件列在 devDependencies，不進安裝檔。
// 由 npm prestart / prebuild 自動執行。
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'src', 'vendor', 'vad');
const FILES = [
  ['onnxruntime-web/dist/ort.wasm.min.js'],
  ['onnxruntime-web/dist/ort-wasm-simd-threaded.mjs'],
  ['onnxruntime-web/dist/ort-wasm-simd-threaded.wasm'],
  ['@ricky0123/vad-web/dist/bundle.min.js', 'vad.bundle.min.js'],
  ['@ricky0123/vad-web/dist/vad.worklet.bundle.min.js'],
  ['@ricky0123/vad-web/dist/silero_vad_v5.onnx'],
];

fs.mkdirSync(out, { recursive: true });
for (const [rel, rename] of FILES) {
  const src = path.join(root, 'node_modules', ...rel.split('/'));
  const dst = path.join(out, rename || path.basename(rel));
  if (!fs.existsSync(src)) {
    console.error(`[copy-vad-assets] 找不到 ${src}，請先執行 npm install`);
    process.exit(1);
  }
  const s = fs.statSync(src);
  const d = fs.existsSync(dst) ? fs.statSync(dst) : null;
  if (d && d.size === s.size && d.mtimeMs >= s.mtimeMs) continue;
  fs.copyFileSync(src, dst);
}
console.log('[copy-vad-assets] VAD 資源已就緒 →', path.relative(root, out));
