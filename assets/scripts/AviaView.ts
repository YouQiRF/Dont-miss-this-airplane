/**
 * AviaView.ts — 畫面表演層
 *
 * 全部用 Graphics 向量繪製,不需要任何美術素材,匯入就能跑。
 * 這一層完全不認識「倍數」「結果」這些概念,它只消費 PerformanceScript。
 */

import { Node, Graphics, Label, UITransform, Color, Vec3, tween, Tween, Layers, UIOpacity } from 'cc';
import { PHYS } from './AviaPath';
import type { Beat, Frame, ObjKind, PerformanceScript } from './AviaPath';

export interface ViewConfig {
    W: number; H: number;
    waterScreenY: number;      // 水面在螢幕上的高度（距底部 px）
    planeScreenXRatio: number; // 飛機固定在螢幕寬度的幾成位置
    pxPerTick: number;

    camFollowStart: number;    // 飛機超過畫面高度的幾成時鏡頭開始跟
    camLag: number;            // 鏡頭跟隨速度（每秒收斂倍率）

    skyTop: Color; skyBottom: Color;
    skyHigh: Color;            // 高空時天空漸層要染向的顏色
    seaDeep: Color; seaLight: Color; foam: Color;
    planeBody: Color; planeAccent: Color; trailColor: Color;
    pickupColor: Color; boostColor: Color; rocketColor: Color;
    hudColor: Color; hudAccent: Color; textColor: Color;
    carrierColor: Color;

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
    private gClouds!: Graphics;
    private gSeaBack!: Graphics;
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
    private camRoot!: Node;
    private camY = 0;
    private skyDrawnAt = -9999;
    private shake = 0;
    private clock = 0;
    private shownBalance = 1;
    private targetBalance = 1;
    private sinking = 0;

    constructor(root: Node, cfg: ViewConfig) {
        this.cfg = cfg;
        this.build(root);
    }

    // ══════════════════════════════════════════════════════
    //  建構節點樹
    // ══════════════════════════════════════════════════════

    private mk(parent: Node, name: string, w?: number, h?: number): Node {
        const n = new Node(name);
        n.layer = Layers.Enum.UI_2D;
        const ut = n.addComponent(UITransform);
        ut.setAnchorPoint(0, 0);
        ut.setContentSize(w ?? this.cfg.W, h ?? this.cfg.H);
        parent.addChild(n);
        return n;
    }

    private mkGraphics(parent: Node, name: string): Graphics {
        return this.mk(parent, name).addComponent(Graphics);
    }

    private mkLabel(parent: Node, name: string, size: number, color: Color, bold = false): Label {
        const n = this.mk(parent, name, 400, size * 1.6);
        const l = n.addComponent(Label);
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

        // stage：把原點搬到左下角,並且是螢幕震動的施力點
        this.stage = new Node('stage');
        this.stage.layer = Layers.Enum.UI_2D;
        this.stage.addComponent(UITransform).setContentSize(W, H);
        this.stage.setPosition(-W / 2, -H / 2);
        root.addChild(this.stage);

        // 天空與雲固定在螢幕上（雲自己做視差）,其餘全部掛在 camRoot 底下由鏡頭帶動
        this.gSky = this.mkGraphics(this.stage, 'sky');
        this.gClouds = this.mkGraphics(this.stage, 'clouds');

        this.camRoot = this.mk(this.stage, 'camRoot');
        this.gSeaBack = this.mkGraphics(this.camRoot, 'seaBack');

        this.world = this.mk(this.camRoot, 'world');
        this.carrierA = this.mk(this.world, 'carrierStart', 300, 200);
        this.carrierB = this.mk(this.world, 'carrierEnd', 300, 200);
        this.drawCarrier(this.carrierA.addComponent(Graphics), false);
        this.drawCarrier(this.carrierB.addComponent(Graphics), true);
        this.gDebug = this.mkGraphics(this.world, 'debugPath');
        this.gTrail = this.mkGraphics(this.world, 'trail');
        this.objLayer = this.mk(this.world, 'objects');

        this.plane = this.mk(this.world, 'plane', 90, 60);
        this.plane.getComponent(UITransform)!.setAnchorPoint(0.5, 0.5);
        this.gPlane = this.plane.addComponent(Graphics);
        this.drawPlane(this.gPlane);

        this.balanceNode = this.mk(this.world, 'balance', 220, 46);
        this.balanceNode.getComponent(UITransform)!.setAnchorPoint(0.5, 0.5);
        this.balanceLabel = this.mkLabel(this.balanceNode, 'txt', 30, this.cfg.textColor, true);
        this.balanceLabel.node.getComponent(UITransform)!.setAnchorPoint(0.5, 0.5);
        this.balanceLabel.node.setPosition(0, 0);

        this.gSeaFront = this.mkGraphics(this.camRoot, 'seaFront');
        this.fxLayer = this.mk(this.camRoot, 'fxLayer');
        this.gFx = this.mkGraphics(this.camRoot, 'fx');

        // HUD
        const hud = this.mk(this.stage, 'hud');
        this.gHud = hud.addComponent(Graphics);
        this.hudDist = this.mkLabel(hud, 'dist', 20, this.cfg.hudColor);
        this.hudDist.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
        this.hudDist.horizontalAlign = Label.HorizontalAlign.LEFT;
        this.hudDist.node.setPosition(36, H - 42);

        this.hudAlt = this.mkLabel(hud, 'alt', 20, this.cfg.hudColor);
        this.hudAlt.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
        this.hudAlt.horizontalAlign = Label.HorizontalAlign.LEFT;
        this.hudAlt.node.setPosition(36, H - 76);

        this.hudMult = this.mkLabel(hud, 'mult', 40, this.cfg.hudAccent, true);
        this.hudMult.node.getComponent(UITransform)!.setAnchorPoint(0.5, 0.5);
        this.hudMult.node.setPosition(W / 2, H - 56);

        this.bigTextNode = this.mk(this.stage, 'bigText', 900, 140);
        this.bigTextNode.getComponent(UITransform)!.setAnchorPoint(0.5, 0.5);
        this.bigTextNode.setPosition(W / 2, H * 0.62);
        this.bigText = this.mkLabel(this.bigTextNode, 'txt', 96, this.cfg.textColor, true);
        this.bigText.node.getComponent(UITransform)!.setAnchorPoint(0.5, 0.5);
        this.bigText.node.setPosition(0, 0);
        this.bigTextNode.active = false;

        this.uiLayer = this.mk(this.stage, 'ui');

        this.drawSky(0);
    }

    // ══════════════════════════════════════════════════════
    //  UI 元件工廠（AviaGame 拿去組下注面板 / 速度鈕 / Spin）
    // ══════════════════════════════════════════════════════

    createText(x: number, y: number, size: number, color: Color,
        align: 'left' | 'center' | 'right' = 'left', bold = false): Label {
        const l = this.mkLabel(this.uiLayer, 'txt', size, color, bold);
        const ut = l.node.getComponent(UITransform)!;
        ut.setAnchorPoint(align === 'left' ? 0 : align === 'right' ? 1 : 0.5, 0.5);
        l.horizontalAlign = align === 'left' ? Label.HorizontalAlign.LEFT
            : align === 'right' ? Label.HorizontalAlign.RIGHT : Label.HorizontalAlign.CENTER;
        l.node.setPosition(x, y);
        return l;
    }

    createButton(x: number, y: number, w: number, h: number, text: string,
        fontSize: number, onClick: () => void): UiButton {
        const n = this.mk(this.uiLayer, 'btn', w, h);
        n.getComponent(UITransform)!.setAnchorPoint(0.5, 0.5);
        n.setPosition(x, y);
        const g = n.addComponent(Graphics);
        const l = this.mkLabel(n, 'label', fontSize, this.cfg.textColor, true);
        l.node.getComponent(UITransform)!.setAnchorPoint(0.5, 0.5);
        l.node.setPosition(0, 0);
        l.string = text;

        const st = { on: false, enabled: true };
        const paint = () => {
            g.clear();
            const base = st.on ? this.cfg.hudAccent : new Color(255, 255, 255, 32);
            g.fillColor = st.enabled ? base : new Color(base.r, base.g, base.b, 26);
            g.roundRect(-w / 2, -h / 2, w, h, Math.min(12, h / 2)); g.fill();
            g.strokeColor = st.on ? new Color(255, 255, 255, 220) : new Color(255, 255, 255, 70);
            g.lineWidth = 2;
            g.roundRect(-w / 2, -h / 2, w, h, Math.min(12, h / 2)); g.stroke();
            l.color = st.enabled
                ? (st.on ? new Color(20, 28, 40, 255) : this.cfg.textColor)
                : new Color(this.cfg.textColor.r, this.cfg.textColor.g, this.cfg.textColor.b, 90);
        };
        paint();

        n.on(Node.EventType.TOUCH_END, () => {
            if (!st.enabled) return;
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
        // 太陽（隨鏡頭緩慢下沉）
        const sunY = H * 0.80 - camY * 0.12;
        g.fillColor = new Color(255, 236, 190, 40);
        g.circle(W * 0.78, sunY, 110); g.fill();
        g.fillColor = new Color(255, 246, 214, 120);
        g.circle(W * 0.78, sunY, 58); g.fill();
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

    private drawCarrier(g: Graphics, destination: boolean) {
        const c = this.cfg.carrierColor;
        const dark = new Color(Math.round(c.r * 0.55), Math.round(c.g * 0.55), Math.round(c.b * 0.6), 255);
        // 船體
        g.fillColor = dark;
        g.moveTo(-150, 0); g.lineTo(150, 0); g.lineTo(120, -52); g.lineTo(-118, -52);
        g.close(); g.fill();
        // 甲板
        g.fillColor = c;
        g.rect(-150, 0, 300, 16); g.fill();
        // 甲板中線
        g.strokeColor = new Color(255, 255, 255, 90);
        g.lineWidth = 3;
        for (let x = -132; x < 132; x += 34) { g.moveTo(x, 8); g.lineTo(x + 18, 8); }
        g.stroke();
        // 艦島
        g.fillColor = dark;
        g.rect(destination ? 62 : -118, 16, 46, 44); g.fill();
        g.fillColor = new Color(255, 210, 90, 255);
        g.rect(destination ? 70 : -110, 40, 30, 8); g.fill();
        // 目的艦：閃爍導引燈桿
        if (destination) {
            g.strokeColor = new Color(120, 255, 180, 200);
            g.lineWidth = 4;
            g.moveTo(-150, 16); g.lineTo(-150, 90); g.stroke();
        }
    }

    private drawPlane(g: Graphics) {
        const { planeBody, planeAccent } = this.cfg;
        g.clear();
        // 機身
        g.fillColor = planeBody;
        g.moveTo(38, 0); g.lineTo(6, 12); g.lineTo(-32, 9);
        g.lineTo(-36, -6); g.lineTo(6, -10); g.close(); g.fill();
        // 主翼
        g.fillColor = planeAccent;
        g.moveTo(6, 2); g.lineTo(-16, -22); g.lineTo(-2, -22); g.lineTo(14, -1); g.close(); g.fill();
        g.moveTo(6, 2); g.lineTo(-14, 20); g.lineTo(0, 20); g.lineTo(14, 3); g.close(); g.fill();
        // 尾翼
        g.fillColor = planeAccent;
        g.moveTo(-30, 6); g.lineTo(-40, 26); g.lineTo(-24, 12); g.close(); g.fill();
        // 座艙罩
        g.fillColor = new Color(150, 225, 255, 235);
        g.circle(12, 6, 7); g.fill();
    }

    private drawObject(g: Graphics, kind: ObjKind) {
        const { pickupColor, boostColor, rocketColor } = this.cfg;
        g.clear();
        if (kind.kind === 'ROCKET') {
            g.fillColor = new Color(rocketColor.r, rocketColor.g, rocketColor.b, 70);
            g.circle(0, 0, 34); g.fill();
            g.fillColor = rocketColor;
            g.moveTo(24, 0); g.lineTo(2, 11); g.lineTo(-22, 8);
            g.lineTo(-22, -8); g.lineTo(2, -11); g.close(); g.fill();
            g.fillColor = new Color(255, 220, 120, 255);
            g.moveTo(-22, 5); g.lineTo(-38, 0); g.lineTo(-22, -5); g.close(); g.fill();
            return;
        }
        const col = kind.kind === 'BOOST' ? boostColor : pickupColor;
        g.fillColor = new Color(col.r, col.g, col.b, 55);
        g.circle(0, 0, 36); g.fill();
        if (kind.kind === 'BOOST') {                       // 六邊形
            g.fillColor = col;
            for (let i = 0; i < 6; i++) {
                const a = (Math.PI / 3) * i - Math.PI / 6;
                const x = Math.cos(a) * 28, y = Math.sin(a) * 28;
                if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
            }
            g.close(); g.fill();
        } else {                                           // 圓形
            g.fillColor = col;
            g.circle(0, 0, 26); g.fill();
        }
        g.strokeColor = new Color(255, 255, 255, 210);
        g.lineWidth = 3;
        g.circle(0, 0, kind.kind === 'BOOST' ? 30 : 27); g.stroke();
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

        const { pxPerTick, waterScreenY } = this.cfg;

        for (const o of script.objects) {
            const n = this.mk(this.objLayer, `o${o.id}`, 72, 72);
            n.getComponent(UITransform)!.setAnchorPoint(0.5, 0.5);
            const g = n.addComponent(Graphics);
            this.drawObject(g, o.kind);
            n.setPosition(o.tick * pxPerTick, waterScreenY + o.y);
            n.addComponent(UIOpacity).opacity = o.hit ? 255 : 205;

            if (o.kind.kind !== 'ROCKET') {
                const l = this.mkLabel(n, 'v', 26, new Color(20, 32, 48, 255), true);
                l.node.getComponent(UITransform)!.setAnchorPoint(0.5, 0.5);
                l.node.setPosition(0, 0);
                l.string = o.kind.kind === 'BOOST' ? `×${o.kind.value}` : `+${o.kind.value}`;
            }
            this.objNodes.set(o.id, n);
        }

        this.carrierA.setPosition(0, waterScreenY);
        this.carrierB.setPosition(script.carrierTick * pxPerTick, waterScreenY);

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
        this.carrierB.setPosition(30 * pxPerTick, waterScreenY);
    }

    /** 待機時飛機停在起飛甲板上輕微浮動 */
    idleFrame(clock: number): Frame {
        return {
            tick: 0,
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

        // 世界捲動（水平）
        const planeWorldX = t * pxPerTick;
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

        // 天空只在鏡頭有明顯移動時重畫（28 條色帶,不必每 frame 重來）
        if (Math.abs(this.camY - this.skyDrawnAt) > 4) {
            this.skyDrawnAt = this.camY;
            this.drawSky(this.camY);
        }
        this.drawClouds(scroll, this.camY);
        this.drawSea(scroll);
        this.updateFx(dt);
        if (s && playing) {
            this.drawHud(t, frame, s);
        } else {
            this.gHud.clear();
            this.hudMult.string = '';
            this.hudDist.string = '距離  ——';
            this.hudAlt.string = '高度  ——';
        }

        // 螢幕震動
        if (this.shake > 0) {
            this.shake = Math.max(0, this.shake - dt * 3.2);
            const k = this.shake * this.cfg.shakeIntensity;
            this.stage.setPosition(
                -W / 2 + (Math.random() - 0.5) * k,
                -H / 2 + (Math.random() - 0.5) * k);
        } else {
            this.stage.setPosition(-W / 2, -H / 2);
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

    /** 雲：水平視差 + 垂直視差,而且垂直方向會循環 → 一直往上飛也永遠有雲 */
    private drawClouds(scroll: number, camY: number) {
        const { W, H } = this.cfg;
        const g = this.gClouds;
        const bandH = H * 1.7;
        g.clear();
        g.fillColor = new Color(255, 255, 255, 46);
        for (let i = 0; i < 12; i++) {
            const x = mod(i * 431.7 + scroll * 0.12, W + 460) - 230;
            const y = mod(i * 263.1 - camY * 0.45, bandH) - H * 0.18;
            const r = 30 + (i % 4) * 15;
            g.circle(x, y, r); g.fill();
            g.circle(x + r * 0.9, y - r * 0.25, r * 0.75); g.fill();
            g.circle(x - r * 0.85, y - r * 0.3, r * 0.62); g.fill();
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
        const dist = Math.min(1, t / Math.max(1, s.carrierTick));
        const alt = Math.max(0, Math.min(1, frame.y / PHYS.ALT_DISPLAY_MAX));
        bar(126, H - 47, 230, dist, hudAccent);
        bar(126, H - 81, 230, alt, hudColor);

        this.hudDist.string = `距離 ${Math.round(dist * 100)}%`;
        this.hudAlt.string = `高度 ${Math.round(frame.y)}`;
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
                break;

            case 'NEAR_MISS':
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
                break;

            case 'LAND': {
                this.pushFx('SMOKE', screenX, waterScreenY + PHYS.DECK_Y, 0.9, 18, 130,
                    new Color(255, 255, 255, 210));
                this.shake = 0.8;
                const m = s.finalBalance;
                const tag = m >= 80 ? 'SUPER MEGA WIN' : m >= 40 ? 'MEGA WIN' : m >= 20 ? 'BIG WIN' : 'LAND!';
                this.showBigText(tag, m >= 20 ? this.cfg.hudAccent : this.cfg.textColor);
                break;
            }

            case 'SPLASH':
                this.sinking = 1;
                this.shake = 1;
                this.pushFx('RING', screenX, waterScreenY + 8, 0.8, 14, 190, this.cfg.foam);
                this.pushFx('SPRAY', screenX, waterScreenY + 10, 0.9, 8, 210, this.cfg.foam);
                this.targetBalance = 0;
                this.showBigText('SPLASH', new Color(255, 120, 120, 255));
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
function mod(a: number, n: number) { return ((a % n) + n) % n; }
