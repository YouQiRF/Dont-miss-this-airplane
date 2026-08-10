/**
 * AviaPath.ts — 路徑合成演算法（純邏輯,不 import 任何 cc 模組,可單獨在 node 跑測試）
 *
 * 輸入：{ multiplier, landed }  ← 線上版由 server 給;離線版本地生成
 * 輸出：PerformanceScript       ← 每一 tick 的高度、每個物件的座標、每個演出節拍
 *
 * 兩條原則：
 *   1. 結果先決 —— 先有結果,再造一條「演起來剛好等於這個結果」的路徑。
 *   2. 航線是編排出來的,不是模擬出來的 —— 沒有重力、沒有速度積分。
 *      關鍵影格 + Catmull-Rom 取樣,曲線形狀完全由參數控制,不會出現物理跑飛。
 *
 * 所有可調參數都集中在下面幾個 configure* 函式,由 AviaGame 的 Inspector 餵進來。
 */

// ══════════════════════════════════════════════════════════════
//  型別
// ══════════════════════════════════════════════════════════════

export interface RoundResult {
    roundId: string;      // 同時當 seed → 重整後重播一模一樣
    multiplier: number;   // landed=false 時忽略
    landed: boolean;
}

export type ObjKind =
    | { kind: 'PICKUP'; value: number }
    | { kind: 'BOOST'; value: number }
    | { kind: 'ROCKET' };

export interface GameObject {
    id: number;
    tick: number;
    y: number;                // 世界高度（px,水面 = 0）
    kind: ObjKind;
    hit: boolean;             // true = 腳本保證命中;false = 誘餌（保證碰不到）
    nearMiss?: boolean;
    balanceAfter?: number;
}

export interface Frame { tick: number; y: number; vy: number; pitch: number; }

export type BeatType =
    | 'TAKEOFF' | 'HIT_PICKUP' | 'HIT_BOOST' | 'HIT_ROCKET'
    | 'NEAR_MISS' | 'ENDGAME_REVEAL' | 'LAND' | 'SPLASH';

export interface Beat {
    tick: number;
    type: BeatType;
    payload?: Record<string, number>;
    objId?: number;
}

/**
 * 每局隨機化的手感縮放。只影響觀感,不影響結果。
 * 注意這裡「沒有」升降幅度的縮放 —— 升降幅度是固定常數,永遠等高。
 */
export interface Style { gap: number; }

export interface PerformanceScript {
    roundId: string;
    landed: boolean;
    totalTicks: number;
    carrierTick: number;    // 目的航母位置
    terminalTick: number;   // 降落 / 落海實際發生的 tick
    frames: Frame[];
    objects: GameObject[];
    beats: Beat[];
    finalBalance: number;   // 實際派彩倍數（落海 = 0）
    peakBalance: number;    // 畫面上曾出現的最高值
    peakAltitude: number;   // 本局最高點（給鏡頭/背景做高空效果用）
    /** 允許上升的區間（起飛爬升 + 命中 +N/×N 的表演）。其餘時間航線一律下降。 */
    riseWindows: { from: number; to: number }[];
    exact: boolean;         // false = 符號組合湊不出目標倍數,已退回近似值
    style: Style;
}

// ══════════════════════════════════════════════════════════════
//  可設定區塊
// ══════════════════════════════════════════════════════════════

/** 符號表：+N 物件、×N 物件、火箭除數。全部可在 Inspector 改。 */
export interface SymbolConfig {
    pickups: number[];        // 加值物件,預設 [1, 2, 5, 10]
    boosts: number[];         // 乘算物件,預設 [2, 3, 4, 5]
    rocketDivisor: number;    // 火箭除數,預設 2
    maxRockets: number;
    maxObjects: number;
    boostChance: number;      // 分解時優先選乘算的機率。調低 → 改用加值湊 → 物件變多
    rocketChance: number;     // 分解時額外塞火箭的機率
    pickupStepTarget: number; // 期望用幾步加值湊完。調高 → 每步變小 → 物件變多
}

export const SYM: SymbolConfig = {
    pickups: [1, 2, 5, 10],
    boosts: [2, 3, 4, 5],
    rocketDivisor: 2,
    maxRockets: 6,
    maxObjects: 30,
    boostChance: 0.30,
    rocketChance: 0.22,
    pickupStepTarget: 8,
};

export function configureSymbols(p: Partial<SymbolConfig>) {
    if (p.pickups?.length) SYM.pickups = [...p.pickups].filter(v => v > 0).sort((a, b) => b - a);
    if (p.boosts?.length) SYM.boosts = [...p.boosts].filter(v => v > 1).sort((a, b) => b - a);
    if (p.rocketDivisor && p.rocketDivisor > 1) SYM.rocketDivisor = p.rocketDivisor;
    if (p.maxRockets !== undefined) SYM.maxRockets = p.maxRockets;
    if (p.maxObjects !== undefined) SYM.maxObjects = p.maxObjects;
    if (p.boostChance !== undefined) SYM.boostChance = p.boostChance;
    if (p.rocketChance !== undefined) SYM.rocketChance = p.rocketChance;
    if (p.pickupStepTarget) SYM.pickupStepTarget = Math.max(1, p.pickupStepTarget);
}

/**
 * 演出參數（單位直接用 px / tick,省掉換算層）。
 * 這裡沒有任何「物理」概念 —— 沒有重力、沒有速度、沒有終端速度。
 * 航線就是一串關鍵影格,這些數字直接決定影格放在哪。
 */
export const PHYS = {
    WATER_Y: 0,
    DECK_Y: 130,            // 航母甲板高度
    DECOY_MIN_Y: 24,        // 誘餌可放置的最低高度
    ALT_DISPLAY_MAX: 420,   // HUD 高度條的參考值（純顯示。高度本身沒有上限）
    HIT_RADIUS: 46,
    PX_PER_TICK: 40,
    PITCH_RUN: 34,          // 算俯仰角用的水平參考量,越小抬頭越誇張
    PITCH_MAX_DEG: 42,      // 俯仰角上限,避免降落段機頭插到底

    // ── 飛行規則（每一段的形狀都由這三個數字決定）──
    //   1. 平飛 = 拋物線下降,每段固定掉 GLIDE_DROP
    //   2. 只有吃到 +N / ×N 才會上升,一律抬高 STEP_UP（與數字大小、當前高度無關）
    //   3. 只有吃到火箭才會有額外下降表演,一律壓低 STEP_DOWN
    //   → 每個物件的淨變化 = ±STEP − GLIDE_DROP,全局一致
    STEP_UP: 55,            // 46 × 1.2
    STEP_DOWN: 55,          // 46 × 1.2
    GLIDE_DROP: 22,         // 每個段落拋物線下降多少 px
    RISE_TICKS: 4,          // 升／降表演持續幾 tick（其餘時間都在拋物線下降）
    TAKEOFF_STEPS: 2,       // 第一個物件放在甲板上方幾階
    MIN_ALT: 130,           // 航線最低只能降到這裡（= 甲板高度）

    // ── 段落形狀 ──
    BASE_GAP: 9,            // 物件間距（tick）。調小 → 場上物件更多更密
    GAP_JITTER: 0.35,
    MIN_GAP: 6,
    MAX_GAP: 22,
    TAKEOFF_TICKS: 10,

    // ── 收尾 ──
    LAND_RATE: 9,           // 降落段每 tick 下降 px
    LAND_TICKS_MIN: 10,
    LAND_TICKS_MAX: 34,
    SPLASH_RATE: 14,        // 墜海段每 tick 下降 px
    SPLASH_TICKS_MIN: 8,
    SPLASH_TICKS_MAX: 22,

    // ── 誘餌 ──
    DECOY_DENSITY: 0.35,    // 每個空 tick 生成誘餌的機率
    DECOY_CLEARANCE: 1.9,   // 誘餌離航線的最小淨空 = HIT_RADIUS × 這個倍數（保證碰不到）
    DECOY_NEAR_MISS: 1.45,  // 「差一點」誘餌的淨空倍數,仍然碰不到

    // ── 終點保證 ──
    //  航線一定是有限的、一定有終點：
    //   · MAX_ROUND_TICKS 是局長上限,超過會自動縮短物件間距重排
    //   · 實際採用的上限 = max(這個值, 最緊排列所需長度) → 這個上限一定達得到
    //   · 不論贏輸,終點一定存在（贏 = 降落在目的艦,輸 = 墜海,目的艦仍在前方可見）
    MAX_ROUND_TICKS: 300,
    MAX_ALT: 0,             // 高度上限。0 = 不封頂（天空無限,鏡頭會跟上去）
    TAIL_TICKS: 26,
};

export function configurePhys(p: Partial<typeof PHYS>) { Object.assign(PHYS, p); }

export const STYLE_RANGE = {
    gapMin: 0.85, gapMax: 1.20,     // 間距縮放（唯一的每局隨機項,升降幅度永遠固定）
};

export function configureStyle(p: Partial<typeof STYLE_RANGE>) { Object.assign(STYLE_RANGE, p); }

export const TICK_MS = { slow: 140, medium: 82, fast: 50, ultra: 24 };
export type Speed = keyof typeof TICK_MS;

export function configureTickMs(p: Partial<typeof TICK_MS>) { Object.assign(TICK_MS, p); }

// ══════════════════════════════════════════════════════════════
//  0. 確定性亂數（seed = roundId → 同一局永遠長一樣,可重播）
// ══════════════════════════════════════════════════════════════

function xmur3(str: string) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    return () => {
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        h ^= h >>> 16;
        return h >>> 0;
    };
}

export class Rng {
    private a: number; private b: number; private c: number; private d: number;
    constructor(seed: string) {
        const s = xmur3(seed);
        this.a = s(); this.b = s(); this.c = s(); this.d = s();
    }
    next(): number {                       // sfc32
        const t = (((this.a + this.b) | 0) + this.d) | 0;
        this.d = (this.d + 1) | 0;
        this.a = this.b ^ (this.b >>> 9);
        this.b = (this.c + (this.c << 3)) | 0;
        this.c = (this.c << 21) | (this.c >>> 11);
        this.c = (this.c + t) | 0;
        return (t >>> 0) / 4294967296;
    }
    int(n: number) { return Math.floor(this.next() * n); }
    range(lo: number, hi: number) { return lo + this.next() * (hi - lo); }
    pick<T>(a: readonly T[]): T { return a[this.int(a.length)]; }
    chance(p: number) { return this.next() < p; }
}

// ══════════════════════════════════════════════════════════════
//  1. 分解：把最終倍數拆成物件序列（反向建構）
//
//     正向  +k   ×m   ÷d(火箭)
//     逆向  -k   ÷m   ×d
//
//     關鍵性質：只有火箭能製造小數。所以 0.5× 必然含奇數顆火箭。
//     算術精確性：預設符號表下（+整數 / ×整數 / ÷2）,所有可達值都是
//     k/2^j（二進位有理數）→ double 完全精確,不需要定點數。
// ══════════════════════════════════════════════════════════════

const EPS = 1e-9;
const isInt = (v: number) => Math.abs(v - Math.round(v)) < EPS;

function pickAdd(adds: number[], t: number, rng: Rng): number {
    // 期望用 pickupStepTarget 步湊完 → 每步大約 rem / target
    const want = (t - 1) / SYM.pickupStepTarget;
    const w = adds.map(k => 1 / (1 + Math.abs(want - k)));
    const s = w.reduce((a, b) => a + b, 0);
    let r = rng.next() * s;
    for (let i = 0; i < adds.length; i++) if ((r -= w[i]) < 0) return adds[i];
    return adds[adds.length - 1];
}

export function decompose(m: number, rng: Rng, boostBias = 0): ObjKind[] {
    const D = SYM.rocketDivisor;

    let minRockets = 0;
    for (let p = m; !isInt(p); p *= D) {
        if (++minRockets > 24) throw new Error(`倍數 ${m} 在目前符號表下不可達`);
    }
    let budget = Math.min(SYM.maxRockets, Math.max(minRockets, minRockets + rng.int(3)));
    if (budget === 0 && rng.chance(0.8)) budget = 1;   // 讓 1× 的局也有戲（吃到再被打回來）

    const pBoost = Math.min(0.9, SYM.boostChance + boostBias * 0.1);
    const ops: ObjKind[] = [];
    let t = m, guard = 0;

    while (Math.abs(t - 1) > EPS || budget > 0) {
        if (++guard > 600) throw new Error('decompose stuck');

        const frac = !isInt(t);
        const atOne = Math.abs(t - 1) <= EPS;
        const canRocket = budget > 0 && t * D <= 20000;

        if (canRocket && (frac || atOne || rng.chance(SYM.rocketChance))) {
            t *= D; budget--; ops.push({ kind: 'ROCKET' }); continue;
        }
        if (frac) throw new Error('小數但沒有火箭預算');

        const divs = SYM.boosts.filter(b => isInt(t / b) && t / b >= 1 - EPS);
        if (divs.length && rng.chance(pBoost)) {
            const b = rng.pick(divs); t = Math.round(t / b);
            ops.push({ kind: 'BOOST', value: b }); continue;
        }
        const adds = SYM.pickups.filter(k => t - k >= 1 - EPS);
        if (adds.length) {
            const k = pickAdd(adds, t, rng); t -= k;
            ops.push({ kind: 'PICKUP', value: k }); continue;
        }
        if (canRocket) { t *= D; budget--; ops.push({ kind: 'ROCKET' }); continue; }
        throw new Error(`t=${t} 無可用逆運算`);
    }

    ops.reverse();          // 逆向建構完 → 反轉成正向播放順序
    return ops;
}

/** 正向重算每個物件之後的 Counter Balance,同時當作 decompose 的自我驗證 */
export function evaluate(ops: ObjKind[]): number[] {
    let t = 1; const out: number[] = [];
    for (const o of ops) {
        if (o.kind === 'PICKUP') t += o.value;
        else if (o.kind === 'BOOST') t *= o.value;
        else t /= SYM.rocketDivisor;
        out.push(t);
    }
    return out;
}

/** 湊不到精確值時的退路：貪婪逼近,並回報實際達成值 */
function approximate(m: number, rng: Rng): ObjKind[] {
    const ops: ObjKind[] = [];
    let t = 1;
    for (let i = 0; i < SYM.maxObjects; i++) {
        const cands: { op: ObjKind; v: number }[] = [];
        for (const p of SYM.pickups) cands.push({ op: { kind: 'PICKUP', value: p }, v: t + p });
        for (const b of SYM.boosts) cands.push({ op: { kind: 'BOOST', value: b }, v: t * b });
        cands.push({ op: { kind: 'ROCKET' }, v: t / SYM.rocketDivisor });

        let best = cands[0], bestD = Math.abs(cands[0].v - m);
        for (const c of cands) {
            const d = Math.abs(c.v - m) * rng.range(0.97, 1.03);
            if (d < bestD) { best = c; bestD = d; }
        }
        if (bestD >= Math.abs(t - m)) break;
        ops.push(best.op); t = best.v;
    }
    return ops;
}

function decomposeSafe(m: number, rng: Rng): { ops: ObjKind[]; exact: boolean } {
    for (let attempt = 0; attempt < 24; attempt++) {
        try {
            const ops = decompose(m, rng, attempt);
            if (ops.length === 0) { if (Math.abs(m - 1) < EPS) return { ops, exact: true }; continue; }
            const b = evaluate(ops);
            if (ops.length <= SYM.maxObjects && Math.abs(b[b.length - 1] - m) < 1e-7) {
                return { ops, exact: true };
            }
        } catch { /* 換一組亂數再試 */ }
    }
    console.warn(`[AviaPath] 符號表湊不出 ${m}×,退回近似值`);
    return { ops: approximate(m, rng), exact: false };
}

/** 落海局：沒有數值約束,自由灑一段好看的「近失」序列 */
function teaserOps(rng: Rng): ObjKind[] {
    const n = 5 + rng.int(10);
    const ops: ObjKind[] = [];
    for (let i = 0; i < n; i++) {
        const r = rng.next();
        if (r < 0.62) ops.push({ kind: 'PICKUP', value: rng.pick(SYM.pickups) });
        else if (r < 0.86) ops.push({ kind: 'BOOST', value: rng.pick(SYM.boosts) });
        else ops.push({ kind: 'ROCKET' });
    }
    // 55% 的輸局用火箭收尾 =「最後一刻被打下來」;其餘是「高度用盡緩緩沉沒」
    if (rng.chance(0.55)) ops.push({ kind: 'ROCKET' });
    return ops;
}

// ══════════════════════════════════════════════════════════════
//  2. 航線編排（沒有物理,全部是解析式段落）
//
//  飛行規則：
//    ① 平飛 = 拋物線下降。每個段落固定掉 GLIDE_DROP,曲線 y = peak − drop·s²
//       （s² 讓它由緩到急,就是拋物線的下半段）
//    ② 只有吃到 +N / ×N 才會上升,一律抬 STEP_UP,持續 RISE_TICKS
//    ③ 只有吃到火箭才會有額外下降表演,一律壓 STEP_DOWN,持續 RISE_TICKS
//    ④ 除了上面兩種表演與起飛爬升,航線任何時刻都在下降
//
//  每個物件的淨變化 = ±STEP − GLIDE_DROP,全局一致。
//  段落是逐 tick 直接算出來的,不經過樣條,所以不會有 overshoot 造成的意外上升。
// ══════════════════════════════════════════════════════════════

/** 升／降表演的幅度。所有 +N / ×N 一律 +STEP_UP,所有火箭一律 −STEP_DOWN。 */
function stepFor(op: ObjKind): number {
    return op.kind === 'ROCKET' ? -PHYS.STEP_DOWN : PHYS.STEP_UP;
}

export function rollStyle(rng: Rng): Style {
    return { gap: rng.range(STYLE_RANGE.gapMin, STYLE_RANGE.gapMax) };
}

interface FlightPlan {
    frames: Frame[];
    hits: { tick: number; y: number }[];
    terminalTick: number;
    carrierTick: number;
    peakAltitude: number;
    riseWindows: { from: number; to: number }[];   // 允許上升的區間（起飛 + 命中表演）
}

const easeOut = (s: number) => 1 - (1 - s) * (1 - s);   // 減速抵達（爬升用）
const easeIn = (s: number) => s * s;                    // 加速離開（被打下去用）

/** 高度上限。MAX_ALT = 0 表示不封頂（天空無限）。 */
function clampAlt(a: number): number {
    const lo = PHYS.MIN_ALT;
    const hi = PHYS.MAX_ALT > 0 ? Math.max(lo + PHYS.STEP_UP, PHYS.MAX_ALT) : Infinity;
    return Math.max(lo, Math.min(hi, a));
}

/**
 * 這一局在最緊排列下最短要多少 tick。
 * 用它把 MAX_ROUND_TICKS 夾成「一定做得到」的值 —— 保證航線永遠有限、永遠有終點,
 * 不論 Inspector 被調成什麼樣子。
 */
function minimumRouteTicks(ops: ObjKind[], landed: boolean): number {
    const end = landed ? PHYS.LAND_TICKS_MAX : PHYS.SPLASH_TICKS_MAX;
    return PHYS.MIN_GAP * (ops.length + 1) + PHYS.RISE_TICKS + end + 4;
}

/** 走完一整條航線,逐 tick 產出高度。回傳的最後一個 tick 就是終點。 */
function buildRoute(ops: ObjKind[], landed: boolean, rng: Rng, st: Style, gapScale: number) {
    const ys: number[] = [];
    const hits: { tick: number; y: number }[] = [];
    const riseWindows: { from: number; to: number }[] = [];
    const G = (n: number) => Math.max(PHYS.MIN_GAP, Math.min(PHYS.MAX_GAP, Math.round(n)));

    // ── 起飛：從航母甲板爬升,到頂點後開始拋物線下降,剛好落在第一個物件上 ──
    const firstY = clampAlt(PHYS.MIN_ALT + PHYS.TAKEOFF_STEPS * PHYS.STEP_UP);
    const tk0 = Math.max(PHYS.MIN_GAP, Math.round(PHYS.TAKEOFF_TICKS * st.gap * gapScale));
    const climbT = Math.max(2, Math.round(tk0 * 0.6));
    const fallT = Math.max(1, tk0 - climbT);
    const apex = firstY + PHYS.GLIDE_DROP;

    riseWindows.push({ from: 0, to: climbT });
    for (let t = 0; t < climbT; t++) {
        ys.push(PHYS.DECK_Y + (apex - PHYS.DECK_Y) * easeOut(t / climbT));
    }
    for (let t = 1; t <= fallT; t++) {
        const s = t / fallT;
        ys.push(apex - PHYS.GLIDE_DROP * s * s);
    }
    // 此時 ys.length === tk0 + 1,下一個索引就是第一個物件的 tick

    let cur = firstY;

    for (let i = 0; i < ops.length; i++) {
        const tick = ys.length;
        ys.push(cur);                       // 命中當下
        hits.push({ tick, y: cur });

        const isLast = i === ops.length - 1;
        const delta = stepFor(ops[i]);
        const peak = clampAlt(cur + delta);

        // 段落總長
        const jit = 1 + rng.range(-PHYS.GAP_JITTER, PHYS.GAP_JITTER);
        const segLen = isLast ? 0 : G(PHYS.BASE_GAP * st.gap * gapScale * jit);

        // ① 升／降表演
        const riseT = isLast
            ? PHYS.RISE_TICKS
            : Math.max(1, Math.min(PHYS.RISE_TICKS, segLen - 2));
        if (delta > 0) riseWindows.push({ from: tick, to: tick + riseT });
        for (let t = 1; t <= riseT; t++) {
            const s = t / riseT;
            ys.push(cur + (peak - cur) * (delta > 0 ? easeOut(s) : easeIn(s)));
        }

        if (isLast) { cur = peak; break; }

        // ② 拋物線下降到下一個物件
        const glideT = Math.max(1, segLen - 1 - riseT);
        const drop = Math.min(PHYS.GLIDE_DROP, Math.max(0, peak - PHYS.MIN_ALT));
        for (let t = 1; t <= glideT; t++) {
            const s = t / glideT;
            ys.push(peak - drop * s * s);
        }
        cur = peak - drop;
    }

    // ── 收尾：降落在目的艦甲板,或墜入海中 ──
    const endY = landed ? PHYS.DECK_Y : PHYS.WATER_Y;
    const rate = landed ? PHYS.LAND_RATE : PHYS.SPLASH_RATE;
    const tMin = landed ? PHYS.LAND_TICKS_MIN : PHYS.SPLASH_TICKS_MIN;
    const tMax = landed ? PHYS.LAND_TICKS_MAX : PHYS.SPLASH_TICKS_MAX;
    const fall = Math.max(0, cur - endY);
    const endT = Math.max(tMin, Math.min(tMax, Math.round(fall / Math.max(1, rate))));

    for (let t = 1; t <= endT; t++) {
        const s = t / endT;
        // 降落：由緩到急再拉平（smoothstep）。墜海：拋物線加速砸下去。
        const k = landed ? s * s * (3 - 2 * s) : s * s;
        ys.push(cur - fall * k);
    }

    return { ys, hits, riseWindows, terminalTick: ys.length - 1 };
}

function planFlight(ops: ObjKind[], landed: boolean, rng: Rng, st: Style): FlightPlan {
    // 局長上限：取設定值與「最緊排列所需長度」兩者較大者 → 這個上限一定達得到
    const cap = Math.max(PHYS.MAX_ROUND_TICKS, minimumRouteTicks(ops, landed));

    let gapScale = 1;
    let R = buildRoute(ops, landed, rng, st, gapScale);
    for (let i = 0; i < 8 && R.terminalTick > cap; i++) {
        gapScale *= (cap / R.terminalTick) * 0.96;
        R = buildRoute(ops, landed, rng, st, gapScale);
    }

    const { ys, hits, riseWindows, terminalTick } = R;
    const maxPitch = PHYS.PITCH_MAX_DEG * Math.PI / 180;
    const frames: Frame[] = [];
    let peak = 0;
    for (let t = 0; t <= terminalTick; t++) {
        const y = ys[t];
        peak = Math.max(peak, y);
        const dy = (ys[Math.min(t + 1, terminalTick)] - ys[Math.max(t - 1, 0)]) / 2;
        const pitch = Math.max(-maxPitch, Math.min(maxPitch, Math.atan2(dy, PHYS.PITCH_RUN)));
        frames.push({ tick: t, y, vy: dy, pitch });
    }

    // 航母位置：贏 = 降落點;輸 = 墜海點再往前一段（看得到、到不了）
    const carrierTick = landed
        ? terminalTick
        : terminalTick + (rng.chance(0.7) ? 6 + rng.int(11) : 24 + rng.int(28));

    return { frames, hits, terminalTick, carrierTick, peakAltitude: peak, riseWindows };
}

// ══════════════════════════════════════════════════════════════
//  3. 誘餌物件
//
//  場上散佈一堆「無關緊要」的加減數字。它們不參與任何運算,
//  而且用幾何淨空硬性保證：飛機絕對碰不到。
//
//  為什麼需要：如果場上每一個物件都被吃到,玩家三局就會發現路徑是假的。
// ══════════════════════════════════════════════════════════════

function randomDecoyKind(rng: Rng): ObjKind {
    const r = rng.next();
    if (r < 0.52) return { kind: 'PICKUP', value: rng.pick(SYM.pickups) };
    if (r < 0.78) return { kind: 'BOOST', value: rng.pick(SYM.boosts) };
    return { kind: 'ROCKET' };     // 閃過的火箭爽度最高
}

function scatterDecoys(plan: FlightPlan, landed: boolean, rng: Rng, startId: number): GameObject[] {
    const out: GameObject[] = [];
    const yAt = (t: number) =>
        plan.frames[Math.max(0, Math.min(plan.frames.length - 1, t))].y;

    // 物件在水平方向也有體積 → 淨空要檢查整個佔位寬度,不能只看單一 tick
    const span = Math.ceil(PHYS.HIT_RADIUS / PHYS.PX_PER_TICK) + 1;
    const clearance = (t: number, y: number) => {
        let min = Infinity;
        for (let k = -span; k <= span; k++) min = Math.min(min, Math.abs(y - yAt(t + k)));
        return min;
    };
    const hardMin = PHYS.HIT_RADIUS * PHYS.DECOY_CLEARANCE;
    const nearMin = PHYS.HIT_RADIUS * PHYS.DECOY_NEAR_MISS;

    let id = startId;
    const end = plan.terminalTick;

    for (let t = 3; t < end - 2; t++) {
        if (plan.hits.some(h => Math.abs(h.tick - t) < 3)) continue;
        if (!rng.chance(PHYS.DECOY_DENSITY)) continue;

        const wantNear = rng.chance(0.25);
        const min = wantNear ? nearMin : hardMin;
        const up = rng.chance(0.58);

        // 在航線上/下方找一個滿足淨空的位置,試幾次不行就跳過
        let placed = false;
        for (let attempt = 0; attempt < 4 && !placed; attempt++) {
            const d = min + PHYS.HIT_RADIUS * rng.range(0.05, wantNear ? 0.25 : 2.2);
            const y = yAt(t) + (up ? d : -d);
            if (y < PHYS.DECOY_MIN_Y) continue;
            if (clearance(t, y) <= min) continue;        // 淨空不足 → 換一個距離
            out.push({
                id: id++, tick: t, y, kind: randomDecoyKind(rng),
                hit: false, nearMiss: wantNear,
            });
            placed = true;
        }
    }

    // 落海局：墜海前塞一顆高價誘餌 →「就差那一點」
    if (!landed && end > 12) {
        const t = end - (4 + rng.int(5));
        const y = yAt(t) + nearMin + PHYS.HIT_RADIUS * 0.2;
        if (clearance(t, y) > nearMin) {
            out.push({
                id: id++, tick: t, y,
                kind: { kind: 'BOOST', value: SYM.boosts[rng.int(Math.max(1, SYM.boosts.length - 1))] },
                hit: false, nearMiss: true,
            });
        }
    }
    return out;
}

// ══════════════════════════════════════════════════════════════
//  4. 組裝
// ══════════════════════════════════════════════════════════════

export function buildPerformance(result: RoundResult): PerformanceScript {
    const rng = new Rng(result.roundId);
    const style = rollStyle(rng);

    let ops: ObjKind[], exact = true;
    if (result.landed) { const r = decomposeSafe(result.multiplier, rng); ops = r.ops; exact = r.exact; }
    else ops = teaserOps(rng);

    const balances = evaluate(ops);
    const plan = planFlight(ops, result.landed, rng, style);

    const objects: GameObject[] = plan.hits.map((h, i) => ({
        id: i, tick: h.tick, y: h.y, kind: ops[i], hit: true, balanceAfter: balances[i],
    }));
    objects.push(...scatterDecoys(plan, result.landed, rng, 1000));
    objects.sort((a, b) => a.tick - b.tick);

    const beats: Beat[] = [{ tick: 0, type: 'TAKEOFF' }];
    for (const o of objects) {
        if (o.hit) {
            beats.push({
                tick: o.tick,
                type: o.kind.kind === 'ROCKET' ? 'HIT_ROCKET'
                    : o.kind.kind === 'BOOST' ? 'HIT_BOOST' : 'HIT_PICKUP',
                payload: {
                    balance: o.balanceAfter!,
                    value: o.kind.kind === 'ROCKET' ? SYM.rocketDivisor : o.kind.value,
                },
                objId: o.id,
            });
        } else if (o.nearMiss) {
            beats.push({ tick: o.tick, type: 'NEAR_MISS', objId: o.id });
        }
    }
    beats.push({ tick: Math.max(1, plan.carrierTick - 16), type: 'ENDGAME_REVEAL' });
    beats.push({ tick: plan.terminalTick, type: result.landed ? 'LAND' : 'SPLASH' });
    beats.sort((a, b) => a.tick - b.tick);

    const achieved = balances.length ? balances[balances.length - 1] : 1;

    return {
        roundId: result.roundId,
        landed: result.landed,
        totalTicks: Math.max(plan.carrierTick, plan.terminalTick) + PHYS.TAIL_TICKS,
        carrierTick: plan.carrierTick,
        terminalTick: plan.terminalTick,
        frames: plan.frames,
        objects,
        beats,
        finalBalance: result.landed ? achieved : 0,
        peakBalance: balances.length ? Math.max(...balances) : 1,
        peakAltitude: plan.peakAltitude,
        riseWindows: plan.riseWindows,
        exact,
        style,
    };
}

/** 連續時間取樣（60fps 渲染用,tick 是小數） */
export function sampleFrame(script: PerformanceScript, t: number): Frame {
    const f = script.frames;
    const i = Math.max(0, Math.min(Math.floor(t), f.length - 1));
    const j = Math.min(i + 1, f.length - 1);
    const a = t - i;
    return {
        tick: t,
        y: f[i].y + (f[j].y - f[i].y) * a,
        vy: f[i].vy + (f[j].vy - f[i].vy) * a,
        pitch: f[i].pitch + (f[j].pitch - f[i].pitch) * a,
    };
}

// ══════════════════════════════════════════════════════════════
//  5. 離線結果產生器
//     線上版把這整段換成一次 HTTP request 即可,其餘程式碼一行都不用改。
// ══════════════════════════════════════════════════════════════

export const OFFLINE = {
    winChance: 0.5,
    biasPower: 2.1,                 // 越大越偏小倍數
    pool: [0.25, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10, 12, 15, 20, 25, 40, 60, 80, 120, 250],
};

export function configureOffline(p: Partial<typeof OFFLINE>) { Object.assign(OFFLINE, p); }

let offlineSeq = 0;
export function offlineResult(): RoundResult {
    const rng = new Rng(`offline-${offlineSeq++}-${Date.now()}-${Math.random()}`);
    const landed = rng.chance(OFFLINE.winChance);
    const idx = Math.min(OFFLINE.pool.length - 1,
        Math.floor(Math.pow(rng.next(), OFFLINE.biasPower) * OFFLINE.pool.length));
    return {
        roundId: `r${offlineSeq}-${rng.int(1e9)}`,
        multiplier: landed ? OFFLINE.pool[idx] : 0,
        landed,
    };
}
