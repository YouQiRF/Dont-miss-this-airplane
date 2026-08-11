/**
 * 稽核：AviaPath 裡所有可設定的變數，有沒有全部接進 AviaGame 的 Inspector。
 *
 *   node tools/audit-inspector.ts
 *
 * 用執行期讀物件的鍵，而不是用正則去掃原始碼 —— 正則版寫錯過一次，
 * 抓不到任何東西卻回報「全部都有」，比沒檢查還糟。
 */

import { readFileSync } from 'node:fs';
import {
    PHYS, SEA, SYM, STYLE_RANGE, OFFLINE, ENDING_WEIGHTS, TICK_MS,
} from '../assets/scripts/AviaPath.ts';

const game = readFileSync('assets/scripts/AviaGame.ts', 'utf8');

// 只看 pushConfig() 的內容 —— 那是唯一把 Inspector 的值送進演算法的地方
const from = game.indexOf('pushConfig()');
const to = game.indexOf('private canvasW(');
if (from < 0 || to < 0) throw new Error('找不到 pushConfig() 區塊');
const body = game.slice(from, to);

const groups: Record<string, Record<string, unknown>> = {
    PHYS, SEA, SYM, STYLE_RANGE, OFFLINE, ENDING_WEIGHTS, TICK_MS,
};

let total = 0;
for (const [g, obj] of Object.entries(groups)) {
    const keys = Object.keys(obj);
    const miss = keys.filter(k => !new RegExp(`(^|[^\\w])${k}\\s*:`).test(body));
    total += miss.length;
    console.log(`${g.padEnd(15)} ${String(keys.length).padStart(2)} 個鍵` +
        (miss.length ? `　未接 ${miss.length}：${miss.join(', ')}` : '　✓ 全接'));
}
console.log(total ? `\n✗ 共 ${total} 個變數沒有接進 Inspector` : '\n✓ 所有變數都能在 Inspector 調整');
process.exitCode = total ? 1 : 0;
