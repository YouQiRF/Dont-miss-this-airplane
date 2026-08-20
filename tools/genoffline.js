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
  /* 下注器：−  金額  ＋（金額本身不可點，只有兩顆鍵） */
  #stepper { display: flex; align-items: center; gap: 4px; pointer-events: auto;
    background: rgba(6,16,30,.55); border: 1px solid rgba(255,255,255,.26);
    border-radius: 12px; padding: 4px; }
  .step { width: 44px; height: 40px; font-size: 22px; line-height: 1; }
  #betval { min-width: 96px; text-align: center; font-size: 20px; font-weight: 700;
    color: #eaf4ff; font-variant-numeric: tabular-nums; }
  .right { display: flex; align-items: center; gap: 10px; pointer-events: auto; }
  /* 速度選單：往上展開，選完就收 */
  #speedwrap { position: relative; }
  #speedbtn { padding: 9px 14px; font-size: 14px; white-space: nowrap; }
  #auto { padding: 11px 16px; font-size: 15px; letter-spacing: .04em; }
  #speeds { display: none; flex-direction: column; gap: 4px;
    position: absolute; bottom: calc(100% + 6px); left: 0; right: 0;
    background: rgba(10,22,38,.96); border: 1px solid rgba(255,255,255,.18);
    border-radius: 12px; padding: 5px; box-shadow: 0 10px 30px rgba(0,0,0,.5); }
  /* 按鈕底色：深色半透明。白底疊在亮藍的天空上等於沒有底，字很難讀 */
  button { font: inherit; color: #dceaf8; cursor: pointer;
    background: rgba(6,16,30,.65); border: 1px solid rgba(255,255,255,.32);
    border-radius: 9px; transition: transform .06s, background .12s; }
  button:hover:not(:disabled) { background: rgba(6,16,30,.82); }
  button:active:not(:disabled) { transform: scale(.94); }
  button:disabled { opacity: .38; cursor: default; }
  button.on { background: #ffca46; border-color: #fff; color: #16202e; font-weight: 700; }
  .sp { padding: 9px 12px; font-size: 14px; text-align: center; }
  #spin { padding: 16px 34px; font-size: 24px; font-weight: 800; letter-spacing: .5px; }
  #info { position: absolute; left: 0; right: 0; bottom: 92px; text-align: center;
    font-size: 15px; opacity: .85; }
  #panel { position: absolute; right: 24px; bottom: 108px; width: 360px;
    background: rgba(10,22,38,.96); border: 1px solid rgba(255,255,255,.18);
    border-radius: 16px; padding: 16px; pointer-events: auto; display: none;
    box-shadow: 0 16px 48px rgba(0,0,0,.55); }
  #panel h3 { font-size: 16px; margin-bottom: 14px; font-weight: 700; color: #eaf4ff;
    padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,.12); }
  /* 小節標題：把「局數」跟「停止條件」分開，不再全部擠成一片按鈕 */
  .sect { font-size: 12px; letter-spacing: .08em; opacity: .55; margin: 0 0 7px 2px; }
  #counts { display: flex; gap: 5px; margin-bottom: 8px; }
  .cnt { flex: 1; padding: 9px 0; font-size: 14px; }
  .prow { display: flex; align-items: center; gap: 8px; margin-bottom: 14px;
    border: 1px solid rgba(255,255,255,.14); border-radius: 10px; padding: 6px 10px; }
  .prow.on { border-color: #ffca46; background: rgba(255,202,70,.10); }
  .prow > span { font-size: 13px; opacity: .7; }
  .prow .unit { opacity: .5; }
  #cnt { flex: 1; min-width: 0; font: inherit; font-size: 17px; font-weight: 700;
    color: #eaf4ff; background: none; border: none; outline: none; text-align: right;
    font-variant-numeric: tabular-nums; }
  #cnt::placeholder { font-size: 14px; font-weight: 400; opacity: .35; }
  /* 數字框右邊的上下小箭頭會擠掉版面，拿掉 */
  #cnt::-webkit-outer-spin-button, #cnt::-webkit-inner-spin-button {
    -webkit-appearance: none; margin: 0; }
  #cnt { -moz-appearance: textfield; appearance: textfield; }
  #conds { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
  .cond { padding: 10px 12px; font-size: 14px; text-align: left; }
  /* 金額條件：標題 + 玩家自己輸入的框 */
  .prow.amt { margin-bottom: 0; padding: 5px 12px; }
  .amtlabel { flex: 1; font-size: 14px; opacity: .9; }
  .prow.amt input { flex: 0 0 96px; min-width: 0; font: inherit; font-size: 15px;
    font-weight: 700; color: #eaf4ff; background: none; border: none; outline: none;
    text-align: right; font-variant-numeric: tabular-nums; }
  .prow.amt input::placeholder { font-size: 13px; font-weight: 400; opacity: .35; }
  .prow.amt input::-webkit-outer-spin-button,
  .prow.amt input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  .prow.amt input { -moz-appearance: textfield; appearance: textfield; }
  #autostart { width: 100%; padding: 13px; font-size: 17px; font-weight: 700; }
  @media (max-width: 820px) {
    .step { width: 38px; height: 36px; font-size: 19px; }
    #betval { min-width: 74px; font-size: 17px; }
    #spin { padding: 12px 22px; font-size: 19px; }
    #panel { width: calc(100vw - 48px); right: 24px; }
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
