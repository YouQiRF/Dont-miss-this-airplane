/**
 * 產生單檔離線版：AviaOffline.html
 *
 *   node tools/genoffline.js
 *
 * 雙擊就能玩，不需要伺服器、不需要 Cocos、不需要網路。
 *
 * 演算法直接從 assets/scripts/AviaPath.ts 原檔剝掉型別後注入 ——
 * 所以航線邏輯永遠只有一份，改 AviaPath.ts 之後重跑這支就同步了，
 * 不會出現「Cocos 版和離線版行為不一樣」的情況。
 *
 * 離線版的結果是本地隨機（offlineResult），沒有任何連線。
 */

const fs = require('fs');
const path = require('path');
const { stripTypeScriptTypes } = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'AviaOffline.html');

// ── 1. 演算法：剝掉型別，拿掉 export（inline module 不能有 export）──
const tsSrc = fs.readFileSync(path.join(ROOT, 'assets/scripts/AviaPath.ts'), 'utf8');
let algo = stripTypeScriptTypes(tsSrc, { mode: 'strip' });
algo = algo.replace(/^export\s+/gm, '');
if (/\bexport\b/.test(algo)) {
    console.warn('⚠ 還有殘留的 export，可能會讓 inline script 掛掉');
}

// ── 2. 渲染層 ──
const render = fs.readFileSync(path.join(__dirname, 'offline/renderer.js'), 'utf8');

// ── 3. 組裝 ──
const html = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Aviamasters 離線版</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; background: #0a1420; overflow: hidden;
    font-family: system-ui, -apple-system, "Noto Sans TC", sans-serif;
    -webkit-user-select: none; user-select: none; }
  #stage { position: relative; width: 100vw; height: 100vh;
    display: flex; align-items: center; justify-content: center; }
  canvas { display: block; border-radius: 6px; box-shadow: 0 8px 40px rgba(0,0,0,.55); }
  #ui { position: absolute; inset: 0; pointer-events: none;
    display: flex; flex-direction: column; justify-content: space-between;
    padding: 18px 24px; max-width: 1280px; max-height: 720px;
    margin: auto; color: #c4def4; }
  .row { display: flex; justify-content: space-between; align-items: flex-end; }
  .row.top { align-items: flex-start; font-size: 15px; }
  #bal { font-size: 20px; color: #eaf4ff; }
  #betl { opacity: .75; }
  #win { font-size: 22px; font-weight: 700; color: #ffca46; }
  #chips { display: flex; gap: 6px; flex-wrap: wrap; max-width: 62%; pointer-events: auto; }
  .right { display: flex; align-items: center; gap: 10px; pointer-events: auto; }
  #speeds { display: flex; gap: 5px; }
  button { font: inherit; color: #dceaf8; cursor: pointer;
    background: rgba(255,255,255,.10); border: 1px solid rgba(255,255,255,.22);
    border-radius: 9px; transition: transform .06s, background .12s; }
  button:hover:not(:disabled) { background: rgba(255,255,255,.18); }
  button:active:not(:disabled) { transform: scale(.94); }
  button:disabled { opacity: .38; cursor: default; }
  button.on { background: #ffca46; border-color: #fff; color: #16202e; font-weight: 700; }
  .chip { padding: 8px 12px; font-size: 15px; min-width: 54px; }
  .sp { padding: 6px 10px; font-size: 13px; }
  #spin { padding: 16px 34px; font-size: 24px; font-weight: 800; letter-spacing: .5px; }
  #info { position: absolute; left: 0; right: 0; bottom: 92px; text-align: center;
    font-size: 15px; opacity: .85; }
  @media (max-width: 820px) {
    #chips { max-width: 55%; }
    .chip { padding: 6px 9px; font-size: 13px; min-width: 44px; }
    #spin { padding: 12px 22px; font-size: 19px; }
  }
</style>
</head>
<body>
<div id="stage"><canvas id="c"></canvas><div id="ui"></div></div>
<script type="module">
/* ============================================================
 * 以下由 tools/genoffline.js 自動產生，請勿直接修改這個檔案。
 * 演算法來源：assets/scripts/AviaPath.ts
 * 渲染來源：  tools/offline/renderer.js
 * 產生時間：  ${new Date().toISOString()}
 * ============================================================ */

/* ───────────────── 演算法（AviaPath.ts） ───────────────── */
${algo}

/* ───────────────── 渲染與遊戲迴圈 ───────────────── */
${render}
</script>
</body>
</html>
`;

fs.writeFileSync(OUT, html, 'utf8');
const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`已產生  ${OUT}  (${kb} KB，單檔、零相依)`);
console.log('雙擊就能玩，不需要伺服器。');
