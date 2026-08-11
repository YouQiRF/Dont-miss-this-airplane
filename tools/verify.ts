/**
 * 離線驗證工具（不需要 Cocos,直接 `node tools/verify.ts`）
 *
 *  1. 掃全部倍數 × 多組 seed,確認每一局都能演出精確結果、都會正常結束
 *  2. 硬性檢查「誘餌絕對碰不到」
 *  3. 印出幾局的 ASCII 路徑,肉眼檢查曲線與物件配置合不合理
 */

// tools/ 不在 assets/ 內,Cocos 不會編譯它,所以可以用 .ts 副檔名讓 node 直接跑
import { buildPerformance, evaluate, OFFLINE, PHYS, SEA, carrierDeckAt } from '../assets/scripts/AviaPath.ts';
import type { PerformanceScript, RoundResult } from '../assets/scripts/AviaPath.ts';

// ══════════════ 1. 正確性掃描 ══════════════

const POOL = OFFLINE.pool;
const SEEDS = 400;

/** 航線長度的硬上限 = 設定上限與「最緊排列所需長度」兩者較大者 */
const HARD_CAP = Math.max(
    PHYS.MAX_ROUND_TICKS,
    PHYS.MIN_GAP * (30 + 1) + PHYS.POP_TICKS + Math.max(PHYS.LAND_TICKS_MAX, PHYS.SPLASH_TICKS_MAX) + 4);

let fail = 0, approx = 0;
let minTicks = 1e9, maxTicks = 0, sumTicks = 0, n = 0;
let minObj = 1e9, maxObj = 0, sumObj = 0, sumDecoy = 0;
let minAlt = 1e9, maxAlt = 0;
let worstClearance = Infinity;

/** 誘餌與航線的最小距離 —— 必須大於碰撞半徑,否則玩家會看到「明明碰到卻沒吃到」 */
function decoyClearance(sc: PerformanceScript): number {
    const span = Math.ceil(PHYS.HIT_RADIUS / PHYS.PX_PER_TICK) + 1;
    let worst = Infinity;
    for (const o of sc.objects) {
        if (o.hit) continue;
        for (let k = -span; k <= span; k++) {
            const t = Math.max(0, Math.min(sc.terminalTick, o.tick + k));
            worst = Math.min(worst, Math.abs(o.y - sc.frames[t].y));
        }
    }
    return worst;
}

for (const m of POOL) {
    for (let s = 0; s < SEEDS; s++) {
        const res: RoundResult = { roundId: `v-${m}-${s}`, multiplier: m, landed: true };
        let sc: PerformanceScript;
        try { sc = buildPerformance(res); }
        catch (e) { console.error(`✗ ${m}× seed${s} 例外:`, (e as Error).message); fail++; continue; }

        if (!sc.exact) approx++;
        if (sc.exact && Math.abs(sc.finalBalance - m) > 1e-7) {
            console.error(`✗ ${m}× seed${s} 演出值 ${sc.finalBalance} ≠ 目標`); fail++;
        }
        const hits = sc.objects.filter(o => o.hit);
        const chain = evaluate(hits.map(o => o.kind));
        if (hits.length && Math.abs(chain[chain.length - 1] - sc.finalBalance) > 1e-7) {
            console.error(`✗ ${m}× seed${s} 物件鏈重算不一致`); fail++;
        }
        // 飛行途中不該碰到水面
        for (let i = 0; i < sc.terminalTick; i++) {
            if (sc.frames[i].y <= 0) { console.error(`✗ ${m}× seed${s} 中途觸水 @${i}`); fail++; break; }
        }
        // 降落成功必須是 EDGE_HOLD，而且飛機停在甲板尾端（機身中心 = 邊緣，半截在外）
        if (sc.ending !== 'EDGE_HOLD') {
            console.error(`✗ ${m}× seed${s} 降落局的結束方式是 ${sc.ending}`); fail++;
        }
        const endX = sc.frames[sc.terminalTick].x;
        if (Math.abs(endX - (sc.carrierX + SEA.HALF_W)) > 2) {
            console.error(`✗ ${m}× seed${s} 停止點 ${endX.toFixed(0)} 不在甲板尾端 ` +
                `${(sc.carrierX + SEA.HALF_W).toFixed(0)}`); fail++;
        }
        if (Math.abs(sc.frames[sc.terminalTick].y - PHYS.DECK_Y) > 1) {
            console.error(`✗ ${m}× seed${s} 降落局終點不在甲板高度`); fail++;
        }
        // x 必須單調不減（不能倒退飛）
        for (let t = 1; t <= sc.terminalTick; t++) {
            if (sc.frames[t].x < sc.frames[t - 1].x - 1e-6) {
                console.error(`✗ ${m}× seed${s} @${t} x 倒退`); fail++; break;
            }
        }
        // 終點保證：航線必須有限、有終點、且在上限之內
        if (!Number.isFinite(sc.terminalTick) || sc.terminalTick <= 0) {
            console.error(`✗ ${m}× seed${s} 沒有終點`); fail++;
        }
        if (sc.terminalTick > HARD_CAP) {
            console.error(`✗ ${m}× seed${s} 航線 ${sc.terminalTick} tick 超過硬上限 ${HARD_CAP}`); fail++;
        }
        if (sc.frames.length !== sc.terminalTick + 1) {
            console.error(`✗ ${m}× seed${s} frames 長度與終點不符`); fail++;
        }
        // 等高階梯：每個物件的淨變化必須 = ±STEP − GLIDE_DROP（觸底除外）
        for (let i = 1; i < hits.length; i++) {
            const d = hits[i].y - hits[i - 1].y;
            const step = hits[i - 1].kind.kind === 'ROCKET' ? -PHYS.STEP_DOWN : PHYS.STEP_UP;
            const expect = step - PHYS.GLIDE_DROP;
            const floored = Math.abs(hits[i].y - PHYS.MIN_ALT) < 1
                || Math.abs(hits[i - 1].y - PHYS.MIN_ALT) < 1;
            if (Math.abs(d - expect) > 1e-6 && !floored) {
                console.error(`✗ ${m}× seed${s} 第 ${i} 階淨變化 ${d.toFixed(1)} ≠ ${expect}`); fail++; break;
            }
        }
        // 飛行規則：除了起飛爬升與命中 +N/×N 的表演,航線任何時刻都必須下降
        // 收尾段（觸艦彈跳／搖晃）不受此限，那是刻意的表演
        const flightEnd = sc.slideFrom >= 0 ? sc.slideFrom : sc.terminalTick;
        const inRise = (t: number) => sc.riseWindows.some(w => t >= w.from && t < w.to);
        for (let t = 0; t < flightEnd; t++) {
            if (sc.frames[t + 1].y > sc.frames[t].y + 1e-9 && !inRise(t)) {
                console.error(`✗ ${m}× seed${s} @${t} 在非命中時段上升 ` +
                    `(${sc.frames[t].y.toFixed(1)} → ${sc.frames[t + 1].y.toFixed(1)})`);
                fail++; break;
            }
        }
        // 命中物件必須真的在航線上
        for (const h of hits) {
            if (Math.abs(h.y - sc.frames[h.tick].y) > 1e-6) {
                console.error(`✗ ${m}× seed${s} 命中物件不在航線上 @${h.tick}`); fail++; break;
            }
        }
        // 誘餌必須碰不到
        const c = decoyClearance(sc);
        worstClearance = Math.min(worstClearance, c);
        if (c <= PHYS.HIT_RADIUS) {
            console.error(`✗ ${m}× seed${s} 誘餌淨空只有 ${c.toFixed(1)}px（碰撞半徑 ${PHYS.HIT_RADIUS}）`);
            fail++;
        }

        minTicks = Math.min(minTicks, sc.terminalTick); maxTicks = Math.max(maxTicks, sc.terminalTick);
        sumTicks += sc.terminalTick; n++;
        minObj = Math.min(minObj, hits.length); maxObj = Math.max(maxObj, hits.length);
        sumObj += hits.length; sumDecoy += sc.objects.length - hits.length;
        minAlt = Math.min(minAlt, sc.peakAltitude); maxAlt = Math.max(maxAlt, sc.peakAltitude);
    }
}

// 落海局
let splashFail = 0;
const splashPos: number[] = [];
const endKinds: Record<string, number> = { SPLASH: 0, EDGE_TIP: 0 };
for (let s = 0; s < 3000; s++) {
    const sc = buildPerformance({ roundId: `L-${s}`, multiplier: 0, landed: false });
    endKinds[sc.ending] = (endKinds[sc.ending] ?? 0) + 1;
    if (sc.frames[sc.terminalTick].y > 0.001) {
        console.error(`✗ 落海 seed${s} 終點不在水面`); splashFail++; continue;
    }
    if (sc.carrierX <= sc.frames[sc.terminalTick].x) {
        console.error(`✗ 落海 seed${s} 目的艦沒有在墜落點前方`); splashFail++;
    }
    if (decoyClearance(sc) <= PHYS.HIT_RADIUS) splashFail++;
    // 觸艦翻落局：必須真的撞到一艘船，而且目的艦不能跟它疊在一起
    if (sc.ending === 'EDGE_TIP') {
        if (sc.slideFrom < 0 || sc.wobbleFrom <= sc.slideFrom || sc.wobbleFrom >= sc.terminalTick) {
            console.error(`✗ 落海 seed${s} EDGE_TIP 的 slideFrom/wobbleFrom 不合理`); splashFail++;
        }
        const deckX = carrierDeckAt(sc.frames[Math.max(0, sc.slideFrom)].x);
        if (deckX === null) { console.error(`✗ 落海 seed${s} 觸艦點下面沒有船`); splashFail++; }
        else if (Math.abs(sc.carrierX - deckX) < SEA.HALF_W * 2) {
            console.error(`✗ 落海 seed${s} 目的艦跟被撞的船疊在一起`); splashFail++;
        }
    }
    splashPos.push(sc.frames[sc.terminalTick].x / sc.carrierX);
}

console.log('══════ 降落局 ══════');
console.log(`樣本        ${n}  (${POOL.length} 個倍數 × ${SEEDS} seed)`);
console.log(`失敗        ${fail}`);
console.log(`退回近似    ${approx}`);
console.log(`航程 tick   ${minTicks} – ${maxTicks}   平均 ${(sumTicks / n).toFixed(1)}`);
console.log(`命中物件    ${minObj} – ${maxObj}   平均 ${(sumObj / n).toFixed(1)}`);
console.log(`誘餌物件    平均 ${(sumDecoy / n).toFixed(1)} 個`);
console.log(`最高點      ${minAlt.toFixed(0)} – ${maxAlt.toFixed(0)} px（甲板 ${PHYS.DECK_Y},上方無限制）`);
console.log(`誘餌最小淨空 ${worstClearance.toFixed(1)}px  (碰撞半徑 ${PHYS.HIT_RADIUS} → 必須大於它)`);

console.log('\n══════ 落海局 ══════');
console.log(`樣本 3000   失敗 ${splashFail}`);
console.log(`結束方式    直接墜海 ${endKinds.SPLASH}  /  觸艦搖晃後翻落 ${endKinds.EDGE_TIP}` +
    `  (${(endKinds.EDGE_TIP / 3000 * 100).toFixed(1)}%)`);
const buckets = new Array(10).fill(0);
splashPos.forEach(p => buckets[Math.min(9, Math.floor(p * 10))]++);
console.log('墜海位置分佈（佔航程比例,不該全擠在最後一格）');
buckets.forEach((c, i) => {
    const bar = '█'.repeat(Math.round(c / splashPos.length * 120));
    console.log(`  ${(i / 10).toFixed(1)}–${((i + 1) / 10).toFixed(1)}  ${String(c).padStart(4)} ${bar}`);
});

// ══════════════ 2. ASCII 路徑預覽 ══════════════

function ascii(sc: PerformanceScript, rows = 24, cols = 112): string {
    const grid: string[][] = Array.from({ length: rows }, () => new Array(cols).fill(' '));
    const end = Math.max(sc.frames[sc.terminalTick].x, sc.carrierX);
    const top = Math.max(PHYS.ALT_DISPLAY_MAX, sc.peakAltitude * 1.05, ...sc.objects.map(o => o.y));
    const X = (worldX: number) => Math.min(cols - 1, Math.max(0, Math.round(worldX / end * (cols - 1))));
    const Y = (y: number) => Math.max(0, Math.min(rows - 1, rows - 1 - Math.round(y / top * (rows - 1))));

    for (let t = 0; t <= sc.terminalTick; t++) grid[Y(sc.frames[t].y)][X(sc.frames[t].x)] = '·';
    for (const o of sc.objects) {
        const ch = o.kind.kind === 'ROCKET' ? 'R' : o.kind.kind === 'BOOST' ? 'X' : '+';
        grid[Y(o.y)][X(o.tick * PHYS.PX_PER_TICK)] = o.hit ? ch : ch.toLowerCase();
    }
    grid[Y(PHYS.DECK_Y)][0] = 'A';
    grid[Y(PHYS.DECK_Y)][X(sc.carrierX)] = sc.landed ? 'B' : 'b';
    return grid.map(r => '│' + r.join('') + '│').join('\n') + '\n└' + '~'.repeat(cols) + '┘';
}

const samples: RoundResult[] = [
    { roundId: 'demo-15', multiplier: 15, landed: true },
    { roundId: 'demo-250', multiplier: 250, landed: true },
    { roundId: 'demo-05', multiplier: 0.5, landed: true },
    { roundId: 'demo-lose', multiplier: 0, landed: false },
];
for (const r of samples) {
    const sc = buildPerformance(r);
    const seq = sc.objects.filter(o => o.hit).map(o =>
        o.kind.kind === 'ROCKET' ? '÷2' : o.kind.kind === 'BOOST' ? `×${o.kind.value}` : `+${o.kind.value}`);
    console.log(`\n══════ ${r.roundId} → ${sc.landed ? '降落' : '落海'} ${sc.finalBalance}× ` +
        `(${sc.terminalTick} tick, 命中 ${seq.length}, 誘餌 ${sc.objects.filter(o => !o.hit).length}, ` +
        `最高 ${sc.peakAltitude.toFixed(0)}px, 結束 ${sc.ending}) ══════`);
    console.log(`序列: ${seq.join(' ') || '（無）'}`);
    console.log('大寫=命中 小寫=誘餌  +加值 X乘算 R火箭  A起飛艦 B目的艦');
    console.log(ascii(sc));
}

console.log(fail + splashFail === 0 ? '\n✓ 全部通過' : `\n✗ 共 ${fail + splashFail} 個問題`);
