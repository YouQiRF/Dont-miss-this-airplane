/**
 * AviaGame.ts — 主組件。掛在場景裡 Canvas 底下的 GameRoot 節點上。
 *
 * 所有可調參數都是 @property,直接在 Inspector 改,不用動程式。
 * 分成 8 組：下注 / 符號數值 / 離線結果 / 航線編排 / 手感範圍 / 播放速度 / 畫面 / 測試
 */

import {
    _decorator, Component, Color, Enum, UITransform, Label,
    view as ccview, CCFloat, CCInteger, CCString,
} from 'cc';
import * as P from './AviaPath';
import { AviaView } from './AviaView';
import type { UiButton, ViewConfig } from './AviaView';

const { ccclass, property } = _decorator;

export enum SpeedOption { Slow = 0, Medium = 1, Fast = 2, Ultra = 3 }
Enum(SpeedOption);
const SPEED_KEYS: P.Speed[] = ['slow', 'medium', 'fast', 'ultra'];
const SPEED_LABELS = ['慢', '中', '快', '極快'];

const G_BET = { name: '① 下注', id: 'bet', displayOrder: 1 };
const G_SYM = { name: '② 符號數值', id: 'sym', displayOrder: 2 };
const G_OFF = { name: '③ 離線結果', id: 'off', displayOrder: 3 };
const G_PATH = { name: '④ 航線編排', id: 'path', displayOrder: 4 };
const G_STY = { name: '⑤ 手感範圍', id: 'sty', displayOrder: 5 };
const G_SPD = { name: '⑥ 播放速度', id: 'spd', displayOrder: 6 };
const G_VIS = { name: '⑦ 畫面', id: 'vis', displayOrder: 7 };
const G_DBG = { name: '⑧ 測試', id: 'dbg', displayOrder: 8 };

@ccclass('AviaGame')
export class AviaGame extends Component {

    // ════════════════ ① 下注 ════════════════
    @property({ type: [CCFloat], group: G_BET, tooltip: '可選下注額。有幾個就出現幾顆籌碼,順序即按鈕順序' })
    betOptions: number[] = [0.1, 0.5, 1, 2, 5, 10, 25, 50, 100];

    @property({ type: CCInteger, group: G_BET, tooltip: '預設選中第幾個下注額（從 0 起算）' })
    defaultBetIndex = 2;

    @property({ type: CCFloat, group: G_BET, tooltip: '起始餘額' })
    startingBalance = 1000;

    @property({ type: CCString, group: G_BET, tooltip: '幣別符號' })
    currencySymbol = '$';

    @property({ group: G_BET, tooltip: '餘額不足時自動降到買得起的最大下注額' })
    autoDowngradeBet = true;

    // ── 自動下注 ──
    @property({
        type: [CCInteger], group: G_BET,
        tooltip: '自動下注的局數選項。有幾個就出現幾顆按鈕；最後一個固定是無限循環（顯示 ∞），數值忽略',
    })
    autoCountOptions: number[] = [10, 25, 50, 100, 0];

    @property({
        type: [CCFloat], group: G_BET,
        tooltip: '停止條件金額的可選級距（單位：當前下注額的倍數）。第一個 0 = 關閉',
    })
    stopAmountSteps: number[] = [0, 1, 2, 5, 10, 25, 50, 100, 250, 500];

    @property({ type: CCFloat, group: G_BET, tooltip: '自動下注每局之間的間隔（秒）' })
    autoInterval = 0.5;

    // ════════════════ ② 符號數值 ════════════════
    @property({ type: [CCFloat], group: G_SYM, tooltip: '加值物件（+N）。想改成 +1/+3/+7 就直接改這裡' })
    pickupValues: number[] = [1, 2, 5, 10];

    @property({ type: [CCFloat], group: G_SYM, tooltip: '乘算物件（×N）。必須 > 1' })
    boostValues: number[] = [2, 3, 4, 5];

    @property({ type: CCFloat, group: G_SYM, tooltip: '火箭除數。預設 2（÷2）。非 2 的值會讓部分倍數湊不出來,系統會自動退回近似值' })
    rocketDivisor = 2;

    @property({ type: CCInteger, group: G_SYM, tooltip: '一局最多幾個命中物件' })
    maxObjects = 30;

    @property({ type: CCInteger, group: G_SYM, tooltip: '一局最多幾顆火箭' })
    maxRockets = 6;

    @property({ slide: true, range: [0, 1, 0.01], group: G_SYM, tooltip: '分解時優先用乘算的機率。調低 → 改用加值湊 → 場上物件變多' })
    boostChance = 0.30;

    @property({ slide: true, range: [0, 0.6, 0.01], group: G_SYM, tooltip: '分解時額外塞火箭的機率' })
    rocketChance = 0.22;

    @property({ type: CCInteger, group: G_SYM, tooltip: '期望用幾步加值湊完。調高 → 每步變小 → 場上物件變多' })
    pickupStepTarget = 8;

    // ════════════════ ③ 離線／正式 ════════════════
    /**
     * 離線版與正式版的唯一差別就在這裡：結果從哪裡來。
     *   true  → 本地隨機（offlineResult），完全不連線
     *   false → 向 serverUrl 要 { roundId, multiplier, landed }
     * 其餘所有程式碼、演出、驗證完全共用。
     */
    @property({ group: G_OFF, tooltip: '打勾 = 離線版（結果本地隨機，不連線）；取消 = 正式版（向 serverUrl 要結果）' })
    offlineMode = true;

    @property({ type: CCString, group: G_OFF, tooltip: '正式版的開局 API。會 POST { bet } 並期待回傳 { roundId, multiplier, landed }' })
    serverUrl = '';

    @property({ type: CCFloat, group: G_OFF, tooltip: '正式版連線逾時（秒）。逾時或失敗會退款並顯示錯誤，不會偷偷用本地結果頂替' })
    requestTimeout = 8;

    @property({ slide: true, range: [0, 1, 0.01], group: G_OFF, tooltip: '【僅離線版】降落成功率' })
    winChance = 0.5;

    @property({ type: CCFloat, group: G_OFF, tooltip: '倍數偏移次方。越大越偏小倍數' })
    biasPower = 2.1;

    @property({ type: [CCFloat], group: G_OFF, tooltip: '離線抽獎用的倍數池' })
    multiplierPool: number[] = [
        0.25, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8,
        10, 12, 15, 20, 25, 40, 60, 80, 120, 250,
    ];

    // ════════════════ ④ 航線編排（沒有物理,全部是編排參數）════════════════
    @property({ type: CCFloat, group: G_PATH, tooltip: '【只有吃到才上升】吃到任何 +N 或 ×N,弧線頂點比命中點高這麼多 px。與數字大小、當前高度都無關' })
    stepUp = 82;

    @property({ type: CCFloat, group: G_PATH, tooltip: '【只有飛彈才有下降表演】吃到飛彈一律往下砸這麼多 px' })
    stepDown = 82;

    @property({ type: CCFloat, group: G_PATH, tooltip: '【弧線後半】每段從頂點再往下掉這麼多 px。每個物件的淨變化 = ±階距 − 這個值' })
    glideDrop = 30;

    @property({ slide: true, range: [0.4, 1.6, 0.01], group: G_PATH, tooltip: '弧線頂點位置偏移。1 = 幾何上正確的彈道頂點。調小 → 頂點提前、上升急促;調大 → 頂點延後、爬升悠長' })
    arcApexBias = 1;

    @property({ slide: true, range: [0.15, 0.9, 0.01], group: G_PATH, tooltip: '飛彈命中後,前幾成的段落用來俯衝,其餘滑降。調小 → 撞擊更猛' })
    rocketDiveFrac = 0.45;

    @property({ type: CCInteger, group: G_PATH, tooltip: '最後一個物件的升／降表演長度（tick）,之後交給收尾段' })
    lastArcTicks = 7;

    @property({ type: CCInteger, group: G_PATH, tooltip: '第一個物件放在甲板上方幾階' })
    takeoffSteps = 2;

    @property({ type: CCFloat, group: G_PATH, tooltip: '航線最低高度（= 甲板高度）。再低就沒有下一階了' })
    minAlt = 130;

    @property({ type: CCFloat, group: G_PATH, tooltip: '航線最高高度。0 = 不封頂（天空無限,鏡頭會跟上去）' })
    maxAlt = 0;

    @property({ type: CCFloat, group: G_PATH, tooltip: '誘餌可放置的最低高度' })
    decoyMinY = 24;

    @property({ type: CCInteger, group: G_PATH, tooltip: '物件間距（tick）。調小 → 場上物件更多更密' })
    baseGap = 9;

    @property({ slide: true, range: [0, 0.8, 0.01], group: G_PATH, tooltip: '間距隨機抖動比例' })
    gapJitter = 0.35;

    @property({ type: CCInteger, group: G_PATH }) minGap = 6;
    @property({ type: CCInteger, group: G_PATH }) maxGap = 22;
    @property({ type: CCInteger, group: G_PATH, tooltip: '從航母甲板起飛到第一個物件的距離（tick）' }) takeoffTicks = 10;

    @property({ type: CCFloat, group: G_PATH, tooltip: '每 tick 前進的水平像素' })
    pxPerTick = 40;

    @property({ type: CCFloat, group: G_PATH, tooltip: '算俯仰角的水平參考量。調小 → 抬頭更誇張' })
    pitchRun = 34;

    @property({ type: CCFloat, group: G_PATH, tooltip: '俯仰角上限（度）' })
    pitchMaxDeg = 42;

    @property({ type: CCFloat, group: G_PATH, tooltip: '降落段每 tick 下降 px' }) landRate = 9;
    @property({ type: CCInteger, group: G_PATH }) landTicksMin = 10;
    @property({ type: CCInteger, group: G_PATH }) landTicksMax = 34;
    @property({ type: CCFloat, group: G_PATH, tooltip: '墜海段每 tick 下降 px' }) splashRate = 14;
    @property({ type: CCInteger, group: G_PATH }) splashTicksMin = 8;
    @property({ type: CCInteger, group: G_PATH }) splashTicksMax = 22;

    @property({ type: CCInteger, group: G_PATH, tooltip: '【終點保證】局長 tick 上限。超過會自動縮短物件間距重排。實際上限會取 max(這個值, 最緊排列所需長度),所以一定達得到' })
    maxRoundTicks = 300;

    @property({ type: CCFloat, group: G_PATH, tooltip: '碰撞半徑' })
    hitRadius = 46;

    @property({ slide: true, range: [0, 0.8, 0.01], group: G_PATH, tooltip: '誘餌密度。0 = 場上只有必中物件（會很假）' })
    decoyDensity = 0.35;

    @property({ type: CCFloat, group: G_PATH, tooltip: '誘餌離航線的最小淨空 = 碰撞半徑 × 這個倍數。> 1 就保證碰不到' })
    decoyClearance = 1.9;

    @property({ type: CCFloat, group: G_PATH, tooltip: '「差一點」誘餌的淨空倍數。仍然必須 > 1' })
    decoyNearMiss = 1.45;

    @property({ type: CCFloat, group: G_PATH, tooltip: 'HUD 高度條的滿格參考值（純顯示,不是高度上限）' })
    altDisplayMax = 420;

    // ════════════════ ⑤ 手感範圍（每局在區間內隨機。階梯高度不在此列,永遠等高）════════════════
    @property({ type: CCFloat, group: G_STY, tooltip: '物件間距縮放下限（這是唯一的每局隨機項）' }) gapMin = 0.85;
    @property({ type: CCFloat, group: G_STY }) gapMax = 1.20;

    // ════════════════ ⑥ 播放速度 ════════════════
    @property({ type: CCFloat, group: G_SPD, tooltip: '「慢」每 tick 幾毫秒' }) tickMsSlow = 140;
    @property({ type: CCFloat, group: G_SPD }) tickMsMedium = 82;
    @property({ type: CCFloat, group: G_SPD }) tickMsFast = 50;
    @property({ type: CCFloat, group: G_SPD }) tickMsUltra = 24;

    @property({ type: SpeedOption, group: G_SPD, tooltip: '預設速度。速度只改播放快慢,絕不影響結果' })
    defaultSpeed: SpeedOption = SpeedOption.Medium;

    @property({ group: G_SPD, tooltip: '自動連續開局' })
    autoSpin = false;

    @property({ type: CCFloat, group: G_SPD, tooltip: '自動開局間隔（秒）' })
    autoSpinDelay = 1.2;

    @property({ type: CCFloat, group: G_SPD, tooltip: '結算後停留幾秒再回到待機' })
    endHoldSeconds = 1.8;

    // ════════════════ ⑦ 畫面 ════════════════
    @property({ type: CCFloat, group: G_VIS, tooltip: '水面距畫面底部的高度' })
    waterScreenY = 110;

    @property({ slide: true, range: [0.1, 0.8, 0.01], group: G_VIS, tooltip: '飛機固定在畫面寬度的幾成位置' })
    planeScreenXRatio = 0.34;

    @property({ slide: true, range: [0.3, 0.95, 0.01], group: G_VIS, tooltip: '飛機超過畫面高度的幾成時,鏡頭開始往上跟' })
    camFollowStart = 0.62;

    @property({ type: CCFloat, group: G_VIS, tooltip: '鏡頭跟隨速度。越大越硬,越小越飄' })
    camLag = 4;

    @property({ type: CCFloat, group: G_VIS, tooltip: '飛彈額外的向左速度（px/tick）。飛彈一律從畫面右側往左飛,越大越晚出現、飛得越快' })
    rocketApproach = 55;

    @property({ type: CCFloat, group: G_VIS, tooltip: '海面航母的間距（px）。跟目的艦長得一模一樣,整片海會持續有船經過。0 = 關閉' })
    seaCarrierSpacing = 1500;

    @property({ type: CCFloat, group: G_VIS, tooltip: 'HUD 讀數的單位換算：1 px = 幾個顯示單位。純表演,不影響任何邏輯' })
    metersPerPx = 0.25;

    @property({ type: CCString, group: G_VIS, tooltip: 'HUD 讀數的單位文字' })
    distanceUnit = 'm';

    @property({ group: G_VIS }) trailEnabled = true;
    @property({ type: CCInteger, group: G_VIS, tooltip: '尾煙保留幾個取樣點' }) trailLength = 26;
    @property({ type: CCFloat, group: G_VIS, tooltip: '螢幕震動強度。0 = 關閉' }) shakeIntensity = 14;
    @property({ group: G_VIS, tooltip: '把整條預算航線畫出來（調參用）' }) showDebugPath = false;

    @property({ group: G_VIS }) skyTop = new Color(38, 96, 168, 255);
    @property({ group: G_VIS }) skyBottom = new Color(150, 214, 236, 255);
    @property({ group: G_VIS, tooltip: '高空時天空要染向的顏色' }) skyHigh = new Color(8, 14, 46, 255);
    @property({ group: G_VIS }) seaDeep = new Color(18, 70, 122, 255);
    @property({ group: G_VIS }) seaLight = new Color(30, 108, 168, 255);
    @property({ group: G_VIS }) foam = new Color(220, 246, 255, 190);
    @property({ group: G_VIS }) planeBody = new Color(242, 246, 252, 255);
    @property({ group: G_VIS }) planeAccent = new Color(228, 84, 62, 255);
    @property({ group: G_VIS }) trailColor = new Color(255, 255, 255, 255);
    @property({ group: G_VIS }) pickupColor = new Color(92, 226, 200, 255);
    @property({ group: G_VIS }) boostColor = new Color(255, 202, 70, 255);
    @property({ group: G_VIS }) rocketColor = new Color(240, 78, 78, 255);
    @property({ group: G_VIS }) carrierColor = new Color(126, 142, 160, 255);
    @property({ group: G_VIS }) hudColor = new Color(196, 222, 244, 255);
    @property({ group: G_VIS }) hudAccent = new Color(255, 202, 70, 255);
    @property({ group: G_VIS }) textColor = new Color(255, 255, 255, 255);

    // ════════════════ ⑧ 測試 ════════════════
    @property({ group: G_DBG, tooltip: '打開後忽略離線抽獎,每局都用下面指定的結果' })
    forceResult = false;

    @property({ group: G_DBG, tooltip: '強制降落成功 / 強制落海' })
    forceLanded = true;

    @property({ type: CCFloat, group: G_DBG, tooltip: '強制的最終倍數。演算法會反推一條剛好等於它的航線' })
    forceMultiplier = 15;

    @property({ type: CCString, group: G_DBG, tooltip: '固定 seed（留空 = 每局隨機）。同一個 seed 永遠長出同一條航線' })
    forceSeed = '';

    @property({ group: G_DBG, tooltip: '在 Console 印出每局分解出來的物件序列與驗算結果' })
    logRound = true;

    // ════════════════════════════════════════════════════
    //  執行期
    // ════════════════════════════════════════════════════

    private gfx!: AviaView;
    private script: P.PerformanceScript | null = null;
    private state: 'IDLE' | 'PLAY' | 'END' = 'IDLE';
    private t = 0;
    private beatIdx = 0;
    private speed: P.Speed = 'medium';
    private balance = 0;
    private betIdx = 0;
    private clock = 0;
    private endTimer = 0;
    private idleTimer = 0;
    private lastWin = 0;
    private seq = 0;

    // ── 自動下注狀態 ──
    /**
     * 停止條件。全部是「達成就停」,可以同時開好幾個。
     * 金額類的門檻存的是「當前下注額的倍數」,所以改下注額時門檻會跟著等比縮放。
     */
    private auto = {
        on: false,
        countIdx: 0,        // autoCountOptions 的索引
        left: 0,            // 剩餘局數（無限時為 -1）
        baseBalance: 0,     // 開始自動時的餘額,用來算增減
        stopAnyWin: false,
        winIdx: 0,          // 單次獎金 ≥ stopAmountSteps[winIdx] × bet
        upIdx: 0,           // 餘額增加 ≥ ...
        downIdx: 0,         // 餘額減少 ≥ ...
        panel: false,       // 面板開著沒
    };
    private autoTimer = 0;

    private chips: UiButton[] = [];
    private speedBtns: UiButton[] = [];
    private autoCountBtns: UiButton[] = [];
    private autoCondBtns: UiButton[] = [];
    private autoPanelNodes: UiButton[] = [];
    private autoBtn!: UiButton;
    private autoStartBtn!: UiButton;
    private lblAuto!: Label;
    private spinBtn!: UiButton;
    private lblBalance!: Label;
    private lblBet!: Label;
    private lblWin!: Label;
    private lblInfo!: Label;

    // ────────────────────────────────────────────────────

    start() {
        this.pushConfig();

        const W = this.canvasW(), H = this.canvasH();
        this.node.getComponent(UITransform)?.setContentSize(W, H);

        this.gfx = new AviaView(this.node, this.viewConfig(W, H));
        this.balance = this.startingBalance;
        this.betIdx = clamp(this.defaultBetIndex, 0, Math.max(0, this.betOptions.length - 1));
        this.speed = SPEED_KEYS[clamp(this.defaultSpeed as number, 0, 3)];

        this.buildUi(W, H);
        this.gfx.enterIdle();
        this.refreshUi();
    }

    /** 把 Inspector 的值推進演算法層。可在執行期再呼叫一次即時套用。 */
    pushConfig() {
        P.configureSymbols({
            pickups: this.pickupValues,
            boosts: this.boostValues,
            rocketDivisor: this.rocketDivisor,
            maxObjects: this.maxObjects,
            maxRockets: this.maxRockets,
            boostChance: this.boostChance,
            rocketChance: this.rocketChance,
            pickupStepTarget: this.pickupStepTarget,
        });
        P.configurePhys({
            STEP_UP: this.stepUp,
            STEP_DOWN: this.stepDown,
            GLIDE_DROP: this.glideDrop,
            ARC_APEX_BIAS: this.arcApexBias,
            ROCKET_DIVE_FRAC: this.rocketDiveFrac,
            LAST_ARC_TICKS: this.lastArcTicks,
            TAKEOFF_STEPS: this.takeoffSteps,
            MIN_ALT: this.minAlt,
            MAX_ALT: this.maxAlt,
            DECOY_MIN_Y: this.decoyMinY,
            BASE_GAP: this.baseGap,
            GAP_JITTER: this.gapJitter,
            MIN_GAP: this.minGap,
            MAX_GAP: this.maxGap,
            TAKEOFF_TICKS: this.takeoffTicks,
            PX_PER_TICK: this.pxPerTick,
            PITCH_RUN: this.pitchRun,
            PITCH_MAX_DEG: this.pitchMaxDeg,
            LAND_RATE: this.landRate,
            LAND_TICKS_MIN: this.landTicksMin,
            LAND_TICKS_MAX: this.landTicksMax,
            SPLASH_RATE: this.splashRate,
            SPLASH_TICKS_MIN: this.splashTicksMin,
            SPLASH_TICKS_MAX: this.splashTicksMax,
            MAX_ROUND_TICKS: this.maxRoundTicks,
            HIT_RADIUS: this.hitRadius,
            DECOY_DENSITY: this.decoyDensity,
            DECOY_CLEARANCE: Math.max(1.05, this.decoyClearance),
            DECOY_NEAR_MISS: Math.max(1.05, this.decoyNearMiss),
            ALT_DISPLAY_MAX: this.altDisplayMax,
            DECK_Y: this.minAlt,
        });
        P.configureStyle({
            gapMin: Math.min(this.gapMin, this.gapMax),
            gapMax: Math.max(this.gapMin, this.gapMax),
        });
        P.configureTickMs({
            slow: this.tickMsSlow, medium: this.tickMsMedium,
            fast: this.tickMsFast, ultra: this.tickMsUltra,
        });
        P.configureOffline({
            winChance: this.winChance,
            biasPower: this.biasPower,
            pool: this.multiplierPool,
        });
    }

    private canvasW() {
        return this.node.parent?.getComponent(UITransform)?.width ?? ccview.getVisibleSize().width;
    }
    private canvasH() {
        return this.node.parent?.getComponent(UITransform)?.height ?? ccview.getVisibleSize().height;
    }

    private viewConfig(W: number, H: number): ViewConfig {
        return {
            W, H,
            waterScreenY: this.waterScreenY,
            planeScreenXRatio: this.planeScreenXRatio,
            pxPerTick: this.pxPerTick,
            camFollowStart: this.camFollowStart,
            camLag: this.camLag,
            rocketApproach: this.rocketApproach,
            seaCarrierSpacing: this.seaCarrierSpacing,
            metersPerPx: this.metersPerPx,
            distanceUnit: this.distanceUnit,
            skyTop: this.skyTop, skyBottom: this.skyBottom, skyHigh: this.skyHigh,
            seaDeep: this.seaDeep, seaLight: this.seaLight, foam: this.foam,
            planeBody: this.planeBody, planeAccent: this.planeAccent, trailColor: this.trailColor,
            pickupColor: this.pickupColor, boostColor: this.boostColor, rocketColor: this.rocketColor,
            hudColor: this.hudColor, hudAccent: this.hudAccent, textColor: this.textColor,
            carrierColor: this.carrierColor,
            trailLength: this.trailLength,
            trailEnabled: this.trailEnabled,
            shakeIntensity: this.shakeIntensity,
            showDebugPath: this.showDebugPath,
        };
    }

    // ────────────────────────────────────────────────────
    //  UI
    // ────────────────────────────────────────────────────

    private buildUi(W: number, H: number) {
        const g = this.gfx;

        // 下注籌碼列
        const n = this.betOptions.length;
        const cw = Math.max(44, Math.min(96, (W - 420) / Math.max(1, n) - 8));
        const totalW = n * (cw + 8) - 8;
        const x0 = 30 + totalW / 2;
        this.chips = this.betOptions.map((v, i) =>
            g.createButton(x0 - totalW / 2 + i * (cw + 8) + cw / 2, 58, cw, 44,
                `${this.currencySymbol}${trimNum(v)}`, 20, () => {
                    if (this.state !== 'IDLE') return;
                    this.betIdx = i;
                    this.refreshUi();
                }));

        // Spin / AUTO
        this.spinBtn = g.createButton(W - 150, 74, 200, 76, 'SPIN', 34, () => this.onSpinPressed());
        this.autoBtn = g.createButton(W - 300, 74, 88, 76, 'AUTO', 20, () => {
            this.auto.panel = !this.auto.panel;
            this.refreshUi();
        });

        // 速度（自動下注期間唯一還能動的東西）
        this.speedBtns = SPEED_LABELS.map((s, i) =>
            g.createButton(W - 300 + i * 62, 140, 56, 34, s, 17, () => {
                this.speed = SPEED_KEYS[i];
                this.refreshUi();
            }));

        this.buildAutoPanel(W, H);

        // 讀數
        this.lblBalance = g.createText(30, H - 120, 24, this.hudColor, 'left', true);
        this.lblBet = g.createText(30, H - 152, 20, this.hudColor, 'left');
        this.lblWin = g.createText(W - 30, H - 120, 28, this.hudAccent, 'right', true);
        this.lblInfo = g.createText(W / 2, 122, 18, this.hudColor, 'center');
        this.lblAuto = g.createText(W - 30, H - 152, 18, this.hudAccent, 'right');
    }

    /**
     * 自動下注面板。
     * 沒有用文字輸入框 —— 金額門檻改成在 stopAmountSteps 級距上點擊循環,
     * 手機上好按、也不會有輸入驗證問題。門檻是「下注額的倍數」,改下注額會等比縮放。
     */
    private buildAutoPanel(W: number, H: number) {
        const g = this.gfx;
        const px = W - 470, py = H - 250;      // 面板左下角
        const row = (i: number) => py + 176 - i * 40;

        this.autoPanelNodes.push(
            g.createButton(px + 220, py + 226, 440, 34, '自動下注設定', 18, () => { }));

        // 局數
        const n = this.autoCountOptions.length;
        const bw = Math.min(80, 430 / Math.max(1, n) - 6);
        this.autoCountBtns = this.autoCountOptions.map((v, i) => {
            const last = i === n - 1;
            return g.createButton(px + 10 + bw / 2 + i * (bw + 6), row(0), bw, 34,
                last ? '∞' : `${v}`, 17, () => {
                    if (this.auto.on) return;
                    this.auto.countIdx = i;
                    this.refreshUi();
                });
        });

        // 停止條件
        const mk = (i: number, label: string, onClick: () => void) =>
            g.createButton(px + 220, row(i), 440, 34, label, 16, onClick);

        this.autoCondBtns = [
            mk(1, '', () => { if (!this.auto.on) { this.auto.stopAnyWin = !this.auto.stopAnyWin; this.refreshUi(); } }),
            mk(2, '', () => { if (!this.auto.on) { this.cycleStop('winIdx'); } }),
            mk(3, '', () => { if (!this.auto.on) { this.cycleStop('upIdx'); } }),
            mk(4, '', () => { if (!this.auto.on) { this.cycleStop('downIdx'); } }),
        ];

        this.autoStartBtn = g.createButton(px + 220, row(5), 440, 40, '開始自動', 20,
            () => this.toggleAuto());

        this.autoPanelNodes.push(...this.autoCountBtns, ...this.autoCondBtns, this.autoStartBtn);
    }

    private cycleStop(key: 'winIdx' | 'upIdx' | 'downIdx') {
        const steps = this.stopAmountSteps.length || 1;
        this.auto[key] = (this.auto[key] + 1) % steps;
        this.refreshUi();
    }

    /** 門檻金額 = 級距倍數 × 當前下注額。0 = 這條停止條件關閉 */
    private stopAmount(idx: number) {
        return (this.stopAmountSteps[idx] ?? 0) * this.bet();
    }

    private refreshUi() {
        const bet = this.bet();
        const idle = this.state === 'IDLE';
        const A = this.auto;
        const cur = this.currencySymbol;

        // 自動下注期間：下注額鎖死,只剩速度能調
        this.chips.forEach((c, i) => {
            c.setActive(i === this.betIdx);
            c.setEnabled(idle && !A.on);
        });
        this.speedBtns.forEach((b, i) => b.setActive(SPEED_KEYS[i] === this.speed));

        this.spinBtn.setEnabled(A.on || (idle && this.balance >= bet));
        this.spinBtn.setLabel(A.on ? '停止' : idle ? 'SPIN' : '飛行中');
        this.autoBtn.setActive(A.panel || A.on);
        this.autoBtn.setEnabled(!A.on);

        // ── 面板 ──
        this.autoPanelNodes.forEach(b => { b.node.active = A.panel; });
        if (A.panel) {
            const last = this.autoCountOptions.length - 1;
            this.autoCountBtns.forEach((b, i) => {
                b.setActive(i === A.countIdx);
                b.setEnabled(!A.on);
            });
            const amt = (i: number) => this.stopAmount(i) > 0
                ? `${cur}${money(this.stopAmount(i))}` : '關閉';
            const on = (b: boolean) => b ? '☑' : '☐';

            this.autoCondBtns[0].setLabel(`${on(A.stopAnyWin)}  任何勝利就停`);
            this.autoCondBtns[1].setLabel(`${on(A.winIdx > 0)}  單次獎金 ≥ ${amt(A.winIdx)}`);
            this.autoCondBtns[2].setLabel(`${on(A.upIdx > 0)}  餘額增加 ≥ ${amt(A.upIdx)}`);
            this.autoCondBtns[3].setLabel(`${on(A.downIdx > 0)}  餘額減少 ≥ ${amt(A.downIdx)}`);
            this.autoCondBtns[0].setActive(A.stopAnyWin);
            this.autoCondBtns[1].setActive(A.winIdx > 0);
            this.autoCondBtns[2].setActive(A.upIdx > 0);
            this.autoCondBtns[3].setActive(A.downIdx > 0);
            this.autoCondBtns.forEach(b => b.setEnabled(!A.on));

            this.autoStartBtn.setLabel(A.on ? '停止自動' : '開始自動');
            this.autoStartBtn.setActive(A.on);
            this.autoStartBtn.setEnabled(A.on || this.balance >= bet);
            void last;
        }

        this.lblBalance.string = `餘額  ${cur}${money(this.balance)}`;
        this.lblBet.string = `下注  ${cur}${trimNum(bet)}`;
        this.lblWin.string = this.lastWin > 0 ? `贏  ${cur}${money(this.lastWin)}` : '';
        this.lblAuto.string = A.on
            ? (A.left < 0 ? '自動  ∞' : `自動  剩 ${A.left} 局`)
            : '';
    }

    // ────────────────────────────────────────────────────
    //  自動下注
    // ────────────────────────────────────────────────────

    private onSpinPressed() {
        if (this.auto.on) { this.stopAuto('手動停止'); return; }
        this.spin();
    }

    private toggleAuto() {
        if (this.auto.on) { this.stopAuto('手動停止'); return; }
        if (this.balance < this.bet()) { this.lblInfo.string = '餘額不足'; return; }

        const last = this.autoCountOptions.length - 1;
        const infinite = this.auto.countIdx === last;
        this.auto.on = true;
        this.auto.left = infinite ? -1 : Math.max(1, this.autoCountOptions[this.auto.countIdx] | 0);
        this.auto.baseBalance = this.balance;
        this.auto.panel = false;
        this.lblInfo.string = '';
        this.refreshUi();
        this.spin();
    }

    private stopAuto(reason: string) {
        this.auto.on = false;
        this.auto.left = 0;
        this.autoTimer = 0;
        this.lblInfo.string = `自動下注結束：${reason}`;
        this.refreshUi();
    }

    /** 一局結算完之後檢查停止條件。回傳 true 表示已經停了。 */
    private checkAutoStop(): boolean {
        const A = this.auto;
        if (!A.on) return true;

        const win = this.lastWin;
        const delta = this.balance - A.baseBalance;

        if (A.stopAnyWin && win > 0) { this.stopAuto('任何勝利'); return true; }
        if (A.winIdx > 0 && win >= this.stopAmount(A.winIdx)) {
            this.stopAuto(`單次獎金達 ${this.currencySymbol}${money(win)}`); return true;
        }
        if (A.upIdx > 0 && delta >= this.stopAmount(A.upIdx)) {
            this.stopAuto(`餘額增加 ${this.currencySymbol}${money(delta)}`); return true;
        }
        if (A.downIdx > 0 && -delta >= this.stopAmount(A.downIdx)) {
            this.stopAuto(`餘額減少 ${this.currencySymbol}${money(-delta)}`); return true;
        }
        if (A.left > 0) A.left--;
        if (A.left === 0) { this.stopAuto('局數跑完'); return true; }
        if (this.balance < this.bet()) { this.stopAuto('餘額不足'); return true; }
        return false;
    }

    private bet() { return this.betOptions[this.betIdx] ?? 1; }

    // ────────────────────────────────────────────────────
    //  局流程
    // ────────────────────────────────────────────────────

    spin() {
        if (this.state !== 'IDLE') return;
        this.auto.panel = false;

        let bet = this.bet();
        if (this.balance < bet && this.autoDowngradeBet) {
            const best = this.betOptions
                .map((v, idx) => ({ v, idx }))
                .filter(o => o.v <= this.balance)
                .sort((a, b) => b.v - a.v)[0];
            if (best) { this.betIdx = best.idx; bet = best.v; }
        }
        if (this.balance < bet) {
            this.lblInfo.string = '餘額不足';
            return;
        }

        this.pushConfig();                    // 執行期改 Inspector 也能即時生效

        this.balance -= bet;
        this.lastWin = 0;
        this.state = 'PLAY';                 // 先鎖住 UI,避免連線期間重複按
        this.lblInfo.string = this.offlineMode ? '' : '連線中…';
        this.refreshUi();

        this.fetchResult(bet).then(result => {
            if (!result) {                   // 連線失敗 → 退款,不用本地結果頂替
                this.balance += bet;
                this.state = 'IDLE';
                if (this.auto.on) this.stopAuto('連線失敗');
                else this.refreshUi();
                return;
            }
            this.startRound(result);
        });
    }

    /**
     * 結果來源 —— 離線版與正式版唯一的差別。
     * 其餘所有東西（演算法、演出、驗證）兩個版本完全共用。
     */
    private async fetchResult(bet: number): Promise<P.RoundResult | null> {
        if (this.forceResult) {
            return {
                roundId: this.forceSeed || `force-${this.seq++}-${Math.random()}`,
                multiplier: this.forceLanded ? this.forceMultiplier : 0,
                landed: this.forceLanded,
            };
        }
        if (this.offlineMode) {
            const r = P.offlineResult();
            if (this.forceSeed) r.roundId = this.forceSeed;
            return r;
        }
        if (!this.serverUrl) {
            this.lblInfo.string = '正式版模式但沒有設定 serverUrl';
            return null;
        }
        try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), this.requestTimeout * 1000);
            const res = await fetch(this.serverUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bet }),
                signal: ctrl.signal,
            });
            clearTimeout(timer);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const j = await res.json();
            if (typeof j.multiplier !== 'number' || typeof j.landed !== 'boolean') {
                throw new Error('回傳格式不對,需要 { roundId, multiplier, landed }');
            }
            return {
                roundId: String(j.roundId ?? Date.now()),
                multiplier: j.multiplier,
                landed: j.landed,
            };
        } catch (e) {
            console.error('[Avia] 開局請求失敗', e);
            this.lblInfo.string = '連線失敗,已退回下注';
            return null;
        }
    }

    private startRound(result: P.RoundResult) {
        this.script = P.buildPerformance(result);
        this.t = 0;
        this.beatIdx = 0;
        this.state = 'PLAY';
        this.gfx.resetForRound(this.script);
        this.lblInfo.string = '';
        this.refreshUi();

        if (this.logRound) {
            const s = this.script;
            const hits = s.objects.filter(o => o.hit);
            const seq = hits.map(o => o.kind.kind === 'ROCKET' ? `÷${this.rocketDivisor}`
                : o.kind.kind === 'BOOST' ? `×${o.kind.value}` : `+${o.kind.value}`).join('  ');
            console.log(
                `[Avia] ${s.roundId}\n` +
                `  模式      ${this.offlineMode ? '離線（本地隨機）' : '正式（' + this.serverUrl + '）'}\n` +
                `  結果      ${s.landed ? '降落' : '落海'}  ${s.finalBalance}×  ` +
                `結束方式 ${s.ending}  ${s.exact ? '' : '(近似)'}\n` +
                `  序列      ${seq || '（無物件）'}\n` +
                `  航程      ${s.terminalTick} tick / 目的艦在 x=${s.carrierX.toFixed(0)}（終點必定存在）\n` +
                `  物件      命中 ${hits.length} / 誘餌 ${s.objects.length - hits.length}（誘餌保證碰不到）\n` +
                `  最高點    ${s.peakAltitude.toFixed(0)}px\n` +
                `  手感      gap=${s.style.gap.toFixed(2)}`);
        }
    }

    update(dt: number) {
        if (!this.gfx) return;
        this.clock += dt;

        // state 已經是 PLAY 但 script 還沒回來 → 正式版正在等 server,先維持待機畫面
        if (this.state === 'IDLE' || !this.script) {
            this.gfx.update(dt, 0, this.gfx.idleFrame(this.clock), false);
            if (this.state === 'IDLE') {
                if (this.autoTimer > 0) {                    // 自動下注的局間隔
                    this.autoTimer -= dt;
                    if (this.autoTimer <= 0) { this.autoTimer = 0; this.refreshUi(); this.spin(); }
                } else if (this.autoSpin && !this.auto.on) {  // Inspector 的無腦連打（測試用）
                    this.idleTimer += dt;
                    if (this.idleTimer >= this.autoSpinDelay) { this.idleTimer = 0; this.spin(); }
                }
            }
            return;
        }

        const s = this.script;
        const ms = P.TICK_MS[this.speed];

        if (this.state === 'PLAY') {
            this.t = Math.min(this.t + (dt * 1000) / ms, s.totalTicks);
            while (this.beatIdx < s.beats.length && s.beats[this.beatIdx].tick <= this.t) {
                const b = s.beats[this.beatIdx++];
                this.gfx.onBeat(b, s);
                if (b.type === 'LAND') {
                    this.lastWin = this.bet() * s.finalBalance;
                    this.balance += this.lastWin;
                    this.refreshUi();
                } else if (b.type === 'SPLASH') {
                    this.lastWin = 0;
                    this.lblInfo.string = `差一點 —— 最高曾到 ${s.peakBalance.toFixed(2)}×`;
                }
            }
            if (this.t >= s.terminalTick) { this.state = 'END'; this.endTimer = 0; }
        } else {
            this.endTimer += dt;
            if (this.endTimer >= this.endHoldSeconds) {
                this.state = 'IDLE';
                this.idleTimer = 0;
                this.script = null;
                this.gfx.enterIdle();
                // 自動下注：結算完檢查停止條件,沒停就排下一局
                if (this.auto.on && !this.checkAutoStop()) {
                    this.autoTimer = this.autoInterval;
                } else {
                    this.refreshUi();
                }
                return;
            }
        }

        const frame = P.sampleFrame(s, Math.min(this.t, s.terminalTick));
        this.gfx.update(dt, Math.min(this.t, s.terminalTick), frame, true);
    }
}

// ── 小工具 ──────────────────────────────────────────────────
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function trimNum(v: number) { return Number.isInteger(v) ? `${v}` : v.toFixed(2).replace(/0$/, ''); }
function money(v: number) { return v.toFixed(2); }
