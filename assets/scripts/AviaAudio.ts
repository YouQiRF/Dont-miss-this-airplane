/**
 * AviaAudio.ts — 音效層
 *
 * 跟 AviaArt 一樣的原則：**什麼都不掛也能跑**。
 * 每一個欄位留空 = 那個事件靜音,不會報錯、也不會在 Console 洗訊息 ——
 * 所以現在（還沒有音檔）就可以先把線接好,音檔到位再一格一格拉進 Inspector。
 *
 * 節點結構（AviaGame 啟動時自動生在 GameRoot 底下,不用手動建）：
 *
 *   GameRoot
 *     └ audio
 *         ├ sfx        一次性音效,全部走 playOneShot,可以互相疊
 *         ├ engine     引擎循環：起飛開,降落／落海關
 *         ├ ambience   環境音循環：開場就播,一直播
 *         └ bgm        背景音樂循環：同上
 *
 * 音量算法：**實際音量 = 主音量 × 分類音量 × 呼叫端的 volumeScale**（夾在 0–1）。
 * 靜音只是把實際音量算成 0,循環音不會被停掉 —— 取消靜音就直接接回去,不會從頭播。
 *
 * ⚠ 瀏覽器規定第一次出聲必須發生在使用者操作之後。
 *   這個遊戲的第一個聲音是按鈕音（click / spin）,本來就在點擊事件裡,所以不會被擋。
 *   BGM 也是在第一次按鈕之後才真的響（見 AviaGame.start() 的註解）。
 */

import { AudioClip, AudioSource, Node } from 'cc';

/**
 * 一次性音效。每一個 key 對應 AviaGame Inspector「⑩ 音效」的一個 AudioClip 欄位。
 *
 *   click      任何按鈕（籌碼與 SPIN 除外,它們有自己的音）
 *   bet        改下注額
 *   spin       真的開了一局（餘額不足按不動時不會響）
 *   autoStart  自動下注開始
 *   autoStop   自動下注結束（含達成停止條件而自己停）
 *   takeoff    起飛
 *   pickup     吃到 +N
 *   boost      吃到 ×N
 *   rocket     被飛彈打到 ÷N
 *   nearMiss   擦身而過的誘餌（會連發,靠 minGapMs 節流）
 *   reveal     目的艦進場（結局揭曉前的那一下）
 *   deckTouch  輪胎觸艦,開始減速滑行
 *   wobble     半截機身懸在甲板外開始搖晃（結局未定的張力點）
 *   land       降落成功
 *   bigWin     降落成功且倍數夠大時,疊在 land 上面一起播
 *   splash     墜海
 */
export type SfxKey =
    | 'click' | 'bet' | 'spin' | 'autoStart' | 'autoStop'
    | 'takeoff' | 'pickup' | 'boost' | 'rocket' | 'nearMiss'
    | 'reveal' | 'deckTouch' | 'wobble' | 'land' | 'bigWin' | 'splash';

/** 循環音。engine 由起飛／降落自動開關,ambience 與 bgm 開場就一直播。 */
export type LoopKey = 'engine' | 'ambience' | 'bgm';

export const SFX_KEYS: SfxKey[] = [
    'click', 'bet', 'spin', 'autoStart', 'autoStop',
    'takeoff', 'pickup', 'boost', 'rocket', 'nearMiss',
    'reveal', 'deckTouch', 'wobble', 'land', 'bigWin', 'splash',
];

export const LOOP_KEYS: LoopKey[] = ['engine', 'ambience', 'bgm'];

/**
 * 表演層看到的音效介面。
 * AviaView 只認得這個,不認得 AudioSource —— 換播放方式（例如接第三方音訊引擎）
 * 只要換掉實作,表演層一行都不用動。
 */
export interface AudioHooks {
    play(key: SfxKey, volumeScale?: number): void;
    loop(key: LoopKey, on: boolean): void;
}

/** 沒有音效層時用這個,呼叫端就不必到處判斷 null。 */
export const SILENT_AUDIO: AudioHooks = { play() { }, loop() { } };

export interface AudioConfig {
    sfx: Partial<Record<SfxKey, AudioClip | null>>;
    loops: Partial<Record<LoopKey, AudioClip | null>>;
    master: number;
    sfxVolume: number;
    engineVolume: number;
    ambienceVolume: number;
    bgmVolume: number;
    muted: boolean;
    /** 同一顆音效的最短間隔（ms）。連發時只留第一下,避免疊成噪音。0 = 不節流 */
    minGapMs: number;
}

const clamp01 = (v: number) => v < 0 ? 0 : v > 1 ? 1 : v;

export class AviaAudio implements AudioHooks {
    private cfg: AudioConfig;
    private root: Node;
    private sfxSrc: AudioSource;
    private loopSrc: Record<LoopKey, AudioSource>;
    /** 循環音「應該要在播」的狀態。跟實際有沒有音檔無關 —— 之後補上音檔就會自己接上。 */
    private loopOn: Record<LoopKey, boolean> = { engine: false, ambience: false, bgm: false };
    private lastAt = new Map<SfxKey, number>();

    constructor(parent: Node, cfg: AudioConfig) {
        this.cfg = cfg;
        this.root = new Node('audio');
        this.root.layer = parent.layer;
        parent.addChild(this.root);

        this.sfxSrc = this.mkSource('sfx', false);
        this.loopSrc = {
            engine: this.mkSource('engine', true),
            ambience: this.mkSource('ambience', true),
            bgm: this.mkSource('bgm', true),
        };
        this.configure(cfg);
    }

    private mkSource(name: string, loop: boolean): AudioSource {
        const n = new Node(name);
        n.layer = this.root.layer;
        this.root.addChild(n);
        const s = n.addComponent(AudioSource);
        s.playOnAwake = false;
        s.loop = loop;
        s.volume = 1;      // 一次性音效的音量走 playOneShot 的 volumeScale,來源固定 1
        return s;
    }

    /**
     * 套用新的設定。AviaGame.pushConfig() 每局都會呼叫一次,
     * 所以執行期在 Inspector 拉音量、換音檔都會即時生效。
     */
    configure(cfg: AudioConfig) {
        this.cfg = cfg;
        for (const k of LOOP_KEYS) {
            const src = this.loopSrc[k];
            const clip = cfg.loops[k] ?? null;
            if (src.clip !== clip) {
                // 換了音檔就重接。本來就該在播的,接完立刻續播
                src.stop();
                src.clip = clip;
                if (this.loopOn[k] && clip) src.play();
            }
            src.volume = this.loopVolume(k);
        }
    }

    private loopVolume(k: LoopKey) {
        if (this.cfg.muted) return 0;
        const per = k === 'engine' ? this.cfg.engineVolume
            : k === 'ambience' ? this.cfg.ambienceVolume
                : this.cfg.bgmVolume;
        return clamp01(this.cfg.master * per);
    }

    // ── AudioHooks ──────────────────────────────────────────

    play(key: SfxKey, volumeScale = 1) {
        const clip = this.cfg.sfx[key];
        if (!clip || this.cfg.muted) return;

        const vol = clamp01(this.cfg.master * this.cfg.sfxVolume * volumeScale);
        if (vol <= 0) return;

        const gap = this.cfg.minGapMs;
        if (gap > 0) {
            const now = Date.now();
            if (now - (this.lastAt.get(key) ?? -1e9) < gap) return;
            this.lastAt.set(key, now);
        }
        this.sfxSrc.playOneShot(clip, vol);
    }

    loop(key: LoopKey, on: boolean) {
        this.loopOn[key] = on;
        const src = this.loopSrc[key];
        const clip = this.cfg.loops[key] ?? null;
        if (src.clip !== clip) { src.stop(); src.clip = clip; }
        if (!clip) return;                      // 還沒掛音檔：狀態記著,補上之後 configure() 會接上

        src.volume = this.loopVolume(key);
        if (on) { if (!src.playing) src.play(); }
        else src.stop();
    }

    // ── 雜項 ────────────────────────────────────────────────

    /** 全部停掉（切場景／關遊戲時用）。 */
    stopAll() {
        this.sfxSrc.stop();
        for (const k of LOOP_KEYS) { this.loopOn[k] = false; this.loopSrc[k].stop(); }
    }

    /** 掛了幾個音檔。開場印一行,一眼就知道音效補到哪裡了。 */
    summary() {
        const miss = [
            ...SFX_KEYS.filter(k => !this.cfg.sfx[k]),
            ...LOOP_KEYS.filter(k => !this.cfg.loops[k]),
        ];
        const total = SFX_KEYS.length + LOOP_KEYS.length;
        return miss.length === 0
            ? `音效 ${total}/${total} 全部已掛載`
            : `音效 ${total - miss.length}/${total} 已掛載,未掛：${miss.join(' ')}`;
    }
}
