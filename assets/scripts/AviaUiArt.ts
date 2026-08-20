/**
 * AviaUiArt.ts — UI 的外觀 + **編輯器裡就看得到**
 *
 * 為什麼需要這個檔案：
 *
 * 版面節點（按鈕、面板、天空、太陽）本身只是空節點,外觀是執行期用 Graphics 畫的。
 * 編輯模式下沒人跑那段程式,所以 Scene 視窗裡只看得到一堆看不見的節點 ——
 * 位置要靠猜,等於白搬到場景上。
 *
 * 這個元件掛上去之後,**編輯器裡就會把外框、底板、天空、太陽畫出來**,
 * 所見即所得地拖。執行期 `AviaView` 用的是同一支 `drawUiBox()`,
 * 所以編輯器看到的長相跟跑起來一模一樣 —— 不會有兩套畫法各畫各的。
 *
 * 文字不在這裡畫（Graphics 畫不了字）—— 文字是節點自己的 `cc.Label`,
 * 場景裡就存著,所以編輯器也看得到;執行期 `AviaView` 會沿用同一個 Label,
 * 只換內容,不會多生一個。
 */

import { _decorator, Component, Graphics, Color, Enum, Label, UITransform } from 'cc';
import { EDITOR } from 'cc/env';

const { ccclass, property, executeInEditMode } = _decorator;

/** UI 元件的長相種類 */
export enum UiKind {
    Button = 0,     // 圓角外框（按鈕）
    Frame = 1,      // 圓角底板（面板底、下注器凹槽）
    Text = 2,       // 只有文字,不畫框
    Sky = 3,        // 天空漸層（編輯器裡當背景參考）
    Sun = 4,        // 太陽
    Sea = 5,        // 海面（編輯器裡當水平線參考）
}
Enum(UiKind);

export interface BoxStyle {
    fill?: Color;
    stroke?: Color;
    radius?: number;
    /** 選中狀態（亮底） */
    on?: boolean;
    /** 可按狀態。false = 整顆變淡 */
    enabled?: boolean;
    accent?: Color;
}

/**
 * 畫一顆按鈕／一塊底板。**執行期與編輯器共用這一支**。
 * 座標以節點原點為中心,所以節點錨點要設 (0.5, 0.5)。
 */
/**
 * 按鈕底色：**深色半透明**。
 *
 * 以前是白色 12% —— 天空是亮藍的,白底疊上去等於沒有底,字浮在背景上很難讀。
 * 改成深藍黑 65%：看得出是一顆按鈕,但還是透得出後面的畫面。
 */
const BTN_FILL = new Color(6, 16, 30, 166);
/** 按不動時：更透一點,但不要透到看不見（以前 alpha 26 幾乎等於消失） */
const BTN_FILL_OFF = new Color(6, 16, 30, 92);

export function drawUiBox(g: Graphics, w: number, h: number, s: BoxStyle = {}) {
    const r = s.radius ?? Math.min(12, h / 2);
    const accent = s.accent ?? new Color(255, 202, 70, 255);
    const on = s.on ?? false;
    const enabled = s.enabled ?? true;

    g.clear();
    const base = s.fill ?? (on ? accent : BTN_FILL);
    g.fillColor = enabled ? base
        : (s.fill ? new Color(base.r, base.g, base.b, Math.round(base.a * 0.5)) : BTN_FILL_OFF);
    g.roundRect(-w / 2, -h / 2, w, h, r);
    g.fill();
    g.strokeColor = s.stroke ?? (on ? new Color(255, 255, 255, 220) : new Color(255, 255, 255, 82));
    g.lineWidth = 2;
    g.roundRect(-w / 2, -h / 2, w, h, r);
    g.stroke();
}

/** 太陽：畫在節點原點上,縮放節點就是改大小 */
export function drawSun(g: Graphics) {
    g.clear();
    g.fillColor = new Color(255, 236, 190, 40);
    g.circle(0, 0, 110); g.fill();
    g.fillColor = new Color(255, 246, 214, 120);
    g.circle(0, 0, 58); g.fill();
}

@ccclass('AviaUiArt')
@executeInEditMode(true)
export class AviaUiArt extends Component {
    @property({ type: UiKind, tooltip: '這個節點長什麼樣。改完編輯器會立刻重畫' })
    kind: UiKind = UiKind.Button;

    @property({ tooltip: '關掉就不畫（換成自己的 Sprite 時用）' })
    drawDefaultArt = true;

    @property({ tooltip: '用選中狀態的樣子預覽（亮底）。只影響編輯器,執行期由程式決定' })
    previewOn = false;

    private lastW = -1;
    private lastH = -1;

    /**
     * ⚠ 這個元件**只在編輯器裡動作**。
     *
     * 執行期的外觀完全由 AviaView 負責（同一支 drawUiBox,所以長相一樣）。
     * 如果這裡也在跑,按鈕被打開的那一刻 onEnable 會用「沒選中」的樣子重畫一次,
     * 把程式剛設好的選中狀態蓋掉 —— 所以乾脆讓它在遊戲裡完全不出手。
     */
    onLoad() { if (EDITOR) this.redraw(); }
    onEnable() { if (EDITOR) this.redraw(); }

    /** 在編輯器裡拉 UITransform 的寬高時要跟著重畫,所以這裡盯著尺寸變化 */
    update() {
        if (!EDITOR) return;
        const ut = this.getComponent(UITransform);
        if (!ut) return;
        if (ut.width !== this.lastW || ut.height !== this.lastH) this.redraw();
    }

    redraw() {
        if (!this.drawDefaultArt) return;
        const ut = this.getComponent(UITransform);
        if (!ut) return;

        // ⚠ Cocos 一個節點只能掛一個 UIRenderer —— Graphics 與 Label 互斥。
        // Text 種類的節點文字就在自己身上,這裡碰 Graphics 會直接爆
        // 「conflicts with the existing cc.Label」。
        if (this.kind === UiKind.Text) return;
        if (this.getComponent(Label)) {
            console.warn(`[AviaUiArt] ${this.node.name} 上有 Label,`
                + '不能再畫外框（Graphics 與 Label 互斥）。文字請放到 label 子節點。');
            return;
        }
        const g = this.getComponent(Graphics) ?? this.addComponent(Graphics)!;
        this.lastW = ut.width;
        this.lastH = ut.height;

        switch (this.kind) {
            case UiKind.Button:
                drawUiBox(g, ut.width, ut.height, { on: this.previewOn });
                break;
            case UiKind.Frame:
                drawUiBox(g, ut.width, ut.height, {
                    fill: new Color(10, 22, 38, 242),
                    stroke: new Color(255, 255, 255, 46),
                    radius: 14,
                });
                break;
            case UiKind.Sun:
                drawSun(g);
                break;
            case UiKind.Sky:
                this.drawSkyPreview(g, ut.width, ut.height);
                break;
            case UiKind.Sea:
                this.drawSeaPreview(g, ut.width, ut.height);
                break;
            case UiKind.Text:
            default:
                g.clear();
                break;
        }
    }

    /**
     * 編輯器用的天空底色。執行期的天空會隨高度重新染色（AviaView.drawSky）,
     * 這裡只畫地面高度的那一版,當版面參考用。
     */
    private drawSkyPreview(g: Graphics, w: number, h: number) {
        g.clear();
        const top = new Color(38, 96, 168, 255);
        const bottom = new Color(150, 214, 236, 255);
        const bands = 24;
        for (let i = 0; i < bands; i++) {
            const a = i / (bands - 1);
            g.fillColor = new Color(
                Math.round(bottom.r + (top.r - bottom.r) * a),
                Math.round(bottom.g + (top.g - bottom.g) * a),
                Math.round(bottom.b + (top.b - bottom.b) * a), 255);
            g.rect(0, (h / bands) * i, w, h / bands + 1);
            g.fill();
        }
    }

    /** 編輯器用的水平線參考。執行期的海面有三層視差波浪,這裡只畫一條線 */
    private drawSeaPreview(g: Graphics, w: number, h: number) {
        g.clear();
        g.fillColor = new Color(18, 70, 122, 255);
        g.rect(0, 0, w, Math.min(110, h));
        g.fill();
        g.strokeColor = new Color(220, 246, 255, 190);
        g.lineWidth = 2;
        g.moveTo(0, Math.min(110, h));
        g.lineTo(w, Math.min(110, h));
        g.stroke();
    }
}
