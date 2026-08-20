/**
 * AviaView.ts — 畫面表演層
 *
 * 全部用 Graphics 向量繪製,不需要任何美術素材,匯入就能跑。
 * 這一層完全不認識「倍數」「結果」這些概念,它只消費 PerformanceScript。
 */

import {
    Node, Graphics, Label, UITransform, Color, Vec3, tween, Tween, Layers, UIOpacity,
    Prefab, instantiate,
} from 'cc';
import { ART, ArtKind, drawCarrier as drawCarrierArt, makeArtNode, setTokenLabel } from './AviaArt';
import type { ArtPalette } from './AviaArt';
import { SILENT_AUDIO } from './AviaAudio';
import type { AudioHooks, SfxKey } from './AviaAudio';
import { drawUiBox, drawSun as drawSunArt } from './AviaUiArt';
import { PHYS, SEA, seaCarrierX } from './AviaPath';
import type { Beat, Frame, ObjKind, PerformanceScript } from './AviaPath';

export interface ViewConfig {
    W: number; H: number;
    waterScreenY: number;      // 水面在螢幕上的高度（距底部 px）
    planeScreenXRatio: number; // 飛機固定在螢幕寬度的幾成位置
    pxPerTick: number;

    camFollowStart: number;    // 飛機超過畫面高度的幾成時鏡頭開始跟
    camLag: number;            // 鏡頭跟隨速度（每秒收斂倍率）
    rocketApproach: number;    // 飛彈額外的向左速度（px/tick）。越大越晚出現、越快飛過來
    seaCarrierSpacing: number; // 海面佈景航母的間距（px）。0 = 關閉
    metersPerPx: number;       // 顯示用的單位換算（1 px = 幾公尺）。純表演,不影響任何邏輯
    distanceUnit: string;

    skyTop: Color; skyBottom: Color;
    skyHigh: Color;            // 高空時天空漸層要染向的顏色
    seaDeep: Color; seaLight: Color; foam: Color;
    planeBody: Color; planeAccent: Color; trailColor: Color;
    pickupColor: Color; boostColor: Color; rocketColor: Color;
    hudColor: Color; hudAccent: Color; textColor: Color;
    carrierColor: Color;

    /**
     * 物件 Prefab。留空 = 用 AviaArt 的預設向量美術。
     * 指定之後就整個換掉那一種物件的外觀，程式不用動。
     */
    prefabs: Partial<Record<ArtKind, Prefab | null>>;

    /**
     * 音效。留空 = 全程靜音（表演層不會因此少做任何事）。
     * 表演層只透過這個介面出聲，不認得 AudioSource。
     */
    audio?: AudioHooks;

    trailLength: number;
    trailEnabled: boolean;
    shakeIntensity: number;
    showDebugPath: boolean;
}

export interface UiButton {
    node: Node;
    label: Label;
    setLabel(s: string): void;
    setActive(on: boolean): void;
    setEnabled(on: boolean): void;
    /**
     * 重畫外框。
     * 場景裡預設關著的節點（浮層）被打開時要叫一次 —— 保證它一定畫得出來,
     * 不用去賭「關著的時候畫的東西，打開會不會還在」。
     */
    repaint(): void;
}

interface Fx {
    kind: 'RING' | 'SPRAY' | 'FLASH' | 'SMOKE';
    x: number; y: number; t: number; dur: number;
    r0: number; r1: number; color: Color; seed: number;
}

const DEG = 180 / Math.PI;

export class AviaView {
    private cfg: ViewConfig;

    // ── 節點層 ──────────────────────────────────────────────
    private stage!: Node;
    private gSky!: Graphics;
    private gSeaBack!: Graphics;
    private gShips!: Graphics;
    private world!: Node;
    private gTrail!: Graphics;
    private gDebug!: Graphics;
    private objLayer!: Node;
    private plane!: Node;
    private gPlane!: Graphics;
    private balanceLabel!: Label;
    private balanceNode!: Node;
    private carrierA!: Node;
    private carrierB!: Node;
    private gSeaFront!: Graphics;
    private gFx!: Graphics;
    private fxLayer!: Node;
    private gHud!: Graphics;
    private hudDist!: Label;
    private hudAlt!: Label;
    private hudMult!: Label;
    private bigText!: Label;
    private bigTextNode!: Node;
    private uiLayer!: Node;

    // ── 執行期狀態 ──────────────────────────────────────────
    private script: PerformanceScript | null = null;
    private objNodes = new Map<number, Node>();
    private trail: { x: number; y: number }[] = [];
    private fx: Fx[] = [];
    /** 飛彈：不是靜止物件,會從畫面右側往左飛過來,在自己的 tick 剛好抵達飛機所在的 x */
    private rockets: { node: Node; baseX: number; tick: number }[] = [];
    private camRoot!: Node;
    private camY = 0;
    private skyDrawnAt = -9999;
    private shake = 0;
    private clock = 0;
    private shownBalance = 1;
    private targetBalance = 1;
    private sinking = 0;

    private palette!: ArtPalette;
    /** 沒指定音效層就是 SILENT_AUDIO，所以下面所有 this.sfx.play() 都不用判斷 null */
    private sfx: AudioHooks;
    /** 從場景撿到的節點 uuid。這些節點的位置與大小是你在編輯器決定的，程式不動 */
    private sceneNodes = new Set<string>();
    /** 太陽節點（場景可調）。視差是相對「你擺的位置」做偏移，不是絕對座標 */
    private sun!: Node;
    private gSun!: Graphics;
    private sunBaseY = 0;
    /** stage 的基準位置。螢幕震動是相對它偏移，場景把 stage 搬走也不會被打回原點 */
    private stageBase = new Vec3();

    constructor(root: Node, cfg: ViewConfig) {
        this.cfg = cfg;
        this.sfx = cfg.audio ?? SILENT_AUDIO;
        this.palette = {
            planeBody: cfg.planeBody, planeAccent: cfg.planeAccent,
            pickup: cfg.pickupColor, boost: cfg.boostColor, rocket: cfg.rocketColor,
            carrier: cfg.carrierColor, foam: cfg.foam, haze: cfg.skyBottom,
        };
        this.build(root);
    }

    /**
     * 生一個物件節點：有指定 Prefab 就 instantiate，沒有就用預設向量美術。
     * 兩條路產出的節點介面一致（錨點置中、尺寸已設好），呼叫端不用分辨。
     */
    private spawn(parent: Node, name: string, kind: ArtKind): Node {
        const pf = this.cfg.prefabs?.[kind];
        let n: Node;
        if (pf) {
            n = instantiate(pf);
            n.name = name;
            if (!n.getComponent(UITransform)) n.addComponent(UITransform);
        } else {
            n = makeArtNode(name, kind, this.palette);
        }
        n.layer = Layers.Enum.UI_2D;
        parent.addChild(n);
        return n;
    }

    // ══════════════════════════════════════════════════════
    //  建構節點樹
    // ══════════════════════════════════════════════════════

    /**
     * 取節點：**場景裡已經有同名子節點就直接用它**,沒有才程式建一個。
     *
     * 這是「GameObject 擺在場景上」的核心。場景裡擺好的節點,
     * 位置、大小、縮放全部由你在編輯器決定,**程式不會覆寫**（見 place()）。
     * 場景沒擺的就退回程式建,行為跟以前完全一樣 —— 所以空場景也照樣跑得起來。
     *
     * 用 `node tools/genlayout.js` 可以把整棵預設節點樹寫進場景,
     * 開編輯器就看得到全部節點,直接拖。
     */
    private mk(parent: Node, name: string, w?: number, h?: number): Node {
        const found = parent.getChildByName(name);
        if (found) {
            this.sceneNodes.add(found.uuid);
            const ut = found.getComponent(UITransform) ?? found.addComponent(UITransform);
            // 場景沒設大小（0×0）才給預設值,設過的就是你的
            if (ut.width === 0 && ut.height === 0) {
                ut.setContentSize(w ?? this.cfg.W, h ?? this.cfg.H);
            }
            return found;
        }
        const n = new Node(name);
        n.layer = Layers.Enum.UI_2D;
        const ut = n.addComponent(UITransform);
        ut.setAnchorPoint(0, 0);
        ut.setContentSize(w ?? this.cfg.W, h ?? this.cfg.H);
        parent.addChild(n);
        return n;
    }

    /** 這個節點是從場景撿來的嗎（撿來的就不准程式動它的位置） */
    private isFromScene(n: Node) { return this.sceneNodes.has(n.uuid); }

    /**
     * 擺位置 —— **只對程式自己建的節點生效**。
     * 場景擺好的節點位置由你決定,程式擺過去等於把你的調整蓋掉。
     *
     * 注意：飛機、物件、目的艦這些「位置由航線演算法決定」的東西不走這裡,
     * 它們每一 frame 都要被程式移動,擺在場景上的只是外觀與起點。
     */
    private place(n: Node, x: number, y: number) {
        if (!this.isFromScene(n)) n.setPosition(x, y);
    }

    private mkGraphics(parent: Node, name: string): Graphics {
        // 場景節點上可能已經掛好元件了 —— 有就用，沒有才加，重跑不會長出兩個
        const n = this.mk(parent, name);
        return n.getComponent(Graphics) ?? n.addComponent(Graphics);
    }

    /**
     * 取這個節點的文字元件。
     *
     * **場景擺好的節點,Label 是掛在自己身上的**（genlayout 就是這樣寫的,
     * 這樣編輯器裡直接看得到字）。這時候就沿用它,只換樣式與內容。
     * 沒有的話才生一個置中的 `label` 子節點 —— 也就是以前的作法。
     *
     * 少了這一步會變成「場景的字」跟「程式生的字」兩份疊在一起。
     */
    private mkLabelOn(n: Node, size: number, color: Color, bold = false): Label {
        const own = n.getComponent(Label);
        if (own) {
            own.fontSize = size;
            own.lineHeight = size * 1.15;
            own.color = color;
            own.isBold = bold;
            own.horizontalAlign = Label.HorizontalAlign.CENTER;
            own.verticalAlign = Label.VerticalAlign.CENTER;
            own.overflow = Label.Overflow.NONE;
            return own;
        }
        const l = this.mkLabel(n, 'label', size, color, bold);
        l.node.getComponent(UITransform)!.setAnchorPoint(0.5, 0.5);
        this.place(l.node, 0, 0);
        return l;
    }

    private mkLabel(parent: Node, name: string, size: number, color: Color, bold = false): Label {
        const n = this.mk(parent, name, 400, size * 1.6);
        const l = n.getComponent(Label) ?? n.addComponent(Label);
        l.string = '';
        l.fontSize = size;
        l.lineHeight = size * 1.15;
        l.color = color;
        l.isBold = bold;
        l.horizontalAlign = Label.HorizontalAlign.CENTER;
        l.verticalAlign = Label.VerticalAlign.CENTER;
        l.overflow = Label.Overflow.NONE;
        return l;
    }

    private build(root: Node) {
        const { W, H } = this.cfg;
        // 美術層要知道甲板高度與船寬,才能把甲板面畫在正確的地方
        ART.DECK_Y = PHYS.DECK_Y;
        ART.CARRIER_HALF_W = SEA.HALF_W;

        // stage：把原點搬到左下角,並且是螢幕震動的施力點
        this.stage = this.mk(root, 'stage', W, H);
        this.place(this.stage, -W / 2, -H / 2);
        this.stageBase = this.stage.position.clone();

        // 天空固定在螢幕上,其餘全部掛在 camRoot 底下由鏡頭帶動（背景不放雲）
        this.gSky = this.mkGraphics(this.stage, 'sky');

        // 太陽是獨立的 GameObject —— 場景裡可以直接拖位置、縮放,
        // 視差是相對「你擺的位置」往下偏移,不是絕對座標
        this.sun = this.mk(this.stage, 'sun', 220, 220);
        this.place(this.sun, W * 0.78, H * 0.80);
        this.gSun = this.sun.getComponent(Graphics) ?? this.sun.addComponent(Graphics);
        this.sunBaseY = this.sun.position.y;
        this.drawSun();

        this.camRoot = this.mk(this.stage, 'camRoot');
        this.gSeaBack = this.mkGraphics(this.camRoot, 'seaBack');
        this.gShips = this.mkGraphics(this.camRoot, 'seaCarriers');

        this.world = this.mk(this.camRoot, 'world');
        this.carrierA = this.spawn(this.world, 'carrierStart', ArtKind.Carrier);
        this.carrierB = this.spawn(this.world, 'carrierEnd', ArtKind.CarrierDest);
        this.gDebug = this.mkGraphics(this.world, 'debugPath');
        this.gTrail = this.mkGraphics(this.world, 'trail');
        this.objLayer = this.mk(this.world, 'objects');

        this.plane = this.spawn(this.world, 'plane', ArtKind.Plane);

        // 倍數標籤跟著飛機跑,位置每 frame 由程式算 —— 場景擺的只有外觀
        this.balanceNode = this.mk(this.world, 'balance', 220, 46);
        this.balanceNode.getComponent(UITransform)!.setAnchorPoint(0.5, 0.5);
        this.balanceLabel = this.mkLabelOn(this.balanceNode, 30, this.cfg.textColor, true);

        this.gSeaFront = this.mkGraphics(this.camRoot, 'seaFront');
        this.fxLayer = this.mk(this.camRoot, 'fxLayer');
        this.gFx = this.mkGraphics(this.camRoot, 'fx');

        // HUD —— 三個讀數都是獨立節點,位置在場景裡拖
        const hud = this.mk(this.stage, 'hud');
        this.gHud = hud.getComponent(Graphics) ?? hud.addComponent(Graphics);
        this.hudDist = this.mkLabel(hud, 'dist', 20, this.cfg.hudColor);
        this.hudDist.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
        this.hudDist.horizontalAlign = Label.HorizontalAlign.LEFT;
        this.place(this.hudDist.node, 36, H - 42);

        this.hudAlt = this.mkLabel(hud, 'alt', 20, this.cfg.hudColor);
        this.hudAlt.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
        this.hudAlt.horizontalAlign = Label.HorizontalAlign.LEFT;
        this.place(this.hudAlt.node, 36, H - 76);

        this.hudMult = this.mkLabel(hud, 'mult', 40, this.cfg.hudAccent, true);
        this.hudMult.node.getComponent(UITransform)!.setAnchorPoint(0.5, 0.5);
        this.place(this.hudMult.node, W / 2, H - 56);

        this.bigTextNode = this.mk(this.stage, 'bigText', 900, 140);
        this.bigTextNode.getComponent(UITransform)!.setAnchorPoint(0.5, 0.5);
        this.place(this.bigTextNode, W / 2, H * 0.62);
        this.bigText = this.mkLabelOn(this.bigTextNode, 96, this.cfg.textColor, true);
        this.bigText.string = '';
        this.bigTextNode.active = false;

        this.uiLayer = this.mk(this.stage, 'ui');

        this.drawSky(0);
    }

    // ══════════════════════════════════════════════════════
    //  UI 元件工廠（AviaGame 拿去組下注面板 / 速度鈕 / Spin）
    // ══════════════════════════════════════════════════════

    /**
     * @param name 節點名字。**場景的 `ui` 底下有同名節點就用那一個**（位置你決定）,
     *             沒有才用 x / y 建一個。所有 UI 都吃這條規則。
     */
    createText(name: string, x: number, y: number, size: number, color: Color,
        align: 'left' | 'center' | 'right' = 'left', bold = false): Label {
        const l = this.mkLabel(this.uiLayer, name, size, color, bold);
        const ut = l.node.getComponent(UITransform)!;
        ut.setAnchorPoint(align === 'left' ? 0 : align === 'right' ? 1 : 0.5, 0.5);
        l.horizontalAlign = align === 'left' ? Label.HorizontalAlign.LEFT
            : align === 'right' ? Label.HorizontalAlign.RIGHT : Label.HorizontalAlign.CENTER;
        this.place(l.node, x, y);
        return l;
    }

    /**
     * 純裝飾的圓角面板：下注器的凹槽、自動下注面板的底、數字鍵盤的底。
     *
     * ⚠ UI 層是照建立順序疊的,**面板要先建**,後面建的按鈕才會蓋在它上面。
     */
    createFrame(name: string, x: number, y: number, w: number, h: number,
        fill?: Color, stroke?: Color, radius = 14): Node {
        const n = this.mk(this.uiLayer, name, w, h);
        const ut = n.getComponent(UITransform)!;
        ut.setAnchorPoint(0.5, 0.5);
        this.place(n, x, y);
        // 場景裡改過大小就照場景的畫
        const fw = ut.width, fh = ut.height;
        const g = n.getComponent(Graphics) ?? n.addComponent(Graphics);
        // 跟編輯器預覽共用同一支畫法 —— 看到的跟跑起來的一定一樣
        drawUiBox(g, fw, fh, {
            fill: fill ?? new Color(10, 22, 38, 242),
            stroke: stroke ?? new Color(255, 255, 255, 46),
            radius,
        });
        return n;
    }

    /**
     * @param sfxKey 按下去要響哪一顆音效。傳 null = 這顆按鈕自己不出聲
     *               （SPIN／自動下注是由動作本身出聲，不是由按鈕出聲 —— 餘額不足按不動時就不該響）
     */
    createButton(name: string, x: number, y: number, w: number, h: number, text: string,
        fontSize: number, onClick: () => void, sfxKey: SfxKey | null = 'click'): UiButton {
        const n = this.mk(this.uiLayer, name, w, h);
        const ut = n.getComponent(UITransform)!;
        ut.setAnchorPoint(0.5, 0.5);
        this.place(n, x, y);
        // 位置與大小都以場景為準 —— 在編輯器把按鈕拉大,畫出來就是大的
        const bw = ut.width, bh = ut.height;
        const g = n.getComponent(Graphics) ?? n.addComponent(Graphics);
        const l = this.mkLabelOn(n, fontSize, this.cfg.textColor, true);
        l.string = text;

        const st = { on: false, enabled: true };
        const paint = () => {
            // 跟編輯器預覽共用同一支畫法（AviaUiArt.drawUiBox）
            drawUiBox(g, bw, bh, { on: st.on, enabled: st.enabled, accent: this.cfg.hudAccent });
            l.color = st.enabled
                ? (st.on ? new Color(20, 28, 40, 255) : this.cfg.textColor)
                : new Color(this.cfg.textColor.r, this.cfg.textColor.g, this.cfg.textColor.b, 90);
        };
        paint();

        n.on(Node.EventType.TOUCH_END, () => {
            if (!st.enabled) return;
            if (sfxKey) this.sfx.play(sfxKey);
            Tween.stopAllByTarget(n);
            n.setScale(1, 1, 1);
            tween(n).to(0.05, { scale: new Vec3(0.93, 0.93, 1) })
                .to(0.1, { scale: new Vec3(1, 1, 1) }).start();
            onClick();
        }, this);

        return {
            node: n, label: l,
            setLabel: (s: string) => { l.string = s; },
            setActive: (on: boolean) => { st.on = on; paint(); },
            setEnabled: (on: boolean) => { st.enabled = on; paint(); },
            repaint: paint,
        };
    }

    /** 給 AviaGame 掛按鈕用 */
    get uiRoot(): Node { return this.uiLayer; }

    // ══════════════════════════════════════════════════════
    //  靜態繪製
    // ══════════════════════════════════════════════════════

    /**
     * 天空。飛得越高整片漸層越往 skyHigh 染 → 高空有實際的視覺回饋。
     * 上方沒有任何邊界,鏡頭可以無限往上跑。
     */
    /**
     * 太陽：畫在自己節點的原點上,所以在場景裡拖節點就是搬太陽,縮放節點就是改大小。
     * 節點上已經有 Sprite（你自己放的圖）時就不畫,直接用你的圖。
     */
    private drawSun() {
        drawSunArt(this.gSun);   // 跟編輯器預覽共用（AviaUiArt.drawSun）
    }

    /** 隨鏡頭緩慢下沉。偏移是相對「場景裡擺的位置」,不是絕對座標 */
    private updateSun(camY: number) {
        this.sun.setPosition(this.sun.position.x, this.sunBaseY - camY * 0.12);
    }

    private drawSky(camY: number) {
        const { W, H, skyTop, skyBottom, skyHigh } = this.cfg;
        const g = this.gSky;
        const alt = Math.max(0, Math.min(1, camY / 900));       // 0..1 高空程度
        const mix = (c: Color, k: number) => new Color(
            Math.round(c.r + (skyHigh.r - c.r) * k),
            Math.round(c.g + (skyHigh.g - c.g) * k),
            Math.round(c.b + (skyHigh.b - c.b) * k), 255);
        const top = mix(skyTop, alt);
        const bottom = mix(skyBottom, alt * 0.65);

        g.clear();
        const bands = 28;
        for (let i = 0; i < bands; i++) {
            const a = i / (bands - 1);
            g.fillColor = new Color(
                Math.round(bottom.r + (top.r - bottom.r) * a),
                Math.round(bottom.g + (top.g - bottom.g) * a),
                Math.round(bottom.b + (top.b - bottom.b) * a),
                255);
            g.rect(0, (H / bands) * i, W, H / bands + 1);
            g.fill();
        }
        // 太陽已經是獨立節點（見 drawSun / updateSun）,不在這裡畫
        // 高空星點
        if (alt > 0.35) {
            const a = Math.round((alt - 0.35) / 0.65 * 170);
            g.fillColor = new Color(255, 255, 255, a);
            for (let i = 0; i < 40; i++) {
                const x = ((i * 7919) % 1000) / 1000 * W;
                const y = H * 0.35 + ((i * 6151) % 1000) / 1000 * H * 0.65;
                g.circle(x, y, 1 + (i % 3) * 0.6); g.fill();
            }
        }
    }

    /**
     * 航母。甲板面剛好落在 PHYS.DECK_Y（= 航線最低高度）,
     * 所以飛機是真的停在甲板上起飛、也是真的降落在甲板上,不會浮在半空。
     * 船身從水線一路撐到甲板,整座船都在畫面可見範圍內。
     */
    /** 佈景船仍然畫在單一 Graphics 上（同屏只有 2~3 艘,不值得開節點） */
    private paintCarrier(cx: number, cy: number, sc: number, haze: number, dest: boolean) {
        drawCarrierArt(this.gShips, this.palette, cx, cy, sc, haze, dest);
    }

    /**
     * 畫一艘航母。
     * @param cx,cy  水線位置（局部座標）
     * @param s      縮放
     * @param haze   0..1 空氣透視,越大越往天空色淡去（遠景船用）
     */

    /**
     * 海面上持續出現的航母。
     *
     * 跟結算用的目的艦「長得一模一樣」—— 同樣的尺寸、同樣的顏色、同樣的導引燈,
     * 而且用同一個 par = 1 的捲動速度,所以它們就是同一種船,只是這一局沒被選為終點。
     * 玩家無法從外觀分辨哪艘是終點,只能看飛機最後停在哪。
     *
     * 唯一的差別是位置：會避開起飛艦與目的艦,免得疊在一起。
     */
    private drawSeaCarriers(scroll: number) {
        const { W, waterScreenY, seaCarrierSpacing, pxPerTick } = this.cfg;
        const g = this.gShips;
        g.clear();
        if (seaCarrierSpacing <= 0) return;

        const CARRIER_W = SEA.HALF_W * 2;             // 用來判斷會不會疊到
        const endX = this.script ? this.script.carrierX : 30 * pxPerTick;

        const gap = seaCarrierSpacing;
        const i0 = Math.floor((-scroll - W * 0.4) / gap) - 1;
        const i1 = Math.ceil((-scroll + W * 1.4) / gap) + 1;

        for (let i = i0; i <= i1; i++) {
            // 位置由 AviaPath 決定 —— 演算法靠它判斷「該墜海的位置有沒有船」,兩邊必須一致
            const worldX = seaCarrierX(i);
            if (Math.abs(worldX) < CARRIER_W) continue;          // 起飛艦
            if (Math.abs(worldX - endX) < CARRIER_W) continue;   // 目的艦

            const x = worldX + scroll;
            if (x < -CARRIER_W || x > W + CARRIER_W) continue;
            this.paintCarrier(x, waterScreenY, 1, 0, true);   // 佈景船跟目的艦長得一模一樣
        }
    }



    // ══════════════════════════════════════════════════════
    //  每局重置
    // ══════════════════════════════════════════════════════

    resetForRound(script: PerformanceScript) {
        this.script = script;
        this.trail.length = 0;
        this.fx.length = 0;
        this.shake = 0;
        this.sinking = 0;
        this.camY = 0;
        this.shownBalance = 1;
        this.targetBalance = 1;
        this.bigTextNode.active = false;

        this.objNodes.forEach(n => { Tween.stopAllByTarget(n); n.destroy(); });
        this.objNodes.clear();
        this.rockets.length = 0;

        const { pxPerTick, waterScreenY } = this.cfg;

        for (const o of script.objects) {
            const kind = o.kind.kind === 'ROCKET' ? ArtKind.Rocket
                : o.kind.kind === 'BOOST' ? ArtKind.Boost : ArtKind.Pickup;
            const n = this.spawn(this.objLayer, `o${o.id}`, kind);
            n.setPosition(o.tick * pxPerTick, waterScreenY + o.y);
            (n.getComponent(UIOpacity) ?? n.addComponent(UIOpacity)!).opacity = o.hit ? 255 : 205;

            if (o.kind.kind !== 'ROCKET') {
                const txt = o.kind.kind === 'BOOST' ? `×${o.kind.value}` : `+${o.kind.value}`;
                // 自訂 Prefab 只要放一個叫 "value" 的 Label 子節點就會自動帶入數字
                if (this.cfg.prefabs?.[kind]) {
                    setTokenLabel(n, txt);
                } else {
                    const l = this.mkLabel(n, 'value', 26, new Color(20, 32, 48, 255), true);
                    l.node.getComponent(UITransform)!.setAnchorPoint(0.5, 0.5);
                    l.node.setPosition(0, 0);
                    l.string = txt;
                }
            } else {
                this.rockets.push({ node: n, baseX: o.tick * pxPerTick, tick: o.tick });
            }
            this.objNodes.set(o.id, n);
        }

        this.carrierA.setPosition(0, waterScreenY);
        this.carrierB.setPosition(script.carrierX, waterScreenY);

        this.gDebug.clear();
        if (this.cfg.showDebugPath) {
            const g = this.gDebug;
            g.lineWidth = 2;
            g.strokeColor = new Color(255, 255, 255, 60);
            script.frames.forEach((f, i) => {
                const x = i * pxPerTick, y = waterScreenY + f.y;
                if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
            });
            g.stroke();
        }
    }

    /** 回到待機：清掉上一局的殘留,把兩艘艦排回預設位置 */
    enterIdle() {
        const { waterScreenY, pxPerTick } = this.cfg;
        this.sfx.loop('engine', false);   // 中途被打斷（例如自動下注被停）也要保證引擎聲收掉
        this.script = null;
        this.trail.length = 0;
        this.fx.length = 0;
        this.sinking = 0;
        this.shake = 0;
        this.camY = 0;
        this.shownBalance = 1;
        this.targetBalance = 1;
        this.bigTextNode.active = false;
        this.objNodes.forEach(n => { Tween.stopAllByTarget(n); n.destroy(); });
        this.objNodes.clear();
        this.gDebug.clear();
        this.carrierA.setPosition(0, waterScreenY);
        this.carrierB.setPosition(30 * pxPerTick, waterScreenY);   // 待機時的暫放位置
    }

    /** 待機時飛機停在起飛甲板上輕微浮動 */
    idleFrame(clock: number): Frame {
        return {
            tick: 0, x: 0,
            y: PHYS.DECK_Y + 18 + Math.sin(clock * 2) * 4,
            vy: 0,
            pitch: Math.sin(clock * 1.3) * 0.035,
        };
    }

    // ══════════════════════════════════════════════════════
    //  每 frame 更新
    // ══════════════════════════════════════════════════════

    update(dt: number, t: number, frame: Frame, playing: boolean) {
        this.clock += dt;
        const { W, H, pxPerTick, waterScreenY, planeScreenXRatio } = this.cfg;
        const s = this.script;

        // 世界捲動（水平）。x 由腳本給 —— 收尾滑行段飛機會減速停下,不再等速前進。
        const planeWorldX = frame.x;
        const scroll = W * planeScreenXRatio - planeWorldX;
        this.world.setPosition(scroll, 0);

        // ── 垂直鏡頭：飛機超過畫面高度的 camFollowStart 之後鏡頭跟著往上,沒有上限 ──
        const planeAbs = waterScreenY + frame.y - this.sinking;
        const target = Math.max(0, planeAbs - H * this.cfg.camFollowStart);
        this.camY += (target - this.camY) * Math.min(1, dt * this.cfg.camLag);
        this.camRoot.setPosition(0, -this.camY);

        // 飛機（座標仍在 camRoot 空間內,所以不用自己扣鏡頭）
        const py = planeAbs;
        this.plane.setPosition(planeWorldX, py);
        this.plane.angle = frame.pitch * DEG + (this.sinking > 0 ? -this.sinking * 0.35 : 0);

        // Counter Balance 標籤（數字滾動）
        this.balanceNode.active = playing;
        this.shownBalance += (this.targetBalance - this.shownBalance) * Math.min(1, dt * 12);
        this.balanceLabel.string = `${fmt(this.shownBalance)}×`;
        this.balanceNode.setPosition(planeWorldX, py + 58);

        // 尾煙
        if (this.cfg.trailEnabled && playing) {
            this.trail.push({ x: planeWorldX - 30, y: py - 2 });
            while (this.trail.length > this.cfg.trailLength) this.trail.shift();
            this.drawTrail();
        } else {
            this.gTrail.clear();
        }

        // 飛彈：從畫面右側往左飛,在自己的 tick 剛好抵達飛機的 x
        const app = this.cfg.rocketApproach;
        for (const r of this.rockets) {
            if (!r.node.isValid) continue;
            const dx = Math.min((r.tick - t) * app, W * 1.4);
            r.node.setPosition(r.baseX + dx, r.node.position.y);
        }

        // 天空只在鏡頭有明顯移動時重畫（28 條色帶,不必每 frame 重來）
        if (Math.abs(this.camY - this.skyDrawnAt) > 4) {
            this.skyDrawnAt = this.camY;
            this.drawSky(this.camY);
        }
        this.updateSun(this.camY);   // 太陽是節點,每 frame 只是搬位置,不重畫
        this.drawSeaCarriers(scroll);
        this.drawSea(scroll);
        this.updateFx(dt);
        if (s && playing) {
            this.drawHud(t, frame, s);
        } else {
            this.gHud.clear();
            this.hudMult.string = '';
            this.hudDist.string = '距離  --';
            this.hudAlt.string = '高度  --';
        }

        // 螢幕震動。晃動是相對 stage 的**基準位置**做偏移 ——
        // 場景裡把 stage 搬過位置也不會被這裡打回原點
        if (this.shake > 0) {
            this.shake = Math.max(0, this.shake - dt * 3.2);
            const k = this.shake * this.cfg.shakeIntensity;
            this.stage.setPosition(
                this.stageBase.x + (Math.random() - 0.5) * k,
                this.stageBase.y + (Math.random() - 0.5) * k);
        } else {
            this.stage.setPosition(this.stageBase.x, this.stageBase.y);
        }

        // 墜海後持續下沉
        if (this.sinking > 0) this.sinking += dt * 46;
    }

    private drawTrail() {
        const g = this.gTrail;
        g.clear();
        const n = this.trail.length;
        if (n < 2) return;
        const c = this.cfg.trailColor;
        for (let i = 1; i < n; i++) {
            const a = i / n;
            g.strokeColor = new Color(c.r, c.g, c.b, Math.round(a * a * 170));
            g.lineWidth = 2 + a * 9;
            g.moveTo(this.trail[i - 1].x, this.trail[i - 1].y);
            g.lineTo(this.trail[i].x, this.trail[i].y);
            g.stroke();
        }
    }

    /** 三層 sin 波,不同振幅/波長/視差 → 深度感 */
    private drawSea(scroll: number) {
        const { W, waterScreenY, seaDeep, seaLight, foam } = this.cfg;
        const layers = [
            { g: this.gSeaBack, dy: 26, amp: 7, len: 260, par: 0.25, spd: 0.5, col: seaLight, alpha: 255 },
            { g: this.gSeaFront, dy: 6, amp: 11, len: 170, par: 0.6, spd: 0.9, col: seaDeep, alpha: 255 },
        ];
        for (const L of layers) {
            const g = L.g; g.clear();
            g.fillColor = new Color(L.col.r, L.col.g, L.col.b, L.alpha);
            const top = waterScreenY + L.dy;
            const floor = -this.cfg.H * 4;   // 往下畫很深,鏡頭升高時底部才不會露出空隙
            g.moveTo(0, floor);
            for (let x = 0; x <= W; x += 8) {
                const p = (x - scroll * L.par) / L.len + this.clock * L.spd;
                g.lineTo(x, top + Math.sin(p) * L.amp + Math.sin(p * 2.3) * L.amp * 0.35);
            }
            g.lineTo(W, floor); g.close(); g.fill();
        }
        // 浪花線
        const g = this.gSeaFront;
        g.strokeColor = foam; g.lineWidth = 2;
        const top = waterScreenY + 6;
        for (let x = 0; x <= W; x += 8) {
            const p = (x - scroll * 0.6) / 170 + this.clock * 0.9;
            const y = top + Math.sin(p) * 11 + Math.sin(p * 2.3) * 3.85;
            if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
    }

    private drawHud(t: number, frame: Frame, s: PerformanceScript) {
        const { W, H, hudColor, hudAccent } = this.cfg;
        const g = this.gHud;
        g.clear();

        const bar = (x: number, y: number, w: number, p: number, col: Color) => {
            g.fillColor = new Color(255, 255, 255, 34);
            g.roundRect(x, y, w, 10, 5); g.fill();
            g.fillColor = col;
            g.roundRect(x, y, Math.max(6, w * Math.max(0, Math.min(1, p))), 10, 5); g.fill();
        };
        // 進度條照實際比例畫（不顯示百分比數字）
        const dist = Math.min(1, frame.x / Math.max(1, s.carrierX));
        const alt = Math.max(0, Math.min(1, frame.y / PHYS.ALT_DISPLAY_MAX));
        bar(150, H - 47, 210, dist, hudAccent);
        bar(150, H - 81, 210, alt, hudColor);

        // 讀數用實際距離／高度（純表演,單位由 metersPerPx 換算）
        const u = this.cfg.metersPerPx;
        const un = this.cfg.distanceUnit;
        const flown = frame.x * u;
        const total = s.carrierX * u;
        this.hudDist.string = `距離 ${fmtLen(flown)} / ${fmtLen(total)} ${un}`;
        this.hudAlt.string = `高度 ${fmtLen(frame.y * u)} ${un}`;
        this.hudMult.string = `${fmt(this.shownBalance)}×`;
        this.hudMult.color = this.targetBalance >= 20 ? hudAccent : this.cfg.textColor;
    }

    // ══════════════════════════════════════════════════════
    //  演出節拍
    // ══════════════════════════════════════════════════════

    onBeat(b: Beat, s: PerformanceScript) {
        const { waterScreenY, pxPerTick, W, planeScreenXRatio } = this.cfg;
        const node = b.objId !== undefined ? this.objNodes.get(b.objId) : undefined;
        const screenX = W * planeScreenXRatio;
        const worldY = node ? node.position.y : waterScreenY + 200;

        switch (b.type) {
            case 'TAKEOFF':
                this.pushFx('SMOKE', screenX - 60, waterScreenY + PHYS.DECK_Y, 0.6, 20, 90,
                    new Color(255, 255, 255, 200));
                this.sfx.play('takeoff');
                this.sfx.loop('engine', true);      // 引擎聲一路播到降落／落海
                break;

            case 'HIT_PICKUP':
            case 'HIT_BOOST': {
                const boost = b.type === 'HIT_BOOST';
                this.targetBalance = b.payload!.balance;
                this.consume(node, boost);
                this.pushFx('RING', screenX, worldY, 0.42, 20, boost ? 120 : 78,
                    boost ? this.cfg.boostColor : this.cfg.pickupColor);
                this.floatText(screenX, worldY + 20,
                    boost ? `×${b.payload!.value}` : `+${b.payload!.value}`,
                    boost ? this.cfg.boostColor : this.cfg.pickupColor, boost ? 52 : 40);
                this.punch(this.balanceNode, boost ? 1.55 : 1.25);
                if (boost) this.shake = Math.max(this.shake, 0.45);
                this.sfx.play(boost ? 'boost' : 'pickup');
                break;
            }

            case 'HIT_ROCKET':
                this.targetBalance = b.payload!.balance;
                this.consume(node, false);
                this.pushFx('FLASH', screenX, worldY, 0.3, 30, 150, this.cfg.rocketColor);
                this.pushFx('SPRAY', screenX, worldY, 0.55, 10, 130, this.cfg.rocketColor);
                this.floatText(screenX, worldY + 16, '÷2', this.cfg.rocketColor, 50);
                this.punch(this.balanceNode, 0.7);
                this.shake = 1;
                this.sfx.play('rocket');
                break;

            case 'NEAR_MISS':
                // 誘餌很密,這顆會連發 —— 音量壓低,再靠 AviaAudio 的 minGapMs 節流
                this.sfx.play('nearMiss', 0.55);
                if (node) {
                    Tween.stopAllByTarget(node);
                    tween(node)
                        .to(0.05, { scale: new Vec3(1.18, 0.86, 1) })
                        .to(0.12, { scale: new Vec3(1, 1, 1) })
                        .start();
                }
                break;

            case 'ENDGAME_REVEAL':
                this.punch(this.carrierB, 1.12);
                this.sfx.play('reveal');
                break;

            case 'LAND': {
                // 不放煙 —— 觸艦（DECK_TOUCH）那一下已經冒過了,
                // 這裡飛機早就停穩,再噴一次煙會像憑空冒出來
                //
                // 成功的收尾：一圈往外擴的光暈 + 目的艦被「壓」一下 + 倍數彈一下。
                // 全部是既有的 FX 語彙,沒有新的粒子,所以不會跟觸艦那一下打架
                this.shake = 0.8;
                this.pushFx('RING', screenX, waterScreenY + PHYS.DECK_Y + 20, 0.7, 26, 210,
                    this.cfg.hudAccent);
                this.punch(this.carrierB, 1.06);
                this.punch(this.balanceNode, 1.35);
                const m = s.finalBalance;
                const big = m >= 20;                 // 大獎門檻：字樣與 bigWin 音效共用同一條線
                const tag = m >= 80 ? 'SUPER MEGA WIN' : m >= 40 ? 'MEGA WIN' : big ? 'BIG WIN' : 'LAND!';
                this.showBigText(tag, big ? this.cfg.hudAccent : this.cfg.textColor);
                this.sfx.loop('engine', false);
                this.sfx.play('land');
                if (big) this.sfx.play('bigWin');    // 疊在 land 上面一起播
                break;
            }

            case 'DECK_TOUCH':
                // 觸艦：輪胎冒煙 + 火花,開始減速滑行
                this.pushFx('SMOKE', screenX, waterScreenY + PHYS.DECK_Y, 1.2, 14, 130,
                    new Color(255, 255, 255, 210));
                this.pushFx('SPRAY', screenX, waterScreenY + PHYS.DECK_Y, 0.5, 8, 90,
                    new Color(255, 214, 120, 255));
                this.shake = 0.7;
                this.sfx.play('deckTouch');
                break;

            case 'DECK_WOBBLE':
                // 半截機身已經懸在甲板外,開始搖晃 —— 這時還不知道會穩住還是掉下去
                this.showBigText('…', this.cfg.textColor);
                this.shake = Math.max(this.shake, 0.35);
                this.sfx.play('wobble');
                break;

            case 'SPLASH':
                this.sinking = 1;
                this.shake = 1;
                this.pushFx('RING', screenX, waterScreenY + 8, 0.8, 14, 190, this.cfg.foam);
                this.pushFx('SPRAY', screenX, waterScreenY + 10, 0.9, 8, 210, this.cfg.foam);
                this.targetBalance = 0;
                this.showBigText('SPLASH', new Color(255, 120, 120, 255));
                this.sfx.loop('engine', false);
                this.sfx.play('splash');
                break;
        }
    }

    /** 命中物件的消滅演出：撐大 → 收縮消失 */
    private consume(node: Node | undefined, big: boolean) {
        if (!node) return;
        Tween.stopAllByTarget(node);
        const op = node.getComponent(UIOpacity)!;
        tween(node)
            .to(0.07, { scale: new Vec3(big ? 1.8 : 1.45, big ? 1.8 : 1.45, 1) })
            .to(0.16, { scale: new Vec3(0.1, 0.1, 1) })
            .call(() => node.destroy())
            .start();
        tween(op).delay(0.07).to(0.16, { opacity: 0 }).start();
    }

    private punch(node: Node, k: number) {
        Tween.stopAllByTarget(node);
        node.setScale(1, 1, 1);
        tween(node)
            .to(0.07, { scale: new Vec3(k, k, 1) })
            .to(0.18, { scale: new Vec3(1, 1, 1) })
            .start();
    }

    private floatText(x: number, y: number, txt: string, col: Color, size: number) {
        const l = this.mkLabel(this.fxLayer, 'ft', size, col, true);
        l.node.getComponent(UITransform)!.setAnchorPoint(0.5, 0.5);
        l.string = txt;
        l.node.setPosition(x, y);
        const op = l.node.addComponent(UIOpacity);
        tween(l.node)
            .to(0.75, { position: new Vec3(x, y + 92, 0) }, { easing: 'quadOut' })
            .call(() => l.node.destroy())
            .start();
        tween(op).delay(0.32).to(0.42, { opacity: 0 }).start();
    }

    private showBigText(txt: string, col: Color) {
        this.bigTextNode.active = true;
        this.bigText.string = txt;
        this.bigText.color = col;
        this.bigTextNode.setScale(0.3, 0.3, 1);
        tween(this.bigTextNode)
            .to(0.22, { scale: new Vec3(1.14, 1.14, 1) }, { easing: 'backOut' })
            .to(0.14, { scale: new Vec3(1, 1, 1) })
            .start();
    }

    // ══════════════════════════════════════════════════════
    //  粒子/特效（單一 Graphics 全部畫完,不開節點）
    // ══════════════════════════════════════════════════════

    private pushFx(kind: Fx['kind'], x: number, y: number, dur: number,
        r0: number, r1: number, color: Color) {
        this.fx.push({ kind, x, y, t: 0, dur, r0, r1, color, seed: Math.random() * 100 });
    }

    private updateFx(dt: number) {
        const g = this.gFx;
        g.clear();
        for (let i = this.fx.length - 1; i >= 0; i--) {
            const f = this.fx[i];
            f.t += dt;
            const p = f.t / f.dur;
            if (p >= 1) { this.fx.splice(i, 1); continue; }
            const alpha = Math.round((1 - p) * 255);
            const r = f.r0 + (f.r1 - f.r0) * easeOut(p);

            switch (f.kind) {
                case 'RING':
                    g.strokeColor = new Color(f.color.r, f.color.g, f.color.b, alpha);
                    g.lineWidth = 6 * (1 - p) + 1;
                    g.circle(f.x, f.y, r); g.stroke();
                    break;
                case 'FLASH':
                    g.fillColor = new Color(f.color.r, f.color.g, f.color.b, Math.round(alpha * 0.55));
                    g.circle(f.x, f.y, r); g.fill();
                    break;
                case 'SPRAY':
                    g.strokeColor = new Color(f.color.r, f.color.g, f.color.b, alpha);
                    g.lineWidth = 3;
                    for (let k = 0; k < 12; k++) {
                        const a = (k / 12) * Math.PI * 2 + f.seed;
                        const rr = r * (0.55 + ((k * 37 + f.seed) % 10) / 18);
                        g.moveTo(f.x + Math.cos(a) * rr * 0.35, f.y + Math.sin(a) * rr * 0.35);
                        g.lineTo(f.x + Math.cos(a) * rr, f.y + Math.sin(a) * rr);
                    }
                    g.stroke();
                    break;
                case 'SMOKE':
                    for (let k = 0; k < 5; k++) {
                        const a = Math.round(alpha * (0.16 + k * 0.05));
                        g.fillColor = new Color(f.color.r, f.color.g, f.color.b, a);
                        g.circle(f.x - k * r * 0.45, f.y + Math.sin(k + f.seed) * 8, r * (0.5 + k * 0.16));
                        g.fill();
                    }
                    break;
            }
        }
    }
}

// ── 小工具 ──────────────────────────────────────────────────
function fmt(v: number) {
    if (v >= 100) return v.toFixed(0);
    if (v >= 10) return v.toFixed(1);
    return v.toFixed(2);
}
function easeOut(p: number) { return 1 - Math.pow(1 - p, 3); }
/** 長度讀數：小數字保留一位,大數字取整並加千分位 */
function fmtLen(v: number) {
    if (v < 10) return v.toFixed(1);
    return Math.round(v).toLocaleString('en-US');
}
/** 由整數種子產生穩定的 0..1（佈景船的位置/大小抖動用,每 frame 都算得出同一個值） */
function hash01(n: number) {
    let h = Math.imul(n ^ 0x9e3779b9, 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
