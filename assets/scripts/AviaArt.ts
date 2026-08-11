/**
 * AviaArt.ts — 預設美術（純向量繪製）
 *
 * 這裡是所有物件外觀的單一來源。兩個地方會用到：
 *
 *   1. AviaView 直接呼叫 drawArt() —— 沒有指定 Prefab 時的預設外觀
 *   2. AviaVectorArt 元件把它掛在節點上 —— 讓這些外觀可以做成 Prefab
 *
 * 想換美術有兩條路：
 *   · 改這裡的畫法（全部一起換）
 *   · 在 AviaGame 的 ⑩ 物件 Prefab 指定自己的 Prefab（個別替換，不用動程式）
 */

import { _decorator, Component, Graphics, Color, Label, Node, UITransform, Layers, Enum } from 'cc';

const { ccclass, property, executeInEditMode } = _decorator;

/** 物件種類。Prefab 用這個標示自己是什麼，AviaView 也用它決定要畫哪一種。 */
export enum ArtKind {
    Plane = 0,
    Carrier = 1,        // 起飛艦（艦島在左）
    CarrierDest = 2,    // 目的艦（艦島在右 + 綠色降落導引燈）
    Pickup = 3,         // +N
    Boost = 4,          // ×N
    Rocket = 5,         // 飛彈（機首朝左）
}
Enum(ArtKind);

/** 畫圖用到的顏色。AviaView 會把 Inspector 的設定傳進來。 */
export interface ArtPalette {
    planeBody: Color; planeAccent: Color;
    pickup: Color; boost: Color; rocket: Color;
    carrier: Color; foam: Color;
    /** 空氣透視要染向的顏色（遠景船用），通常是天空色 */
    haze: Color;
}

export const DEFAULT_PALETTE: ArtPalette = {
    planeBody: new Color(242, 246, 252, 255),
    planeAccent: new Color(228, 84, 62, 255),
    pickup: new Color(92, 226, 200, 255),
    boost: new Color(255, 202, 70, 255),
    rocket: new Color(240, 78, 78, 255),
    carrier: new Color(126, 142, 160, 255),
    foam: new Color(220, 246, 255, 190),
    haze: new Color(150, 214, 236, 255),
};

/** 甲板面高度。AviaView 會在啟動時同步成 PHYS.DECK_Y。 */
export const ART = { DECK_Y: 130, CARRIER_HALF_W: 152 };

// ══════════════════════════════════════════════════════════════
//  飛機
// ══════════════════════════════════════════════════════════════

export function drawPlane(g: Graphics, p: ArtPalette) {
    // 機身
    g.fillColor = p.planeBody;
    g.moveTo(38, 0); g.lineTo(6, 12); g.lineTo(-32, 9);
    g.lineTo(-36, -6); g.lineTo(6, -10); g.close(); g.fill();
    // 主翼（上下各一）
    g.fillColor = p.planeAccent;
    g.moveTo(6, 2); g.lineTo(-16, -22); g.lineTo(-2, -22); g.lineTo(14, -1); g.close(); g.fill();
    g.moveTo(6, 2); g.lineTo(-14, 20); g.lineTo(0, 20); g.lineTo(14, 3); g.close(); g.fill();
    // 尾翼
    g.moveTo(-30, 6); g.lineTo(-40, 26); g.lineTo(-24, 12); g.close(); g.fill();
    // 座艙罩
    g.fillColor = new Color(150, 225, 255, 235);
    g.circle(12, 6, 7); g.fill();
}

// ══════════════════════════════════════════════════════════════
//  物件（+N / ×N / 飛彈）
// ══════════════════════════════════════════════════════════════

export function drawPickup(g: Graphics, p: ArtPalette) { drawToken(g, p.pickup, false); }
export function drawBoost(g: Graphics, p: ArtPalette) { drawToken(g, p.boost, true); }

function drawToken(g: Graphics, col: Color, hexagon: boolean) {
    g.fillColor = new Color(col.r, col.g, col.b, 55);       // 外圈光暈
    g.circle(0, 0, 36); g.fill();
    g.fillColor = col;
    if (hexagon) {
        for (let i = 0; i < 6; i++) {
            const a = (Math.PI / 3) * i - Math.PI / 6;
            const x = Math.cos(a) * 28, y = Math.sin(a) * 28;
            if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.close(); g.fill();
    } else {
        g.circle(0, 0, 26); g.fill();
    }
    g.strokeColor = new Color(255, 255, 255, 210);
    g.lineWidth = 3;
    g.circle(0, 0, hexagon ? 30 : 27); g.stroke();
}

/** 飛彈。機首朝左 —— 它是從畫面右側往左飛過來的。 */
export function drawRocket(g: Graphics, p: ArtPalette) {
    const c = p.rocket;
    g.fillColor = new Color(c.r, c.g, c.b, 70);
    g.circle(0, 0, 34); g.fill();
    g.fillColor = c;
    g.moveTo(-26, 0); g.lineTo(-2, 11); g.lineTo(22, 8);
    g.lineTo(22, -8); g.lineTo(-2, -11); g.close(); g.fill();
    // 尾鰭
    g.fillColor = new Color(Math.round(c.r * 0.7), 40, 40, 255);
    g.moveTo(22, 8); g.lineTo(30, 18); g.lineTo(30, 2); g.close(); g.fill();
    g.moveTo(22, -8); g.lineTo(30, -18); g.lineTo(30, -2); g.close(); g.fill();
    // 尾焰在右邊（因為往左飛）
    g.fillColor = new Color(255, 220, 120, 255);
    g.moveTo(24, 6); g.lineTo(46, 0); g.lineTo(24, -6); g.close(); g.fill();
    g.fillColor = new Color(255, 150, 60, 190);
    g.moveTo(30, 4); g.lineTo(62, 0); g.lineTo(30, -4); g.close(); g.fill();
}

// ══════════════════════════════════════════════════════════════
//  航母
// ══════════════════════════════════════════════════════════════

/**
 * 甲板面剛好落在 ART.DECK_Y，所以飛機是真的停在甲板上起飛與降落。
 * @param cx,cy 水線位置（局部座標）
 * @param s     縮放
 * @param haze  0..1 空氣透視，越大越往 palette.haze 淡去
 */
export function drawCarrier(
    g: Graphics, p: ArtPalette, cx: number, cy: number, s: number,
    haze: number, destination: boolean,
) {
    const fade = (c: Color, k = 1) => new Color(
        Math.round(c.r + (p.haze.r - c.r) * haze * k),
        Math.round(c.g + (p.haze.g - c.g) * haze * k),
        Math.round(c.b + (p.haze.b - c.b) * haze * k), 255);

    const base = p.carrier;
    const col = fade(base);
    const dark = fade(new Color(Math.round(base.r * 0.55), Math.round(base.g * 0.55), Math.round(base.b * 0.6), 255));
    const mid = fade(new Color(Math.round(base.r * 0.78), Math.round(base.g * 0.78), Math.round(base.b * 0.82), 255));

    const HW = ART.CARRIER_HALF_W;
    const D = ART.DECK_Y * s;
    const deckH = 20 * s;
    const hullTop = D - deckH;
    const X = (v: number) => cx + v * s;
    const Y = (v: number) => cy + v;

    // 船身
    g.fillColor = dark;
    g.moveTo(X(-HW), Y(hullTop)); g.lineTo(X(HW), Y(hullTop));
    g.lineTo(X(HW * 0.82), Y(-34 * s)); g.lineTo(X(-HW * 0.78), Y(-34 * s));
    g.close(); g.fill();
    // 上半段亮一階，做出量體
    const bandH = Math.min(46 * s, hullTop * 0.45);
    g.fillColor = mid;
    g.rect(X(-HW), Y(hullTop - bandH), HW * 2 * s, bandH); g.fill();
    // 舷側開口
    if (s > 0.5) {
        g.fillColor = fade(new Color(18, 26, 38, 255));
        for (let x = -120; x < 120; x += 42) g.rect(X(x), Y(hullTop - 34 * s), 22 * s, 12 * s);
        g.fill();
    }

    // 甲板
    g.fillColor = col;
    g.rect(X(-HW), Y(hullTop), HW * 2 * s, deckH); g.fill();
    g.strokeColor = new Color(255, 255, 255, Math.round(95 * (1 - haze)));
    g.lineWidth = 3 * s;
    for (let x = -134; x < 134; x += 34) {
        g.moveTo(X(x), Y(hullTop + deckH / 2)); g.lineTo(X(x + 18), Y(hullTop + deckH / 2));
    }
    g.stroke();

    // 艦島（起飛艦在左、目的艦在右，才不會擋住降落點）
    const ix = destination ? 64 : -120;
    g.fillColor = dark;
    g.rect(X(ix), Y(D), 48 * s, 46 * s); g.fill();
    g.fillColor = fade(new Color(255, 210, 90, 255), 0.8);
    g.rect(X(ix + 8), Y(D + 26 * s), 32 * s, 8 * s); g.fill();
    g.strokeColor = dark; g.lineWidth = 3 * s;
    g.moveTo(X(ix + 24), Y(D + 46 * s)); g.lineTo(X(ix + 24), Y(D + 74 * s)); g.stroke();

    // 目的艦：降落導引燈
    if (destination) {
        g.fillColor = new Color(120, 255, 180, 220);
        for (let x = -140; x < 40; x += 30) { g.circle(X(x), Y(D + 6 * s), 4 * s); }
        g.fill();
    }

    // 吃水線泡沫
    g.strokeColor = new Color(p.foam.r, p.foam.g, p.foam.b, Math.round(p.foam.a * (1 - haze * 0.7)));
    g.lineWidth = 4 * s;
    g.moveTo(X(-HW - 8), Y(2 * s)); g.lineTo(X(HW + 8), Y(2 * s)); g.stroke();
}

// ══════════════════════════════════════════════════════════════
//  統一入口
// ══════════════════════════════════════════════════════════════

/** 把某一種物件的預設美術畫進 g（局部座標，原點 = 物件中心；航母的原點 = 水線） */
export function drawArt(g: Graphics, kind: ArtKind, p: ArtPalette = DEFAULT_PALETTE) {
    g.clear();
    switch (kind) {
        case ArtKind.Plane: drawPlane(g, p); break;
        case ArtKind.Pickup: drawPickup(g, p); break;
        case ArtKind.Boost: drawBoost(g, p); break;
        case ArtKind.Rocket: drawRocket(g, p); break;
        case ArtKind.Carrier: drawCarrier(g, p, 0, 0, 1, 0, false); break;
        case ArtKind.CarrierDest: drawCarrier(g, p, 0, 0, 1, 0, true); break;
    }
}

/** 各種物件的節點尺寸（給 UITransform 用，也決定觸控範圍） */
export const ART_SIZE: Record<number, [number, number]> = {
    [ArtKind.Plane]: [90, 60],
    [ArtKind.Carrier]: [330, 240],
    [ArtKind.CarrierDest]: [330, 240],
    [ArtKind.Pickup]: [72, 72],
    [ArtKind.Boost]: [72, 72],
    [ArtKind.Rocket]: [130, 72],
};

// ══════════════════════════════════════════════════════════════
//  可掛在 Prefab 上的元件
// ══════════════════════════════════════════════════════════════

/**
 * 把預設美術掛成一個元件 —— 這樣它就能被做成 Prefab。
 *
 * 預設的 6 個 Prefab（assets/prefabs/）都只是「一個節點 + 這個元件」。
 * 你可以：
 *   · 直接編輯 Prefab，把這個元件換成 Sprite / Spine，外觀立刻換掉
 *   · 或保留它，只改 kind / 顏色
 *
 * +N 與 ×N 的數字由 AviaView 在生成時寫進名為 "value" 的 Label 子節點；
 * 找不到那個子節點就不寫（純圖片的 Prefab 不會出錯）。
 */
@ccclass('AviaVectorArt')
@executeInEditMode(true)
export class AviaVectorArt extends Component {
    @property({ type: ArtKind, tooltip: '這個 Prefab 代表哪一種物件' })
    kind: ArtKind = ArtKind.Pickup;

    @property({ tooltip: '關掉就不畫預設向量美術（換成自己的 Sprite 時用）' })
    drawDefaultArt = true;

    onLoad() { this.redraw(); }

    redraw() {
        if (!this.drawDefaultArt) return;
        const g = this.getComponent(Graphics) ?? this.addComponent(Graphics)!;
        drawArt(g, this.kind);
    }
}

/** 在 value 子節點上寫數字（+2 / ×3）。沒有那個子節點就安靜跳過。 */
export function setTokenLabel(node: Node, text: string) {
    const l = node.getChildByName('value')?.getComponent(Label)
        ?? node.getComponentInChildren(Label);
    if (l) l.string = text;
}

/** 建一個掛好預設美術的節點（沒有指定 Prefab 時走這條） */
export function makeArtNode(name: string, kind: ArtKind, palette: ArtPalette): Node {
    const n = new Node(name);
    n.layer = Layers.Enum.UI_2D;
    const [w, h] = ART_SIZE[kind] ?? [72, 72];
    const ut = n.addComponent(UITransform);
    ut.setAnchorPoint(0.5, 0.5);
    ut.setContentSize(w, h);
    drawArt(n.addComponent(Graphics), kind, palette);
    return n;
}
