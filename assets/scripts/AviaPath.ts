/**
 * AviaPath.ts — 路徑合成演算法（純邏輯,不 import 任何 cc 模組,可單獨在 node 跑測試）
 *
 * 輸入：{ multiplier, landed }  ← 線上版由 server 給;離線版本地生成
 * 輸出：PerformanceScript       ← 每一 tick 的高度、每個物件的座標、每個演出節拍
 *
 * 兩條原則：
 *   1. 結果先決 —— 先有結果,再造一條「演起來剛好等於這個結果」的路徑。
 *   2. 航線是編排出來的,不是模擬出來的 —— 沒有重力、沒有速度積分。
 *      每段是一條解析式的彈道拋物線,形狀完全由參數控制,不會出現物理跑飛。
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

/** x 是世界座標（px）。收尾段飛機會滑行減速然後停下,所以 x 不再等於 tick × PX_PER_TICK。 */
export interface Frame { tick: number; x: number; y: number; vy: number; pitch: number; }

export type BeatType =
    | 'TAKEOFF' | 'HIT_PICKUP' | 'HIT_BOOST' | 'HIT_ROCKET'
    | 'NEAR_MISS' | 'ENDGAME_REVEAL' | 'LAND' | 'SPLASH'
    | 'DECK_TOUCH' | 'DECK_WOBBLE';

/**
 * 結束方式。
 *
 * 觸艦之後的表演兩種結果完全共用：滑行一段距離 → 半截機身懸在甲板外 → 搖晃傾斜。
 * 玩家在搖晃結束前不知道會是哪一種 —— 這是整局張力的最後一個高點。
 *
 *   DECK_LAND  乾淨停在甲板上,不懸空、不搖晃 → 降落成功
 *   EDGE_HOLD  衝到邊緣半截懸空,搖晃後穩住 → 降落成功
 *   EDGE_TIP   搖晃後前傾,翻落海中     → 降落失敗
 *   SPLASH     根本沒碰到船,直接砸進海裡 → 失敗
 */
export type EndingKind = 'DECK_LAND' | 'EDGE_HOLD' | 'EDGE_TIP' | 'SPLASH';

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
    carrierX: number;       // 目的航母中心的世界座標（px）
    terminalTick: number;   // 降落 / 落海實際發生的 tick
    frames: Frame[];
    objects: GameObject[];
    beats: Beat[];
    finalBalance: number;   // 實際派彩倍數（落海 = 0）
    peakBalance: number;    // 畫面上曾出現的最高值
    peakAltitude: number;   // 本局最高點（給鏡頭/背景做高空效果用）
    ending: EndingKind;
    /** 觸艦的那一 tick（渲染層用來播火花／煞車煙）。SPLASH 時為 -1 */
    slideFrom: number;
    /** 開始搖晃的那一 tick。SPLASH 時為 -1 */
    wobbleFrom: number;
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
    STEP_UP: 82,            // 吃到 +N / ×N 時,弧線頂點比命中點高多少（55 × 1.5）
    STEP_DOWN: 82,          // 吃到飛彈時往下砸多少（55 × 1.5）
    GLIDE_DROP: 30,         // 每段拋物線從頂點再往下掉多少（決定弧線後半的落差）
    /**
     * 弧線頂點位置偏移。1 = 幾何上正確的彈道頂點（由 STEP_UP 與 GLIDE_DROP 的比例算出）,
     * 調小 → 頂點提前、上升更急促;調大 → 頂點延後、爬升更悠長。
     */
    ARC_APEX_BIAS: 1,
    ROCKET_DIVE_FRAC: 0.45, // 飛彈命中後,前 45% 的段落用來俯衝,其餘滑降
    LAST_ARC_TICKS: 7,      // 最後一個物件的升／降表演長度（之後就交給收尾段）
    TAKEOFF_STEPS: 2,       // 第一個物件放在甲板上方幾階
    MIN_ALT: 130,           // 航線最低只能降到這裡（= 甲板高度）

    // ── 段落形狀 ──
    BASE_GAP: 9,            // 物件間距（tick）。調小 → 場上物件更多更密
    GAP_JITTER: 0.35,
    MIN_GAP: 6,
    MAX_GAP: 22,
    TAKEOFF_TICKS: 10,

    // ── 甲板降落表演 ──
    //   觸艦 → 減速滑行 → 半截機身懸在甲板外 → 搖晃 → 穩住 or 前傾翻落
    SLIDE_DECEL_TICKS: 11,  // 滑行減速持續幾 tick
    EDGE_OVERHANG: 0,       // 停下時機身中心相對甲板尾端的位移。0 = 剛好半截在外
    MIN_SLIDE_ROOM: 90,     // 觸艦點離甲板尾端至少要有這麼多 px,否則當作沒撞到
    // 搖晃 = 機身以甲板邊緣為支點往前傾,再回到水平,重複 WOBBLE_CYCLES 次。
    // 只會往前傾（機首朝下）—— 往後最多就是水平,不會機首朝上。
    // 不是高頻抖動 —— 慢慢晃兩下就好,那個停頓才是張力所在。
    WOBBLE_TICKS: 34,       // 搖晃總長度。這個值決定快慢：越大越慢
    WOBBLE_AMP_DEG: 19,     // 前傾的最大角度（回來最多到 0,不會變正）
    WOBBLE_CYCLES: 2,       // 晃幾下（一下 = 前傾下去 + 回到水平）
    WOBBLE_SINK: 5,         // 搖晃時機身中心的上下位移。0 = 完全只有轉動,不上下浮
    GLIDE_TO_DECK_MAX: 70,  // 為了湊 EDGE_TIP,最多可以往前滑幾 tick 去找船
    DECK_STOP_MIN: 0.35,    // 乾淨降落時停在甲板寬度的哪個比例（0 = 近端邊緣）
    DECK_STOP_MAX: 0.70,
    SETTLE_TICKS: 12,       // 穩住收斂
    HOLD_PITCH_DEG: -9,     // 穩住後停在邊緣的微傾角
    TIP_TICKS: 13,          // 前傾翻落
    TIP_PITCH_DEG: -78,

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

/**
 * 海面上的航母佈局。
 *
 * 位置是確定性的 —— 演算法與渲染共用這幾個函式,所以兩邊看到的船一定在同一個地方。
 * 這很重要：「該落海卻剛好停在航母上」這條規則要成立,演算法必須知道船在哪。
 */
export const SEA = {
    SPACING: 1500,   // 船距（px）。0 = 海面上沒有佈景船
    HALF_W: 152,     // 甲板半寬
    JITTER: 0.25,    // 位置抖動比例
};

export function configureSea(p: Partial<typeof SEA>) { Object.assign(SEA, p); }

/** 由整數種子產生穩定的 0..1 */
export function hash01(n: number) {
    let h = Math.imul(n ^ 0x9e3779b9, 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 第 i 艘佈景船的中心 x */
export function seaCarrierX(i: number): number {
    return i * SEA.SPACING + (hash01(i * 2654435761) - 0.5) * SEA.SPACING * SEA.JITTER;
}

/** 這個 x 底下有沒有甲板？有就回傳船的中心 x,沒有回 null。起飛艦（x≈0）不算。 */
export function carrierDeckAt(x: number): number | null {
    if (SEA.SPACING <= 0) return null;
    const i = Math.round(x / SEA.SPACING);
    for (let k = i - 1; k <= i + 1; k++) {
        const cx = seaCarrierX(k);
        if (Math.abs(cx) < SEA.HALF_W * 2) continue;     // 起飛艦的位置不放佈景船
        if (Math.abs(x - cx) <= SEA.HALF_W) return cx;
    }
    return null;
}

/**
 * 結算動畫的出現權重。相對值,**0 = 永遠不出現**。
 *
 * ⚠ 預設只剩兩種結局：**碰到甲板就是成功,沒碰到就是落海**。
 *   兩個「搖晃」結局（EDGE_HOLD / EDGE_TIP）預設關掉 ——
 *   「差點掉出去」那段懸念拿掉了,降落改成單純的滑行減速停在甲板上。
 *   要把懸念加回來就把對應的權重調成非 0（Inspector ⑧ 結算動畫權重),程式都還在。
 *
 * 贏局在 DECK_LAND / EDGE_HOLD 之間抽;輸局在 SPLASH / EDGE_TIP 之間抽。
 * 演算法會為了達成抽到的結局去「安排幾何」（例如把下降段拉長到剛好落在某艘船的甲板上）,
 * 而不是反過來讓幾何決定結局 —— 所以這幾個權重是真的說了算。
 *
 * 唯一的例外：EDGE_TIP 需要前方在合理距離內有船。如果 SEA.SPACING 設得很大或設成 0,
 * 找不到船時會退回 SPLASH。
 */
export const ENDING_WEIGHTS = {
    winDeckLand: 1,   // 乾淨停在甲板上
    winEdgeHold: 0,   // 衝到邊緣半截懸空,搖晃後穩住
    loseSplash: 1,    // 直接砸進海裡
    loseEdgeTip: 0,   // 觸艦、搖晃,最後前傾翻落
};

export function configureEndingWeights(p: Partial<typeof ENDING_WEIGHTS>) {
    Object.assign(ENDING_WEIGHTS, p);
}

/** 二選一的權重抽選。回傳 true 表示選中第一項。兩個都 0 時視為各半。 */
function pickByWeight(rng: Rng, a: number, b: number): boolean {
    const wa = Math.max(0, a), wb = Math.max(0, b);
    if (wa + wb <= 0) return rng.chance(0.5);
    return rng.next() * (wa + wb) < wa;
}

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
    carrierX: number;
    peakAltitude: number;
    riseWindows: { from: number; to: number }[];   // 允許上升的區間（起飛 + 命中表演）
    ending: EndingKind;
    slideFrom: number;
    wobbleFrom: number;
}

const easeOutCubic = (s: number) => 1 - Math.pow(1 - s, 3);

/**
 * 一段完整的彈道拋物線。
 *
 *   y(s) = apex − k·(s − p)²
 *
 * 頂點高度固定是 y0 + rise,段尾固定落在 y0 + rise − fall。
 * 頂點位置 p 由 rise 與 fall 的比例解出來：
 *
 *   k·p²     = rise      （從起點爬到頂點）
 *   k·(1−p)² = fall      （從頂點掉到段尾）
 *   ⇒ (1−p)/p = √(fall/rise)  ⇒  p = 1/(1 + √(fall/rise))
 *
 * 所以弧線兩側的曲率自動一致 —— 這就是「看起來像真的被拋出去」的關鍵。
 * 上一版是「4 tick 快速彈起 + 另一條拋物線」,接縫處有個平頂,弧度不連續。
 */
function arcSegment(y0: number, rise: number, fall: number, n: number, out: number[]) {
    const apex = y0 + rise;
    if (rise <= 0.01) {                       // 沒有上升 → 退化成單純的拋物線下降
        for (let t = 1; t <= n; t++) { const s = t / n; out.push(y0 - fall * s * s); }
        return apex;
    }
    const r = Math.sqrt(Math.max(0, fall) / rise);
    const p = clamp01(1 / (1 + r) * PHYS.ARC_APEX_BIAS, 0.12, 0.88);
    const k = rise / (p * p);
    for (let t = 1; t <= n; t++) {
        const s = t / n;
        out.push(apex - k * (s - p) * (s - p));
    }
    // p 被 clamp（或 ARC_APEX_BIAS ≠ 1）時終點會有微小誤差 → 直接釘死,
    // 保證「每個物件的淨變化 = STEP_UP − GLIDE_DROP」這條契約不會鬆掉
    out[out.length - 1] = apex - fall;
    return p;
}

/**
 * 飛彈段落：單調下降,不可能有上升。
 * 前段快速俯衝（撞擊感）,後段接回拋物線滑降,兩者相加仍然單調。
 */
function diveSegment(y0: number, total: number, n: number, out: number[]) {
    const f = PHYS.ROCKET_DIVE_FRAC;
    for (let t = 1; t <= n; t++) {
        const s = t / n;
        const hit = easeOutCubic(Math.min(1, s / f));   // 撞擊：快進慢出
        const glide = s * s;                            // 滑降：拋物線
        out.push(y0 - total * (0.7 * hit + 0.3 * glide));
    }
}

function clamp01(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function clampInt(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, Math.round(v))); }

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
    return PHYS.MIN_GAP * (ops.length + 1) + PHYS.LAST_ARC_TICKS + end + 4;
}

/** 走完一整條航線,逐 tick 產出高度。回傳的最後一個 tick 就是終點。 */
function buildRoute(ops: ObjKind[], landed: boolean, rng: Rng, st: Style, gapScale: number) {
    const ys: number[] = [];
    const hits: { tick: number; y: number }[] = [];
    const riseWindows: { from: number; to: number }[] = [];
    const G = (n: number) => Math.max(PHYS.MIN_GAP, Math.min(PHYS.MAX_GAP, Math.round(n)));

    // ── 起飛：從航母甲板拋出去,弧線頂點過後開始下降,剛好落在第一個物件上 ──
    const firstY = clampAlt(PHYS.MIN_ALT + PHYS.TAKEOFF_STEPS * PHYS.STEP_UP);
    const tk0 = Math.max(PHYS.MIN_GAP, Math.round(PHYS.TAKEOFF_TICKS * st.gap * gapScale));
    ys.push(PHYS.DECK_Y);
    const p0 = arcSegment(PHYS.DECK_Y, firstY + PHYS.GLIDE_DROP - PHYS.DECK_Y,
        PHYS.GLIDE_DROP, tk0, ys);
    riseWindows.push({ from: 0, to: Math.ceil(p0 * tk0) + 1 });

    let cur = firstY;

    for (let i = 0; i < ops.length; i++) {
        const tick = ys.length;
        ys.push(cur);                       // 命中當下
        hits.push({ tick, y: cur });

        const isLast = i === ops.length - 1;
        const jit = 1 + rng.range(-PHYS.GAP_JITTER, PHYS.GAP_JITTER);
        const segLen = isLast ? 0 : G(PHYS.BASE_GAP * st.gap * gapScale * jit);
        const tailLen = Math.max(3, Math.round(PHYS.LAST_ARC_TICKS * st.gap * gapScale));

        if (ops[i].kind === 'ROCKET') {
            const bottom = Math.max(PHYS.MIN_ALT, cur - PHYS.STEP_DOWN);
            if (isLast) {
                diveSegment(cur, cur - bottom, tailLen, ys);
                cur = ys[ys.length - 1];
                break;
            }
            const endY = Math.max(PHYS.MIN_ALT, bottom - PHYS.GLIDE_DROP);
            diveSegment(cur, cur - endY, segLen, ys);
            cur = ys[ys.length - 1];
        } else {
            const apexY = clampAlt(cur + PHYS.STEP_UP);
            const rise = apexY - cur;
            if (isLast) {
                arcSegment(cur, rise, 0, tailLen, ys);
                riseWindows.push({ from: tick, to: tick + tailLen + 1 });
                cur = ys[ys.length - 1];
                break;
            }
            const fall = Math.min(PHYS.GLIDE_DROP, Math.max(0, apexY - PHYS.MIN_ALT));
            const p = arcSegment(cur, rise, fall, segLen, ys);
            riseWindows.push({ from: tick, to: tick + Math.ceil(p * segLen) + 1 });
            cur = ys[ys.length - 1];
        }
    }

    // 飛行段的 x 就是等速前進;收尾段會自己接手（滑行要減速、停下）
    const xs: number[] = ys.map((_, i) => i * PHYS.PX_PER_TICK);
    const ps: (number | null)[] = ys.map(() => null);

    const end = appendEnding(xs, ys, ps, cur, landed, rng);

    return {
        xs, ys, ps, hits, riseWindows,
        terminalTick: ys.length - 1,
        ending: end.ending, slideFrom: end.slideFrom,
        wobbleFrom: end.wobbleFrom, carrierX: end.carrierX,
    };
}

/**
 * 收尾表演：觸艦 → 減速滑行 → 半截機身懸在甲板外 → 搖晃 → 穩住 or 前傾翻落。
 *
 * 這一段飛機會「停下來」,所以 x 不能再等於 tick × PX_PER_TICK ——
 * 整條航線改成明確的 (x, y, pitch) 三軌,滑行段 x 減速收斂到甲板尾端後就不動了。
 *
 * 兩種結果共用完全一樣的前半段,玩家在搖晃結束前不知道會是哪一種。
 */
function appendEnding(
    xs: number[], ys: number[], ps: (number | null)[],
    cur: number, landed: boolean, rng: Rng,
): { ending: EndingKind; slideFrom: number; wobbleFrom: number; carrierX: number } {

    const PX = PHYS.PX_PER_TICK;
    const D2R = Math.PI / 180;
    const W = ENDING_WEIGHTS;
    const push = (x: number, y: number, pitch: number | null) => { xs.push(x); ys.push(y); ps.push(pitch); };
    const lastX = () => xs[xs.length - 1];

    /**
     * 觸艦 → 減速滑行到指定的 x 停下。機身保持水平。
     * tick 數依滑行距離等比縮放,所以停在甲板中央和衝到尾端的「減速感」是一致的。
     */
    const slideTo = (target: number, fullDist: number) => {
        const from = lastX();
        const dist = Math.max(PX, target - from);
        const ratio = Math.max(0.25, Math.min(1, dist / Math.max(1, fullDist)));
        const slideT = Math.max(4, Math.round(PHYS.SLIDE_DECEL_TICKS * (0.35 + 0.65 * ratio)));

        const slideFrom = xs.length - 1;
        for (let k = 1; k <= slideT; k++) {
            const s = k / slideT;
            // easeOutCubic：一觸艦就衝,然後明顯減速,最後幾 tick 幾乎不動
            const x = from + dist * (1 - Math.pow(1 - s, 3));
            const bounce = Math.max(0, 5 - k) * 1.6;      // 觸艦瞬間的彈跳
            push(x, PHYS.DECK_Y + bounce, 0);
        }
        return slideFrom;
    };

    /** 滑到甲板尾端（機身中心停在邊緣 = 半截在外）→ 搖晃 */
    const slideAndWobble = (deckCx: number) => {
        const target = deckCx + SEA.HALF_W + PHYS.EDGE_OVERHANG;
        const slideFrom = slideTo(target, SEA.HALF_W * 2);

        // 搖晃：機身中心已經懸在邊緣,前後傾斜,看起來隨時會掉下去
        const wobbleFrom = xs.length - 1;
        const wT = Math.max(6, Math.round(PHYS.WOBBLE_TICKS));
        const amp = PHYS.WOBBLE_AMP_DEG * D2R;
        for (let k = 1; k <= wT; k++) {
            const s = k / wT;
            const decay = 1 - s * 0.55;                              // 慢慢收斂,但沒有完全停
            // (1−cos)/2 永遠落在 0..1 → 傾角永遠 ≤ 0,只會前傾,回來最多回到水平。
            // 一個完整週期 = 「前傾下去再回到水平」= 晃一下。
            const w = (1 - Math.cos(Math.PI * 2 * PHYS.WOBBLE_CYCLES * s)) / 2;
            const pitch = -amp * decay * w;
            const sink = PHYS.WOBBLE_SINK * Math.abs(pitch) / Math.max(1e-6, amp);
            push(target, PHYS.DECK_Y - sink, pitch);
        }
        return { slideFrom, wobbleFrom, target };
    };

    if (landed) {
        // ── 降落成功：下降到甲板 → 滑行 → 搖晃 → 穩住在邊緣 ──
        const fall = Math.max(0, cur - PHYS.DECK_Y);
        const endT = clampInt(fall / Math.max(1, PHYS.LAND_RATE), PHYS.LAND_TICKS_MIN, PHYS.LAND_TICKS_MAX);
        for (let t = 1; t <= endT; t++) {
            const s = t / endT;
            push(lastX() + PX, cur - fall * (s * s * (3 - 2 * s)), null);
        }

        // 目的艦擺在「觸艦點剛好是近端邊緣」的位置
        const carrierX = lastX() + SEA.HALF_W;

        // ── 乾淨降落：滑到甲板中段就停住,不懸空、不搖晃 ──
        if (!pickByWeight(rng, W.winEdgeHold, W.winDeckLand)) {
            const frac = rng.range(PHYS.DECK_STOP_MIN, PHYS.DECK_STOP_MAX);
            const target = carrierX - SEA.HALF_W + frac * SEA.HALF_W * 2;
            const slideFrom = slideTo(target, SEA.HALF_W * 2);
            // 停穩：機身放平
            const setT = Math.max(3, Math.round(PHYS.SETTLE_TICKS * 0.5));
            for (let k = 1; k <= setT; k++) push(target, PHYS.DECK_Y, 0);
            return { ending: 'DECK_LAND', slideFrom, wobbleFrom: -1, carrierX };
        }

        const { slideFrom, wobbleFrom } = slideAndWobble(carrierX);

        // 穩住：傾角收斂到一個小角度,停在邊緣不動
        const setT = Math.max(4, PHYS.SETTLE_TICKS);
        const hold = PHYS.HOLD_PITCH_DEG * D2R;
        const fromPitch = ps[ps.length - 1] as number;
        for (let k = 1; k <= setT; k++) {
            const s = k / setT;
            const e = 1 - Math.pow(1 - s, 3);
            push(lastX(), PHYS.DECK_Y, fromPitch + (hold - fromPitch) * e);
        }
        return { ending: 'EDGE_HOLD', slideFrom, wobbleFrom, carrierX };
    }

    // ── 落海 ──
    //
    // 先用權重決定「想要哪一種結局」,再把幾何排成那樣 —— 而不是讓幾何決定結局。
    // 這樣兩種墜落表演的出現率才真的可以用 Inspector 的權重控制。
    const wantTip = pickByWeight(rng, W.loseEdgeTip, W.loseSplash);

    let deckCx: number | null = null;
    if (wantTip) {
        // 往前找第一艘「還有足夠滑行空間」的船,把下降段拉到剛好在它甲板上觸艦
        const x0 = lastX();
        const reach = SEA.SPACING * 2 + SEA.HALF_W * 4;
        for (let probe = x0 + PX; probe < x0 + reach; probe += PX * 0.5) {
            const c = carrierDeckAt(probe);
            if (c === null) continue;
            const touch = Math.max(probe, c - SEA.HALF_W + 4);
            if (c + SEA.HALF_W - touch <= PHYS.MIN_SLIDE_ROOM) continue;   // 沒有滑行空間
            const n = Math.round((touch - x0) / PX);
            if (n < PHYS.SPLASH_TICKS_MIN) continue;                       // 太近,來不及下降
            if (n > PHYS.GLIDE_TO_DECK_MAX) break;                         // 太遠,滑太久不好看
            deckCx = c;
            for (let k = 1; k <= n; k++) {
                const t = k / n;
                push(x0 + k * PX, cur - (cur - PHYS.DECK_Y) * (t * t * (3 - 2 * t)), null);
            }
            break;
        }
    }

    if (deckCx === null) {
        // 直接砸海。落點要避開所有甲板,否則飛機會穿過船身。
        const fall0 = Math.max(0, cur - PHYS.WATER_Y);
        const x0 = lastX();
        const clear = (n: number) => {
            for (let k = 1; k <= n; k++) {
                const y = cur - fall0 * (k / n) * (k / n);
                if (y <= PHYS.DECK_Y && carrierDeckAt(x0 + k * PX) !== null) return false;
            }
            return true;
        };
        const base = clampInt(fall0 / Math.max(1, PHYS.SPLASH_RATE),
            PHYS.SPLASH_TICKS_MIN, PHYS.SPLASH_TICKS_MAX);
        let endT = base;
        for (let d = 0; d <= PHYS.SPLASH_TICKS_MAX; d++) {          // 由近而遠找一個不會穿船的長度
            const a = base - d, b = base + d;
            if (a >= PHYS.SPLASH_TICKS_MIN && clear(a)) { endT = a; break; }
            if (b <= PHYS.SPLASH_TICKS_MAX * 2 && clear(b)) { endT = b; break; }
        }
        for (let k = 1; k <= endT; k++) {
            const t = k / endT;
            push(x0 + k * PX, cur - fall0 * t * t, null);           // 拋物線加速砸下去
        }
        ys[ys.length - 1] = PHYS.WATER_Y;
        const carrierX = lastX() +
            (rng.chance(0.7) ? rng.range(240, 680) : rng.range(960, 2100));
        return { ending: 'SPLASH', slideFrom: -1, wobbleFrom: -1, carrierX };
    }

    {
        // 該墜海卻剛好停在航母上 → 滑行、搖晃,最後前傾翻落
        const { slideFrom, wobbleFrom } = slideAndWobble(deckCx);

        const tipT = Math.max(6, PHYS.TIP_TICKS);
        const tip = PHYS.TIP_PITCH_DEG * Math.PI / 180;
        const fromPitch = ps[ps.length - 1] as number;
        const fromY = ys[ys.length - 1];
        for (let k = 1; k <= tipT; k++) {
            const s = k / tipT;
            // 機首先沉下去,然後整架翻落水面
            push(lastX() + PX * 0.35 * s,
                fromY * (1 - s * s),
                fromPitch + (tip - fromPitch) * (s * s));
        }
        ys[ys.length - 1] = PHYS.WATER_Y;

        // 目的艦擺得離這艘船夠遠,免得兩艘疊在一起
        const carrierX = deckCx + SEA.HALF_W * 2 + 120 +
            (rng.chance(0.7) ? rng.range(80, 520) : rng.range(900, 2000));
        return { ending: 'EDGE_TIP', slideFrom, wobbleFrom, carrierX };
    }
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

    const { xs, ys, ps, hits, riseWindows, terminalTick } = R;
    const maxPitch = PHYS.PITCH_MAX_DEG * Math.PI / 180;
    const frames: Frame[] = [];
    let peak = 0;
    for (let t = 0; t <= terminalTick; t++) {
        const y = ys[t];
        peak = Math.max(peak, y);
        const dy = (ys[Math.min(t + 1, terminalTick)] - ys[Math.max(t - 1, 0)]) / 2;
        // 收尾段（滑行／搖晃／翻落）用腳本指定的傾角,其餘由曲線斜率導出
        const pitch = ps[t] !== null ? ps[t]!
            : Math.max(-maxPitch, Math.min(maxPitch, Math.atan2(dy, PHYS.PITCH_RUN)));
        frames.push({ tick: t, x: xs[t], y, vy: dy, pitch });
    }

    return {
        frames, hits, terminalTick,
        carrierX: R.carrierX,
        peakAltitude: peak, riseWindows,
        ending: R.ending, slideFrom: R.slideFrom, wobbleFrom: R.wobbleFrom,
    };
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
    beats.push({ tick: Math.max(1, plan.terminalTick - 24), type: 'ENDGAME_REVEAL' });
    if (plan.slideFrom >= 0) beats.push({ tick: plan.slideFrom, type: 'DECK_TOUCH' });
    if (plan.wobbleFrom >= 0) beats.push({ tick: plan.wobbleFrom, type: 'DECK_WOBBLE' });
    beats.push({ tick: plan.terminalTick, type: result.landed ? 'LAND' : 'SPLASH' });
    beats.sort((a, b) => a.tick - b.tick);

    const achieved = balances.length ? balances[balances.length - 1] : 1;

    return {
        roundId: result.roundId,
        landed: result.landed,
        totalTicks: plan.terminalTick + PHYS.TAIL_TICKS,
        carrierX: plan.carrierX,
        terminalTick: plan.terminalTick,
        frames: plan.frames,
        objects,
        beats,
        finalBalance: result.landed ? achieved : 0,
        peakBalance: balances.length ? Math.max(...balances) : 1,
        peakAltitude: plan.peakAltitude,
        riseWindows: plan.riseWindows,
        ending: plan.ending,
        slideFrom: plan.slideFrom,
        wobbleFrom: plan.wobbleFrom,
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
        x: f[i].x + (f[j].x - f[i].x) * a,
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
