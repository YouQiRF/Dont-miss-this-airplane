/**
 * 從 AviaGame.ts 的 @property 宣告抽出每個參數的預設值，產生兩份東西：
 *
 *   assets/scripts/AviaDefaults.ts   程式用的預設值表（Inspector 的「還原預設值」按鈕會用它）
 *   DEFAULTS.md                      給人看的完整參數表（分組、預設值、說明）
 *
 *   node tools/gendefaults.js
 *
 * 改完 AviaGame.ts 的預設值後重跑一次就同步了。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'assets/scripts/AviaGame.ts'), 'utf8').replace(/\r\n/g, '\n');

// 組名對照
const groups = {};
for (const m of SRC.matchAll(/const (G_\w+) = \{ name: '([^']+)'/g)) groups[m[1]] = m[2];

/**
 * 抓 @property({...}) 之後的第一個 `name = value;`
 * value 可能跨行（陣列、new Color(...)），所以一路吃到分號為止。
 */
// SpeedOption 的成員值。列舉必須換成數值 —— AviaDefaults 不能 import AviaGame（會循環相依）
const SPEED_ENUM = {};
{
    const m = SRC.match(/export enum SpeedOption \{([^}]*)\}/);
    if (m) for (const e of m[1].matchAll(/(\w+)\s*=\s*(\d+)/g)) SPEED_ENUM[e[1]] = +e[2];
}
const deEnum = v => v.replace(/SpeedOption\.(\w+)/g, (_, k) => String(SPEED_ENUM[k] ?? 0));

/**
 * 資產參考型別（Prefab / AudioClip）不寫進 AVIA_DEFAULTS。
 * 它們的「預設值」是 null，寫進去等於「還原預設值」會把使用者辛苦拖好的
 * Prefab 與音檔全部清空 —— 那不是還原，那是刪資料。
 * 參數表（DEFAULTS.md）還是照列，只是標成「未指定」。
 */
const ASSET_TYPES = /type:\s*(Prefab|AudioClip)\b/;

const props = [];
const re = /@property\(\s*(\{[\s\S]*?\})\s*\)\s*\n?\s*([A-Za-z_]\w*)(?:\s*:\s*[^=]+?)?\s*=\s*([\s\S]*?);\n/g;
for (const m of SRC.matchAll(re)) {
    const [, opts, name, rawValue] = m;
    const g = opts.match(/group:\s*(G_\w+)/);
    const tip = opts.match(/tooltip:\s*'((?:[^'\\]|\\.)*)'/);
    props.push({
        name,
        value: deEnum(rawValue.trim().replace(/\s*\n\s*/g, ' ')),
        group: g ? (groups[g[1]] ?? g[1]) : '（未分組）',
        tip: tip ? tip[1].replace(/\\'/g, "'") : '',
        asset: ASSET_TYPES.test(opts),
    });
}
const resettable = props.filter(p => !p.asset);

if (props.length < 50) {
    console.error(`⚠ 只抓到 ${props.length} 個參數，看起來解析失敗了，沒有寫檔`);
    process.exit(1);
}

// ── 1. 程式用的預設值表 ──
const ts = `/**
 * AviaDefaults.ts — 所有 Inspector 參數的預設值。
 *
 * 這個檔案由 tools/gendefaults.js 從 AviaGame.ts 自動產生，請勿手改。
 * 改預設值請改 AviaGame.ts 的 @property 宣告，然後重跑：
 *
 *     node tools/gendefaults.js
 *
 * 用途：Inspector 最後一組「測試」的「還原預設值」按鈕會把所有欄位設回這裡的值。
 *
 * 全部 ${props.length} 個參數裡有 ${resettable.length} 個在這裡；
 * 少掉的 ${props.length - resettable.length} 個是 Prefab / AudioClip 這類資產參考 ——
 * 它們的預設值是 null，還原時**刻意不碰**，免得一鍵把拖好的美術與音檔清光。
 */

import { Color } from 'cc';

export const AVIA_DEFAULTS = {
${resettable.map(p => `    ${p.name}: ${p.value},`).join('\n')}
};

export type AviaDefaultKey = keyof typeof AVIA_DEFAULTS;
`;
fs.writeFileSync(path.join(ROOT, 'assets/scripts/AviaDefaults.ts'), ts, 'utf8');

// ── 2. 給人看的參數表 ──
const byGroup = {};
for (const p of props) (byGroup[p.group] ??= []).push(p);

const fmt = (v, asset) => {
    if (asset) return '（未指定）';
    const m = v.match(/^new Color\((\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)$/);
    if (m) {
        const hex = '#' + [1, 2, 3].map(i => (+m[i]).toString(16).padStart(2, '0')).join('');
        return `\`${hex}\`${m[4] === '255' ? '' : ` (a=${m[4]})`}`;
    }
    return '`' + v.replace(/\|/g, '\\|') + '`';
};

let md = `# Inspector 參數預設值

共 **${props.length}** 個參數，全部可在 Cocos 的 Inspector 調整。

這份文件由 \`node tools/gendefaults.js\` 從 \`AviaGame.ts\` 自動產生，改完預設值重跑一次就同步。

**還原預設值**：Inspector 最後一組（測試）有一個「還原預設值」勾選框，
勾一下就把 ${resettable.length} 個欄位設回這裡的值。
標成「（未指定）」的 ${props.length - resettable.length} 個是 Prefab / AudioClip 等資產參考，
**還原時不會被清空** —— 拖好的美術與音檔不會因為按錯一下就消失。

**驗證覆蓋率**：\`node tools/audit-inspector.ts\` 會檢查演算法裡每個可設定變數
是否都真的接進了 Inspector（目前 71/71 全接）。

---

`;
for (const [g, list] of Object.entries(byGroup)) {
    md += `## ${g}\n\n| 參數 | 預設值 | 說明 |\n|---|---|---|\n`;
    for (const p of list) md += `| \`${p.name}\` | ${fmt(p.value, p.asset)} | ${p.tip || '—'} |\n`;
    md += '\n';
}
fs.writeFileSync(path.join(ROOT, 'DEFAULTS.md'), md, 'utf8');

console.log(`抓到 ${props.length} 個參數（其中 ${props.length - resettable.length} 個是資產參考,不列入還原）`);
Object.entries(byGroup).forEach(([g, l]) => console.log(`  ${g.padEnd(18)} ${l.length}`));
console.log('\n已產生  assets/scripts/AviaDefaults.ts');
console.log('已產生  DEFAULTS.md');
