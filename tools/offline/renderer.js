/* ============================================================
 *  離線版渲染與遊戲迴圈（Canvas2D）
 *
 *  對應 assets/scripts/AviaView.ts + AviaGame.ts。
 *  演算法不在這裡 —— 由 tools/genoffline.js 從 AviaPath.ts 原檔剝掉型別後注入，
 *  所以航線邏輯永遠只有一份，不會漂移。
 *
 *  座標：設計解析度 1280×720，內部一律用「距畫面底部的高度」，
 *  畫的時候才用 up() 翻成 canvas 的 y。
 * ============================================================ */

const DW = 1280, DH = 720;

const CFG = {
    waterScreenY: 110,
    planeScreenXRatio: 0.34,
    camFollowStart: 0.62,
    camLag: 4,
    rocketApproach: 55,
    seaCarrierSpacing: 1500,
    metersPerPx: 0.25,
    distanceUnit: 'm',
    trailLength: 26,
    shakeIntensity: 14,
    showDebugPath: false,

    skyTop: '#2660a8', skyBottom: '#96d6ec', skyHigh: '#080e2e',
    seaDeep: '#12467a', seaLight: '#1e6ca8', foam: 'rgba(220,246,255,0.75)',
    planeBody: '#f2f6fc', planeAccent: '#e4543e',
    pickup: '#5ce2c8', boost: '#ffca46', rocket: '#f04e4e',
    carrier: '#7e8ea0',
    hud: '#c4def4', accent: '#ffca46', text: '#ffffff',
};

const BET_OPTIONS = [0.1, 0.5, 1, 2, 5, 10, 25, 50, 100];
const SPEED_KEYS = ['slow', 'medium', 'fast', 'ultra'];
const SPEED_LABELS = ['慢', '中', '快', '極快'];

// ── 小工具 ────────────────────────────────────────────────
const up = v => DH - v;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOutC = s => 1 - Math.pow(1 - s, 3);
/* hash01() 由注入的 AviaPath 提供，這裡不重複定義（同一個 module scope 會撞名） */
function hexRgb(h) {
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
function mixHex(a, b, k) {
    const A = hexRgb(a), B = hexRgb(b);
    return `rgb(${Math.round(lerp(A[0], B[0], k))},${Math.round(lerp(A[1], B[1], k))},${Math.round(lerp(A[2], B[2], k))})`;
}
function rgba(hex, a) { const c = hexRgb(hex); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }
function fmtLen(v) { return v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString('en-US'); }
function fmtMul(v) { return v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2); }
function money(v) { return v.toFixed(2); }
function trimNum(v) { return Number.isInteger(v) ? `${v}` : String(v); }

// ── 畫布 ──────────────────────────────────────────────────
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
let scale = 1;

function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const wrap = document.getElementById('stage');
    const w = wrap.clientWidth, h = wrap.clientHeight;
    scale = Math.min(w / DW, h / DH);
    canvas.width = Math.round(DW * scale * dpr);
    canvas.height = Math.round(DH * scale * dpr);
    canvas.style.width = Math.round(DW * scale) + 'px';
    canvas.style.height = Math.round(DH * scale) + 'px';
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
}
window.addEventListener('resize', resize);

// ── 遊戲狀態 ──────────────────────────────────────────────
const S = {
    state: 'IDLE',           // IDLE | PLAY | END
    script: null,
    t: 0, beatIdx: 0,
    speed: 'medium',
    balance: 1000, betIdx: 2,
    lastWin: 0, info: '',
    clock: 0, endTimer: 0,
    camY: 0, shake: 0, sinking: 0,
    shownBalance: 1, targetBalance: 1,
    trail: [], fx: [], floats: [],
    consumed: new Set(),      // 已被吃掉的物件 id
    big: null,                // { text, color, t }
    autoSpin: false,
};

const bet = () => BET_OPTIONS[S.betIdx];

// ══════════════════════════════════════════════════════════
//  繪製
// ══════════════════════════════════════════════════════════

function drawSky() {
    const alt = clamp(S.camY / 900, 0, 1);
    const top = mixHex(CFG.skyTop, CFG.skyHigh, alt);
    const bot = mixHex(CFG.skyBottom, CFG.skyHigh, alt * 0.65);
    const g = ctx.createLinearGradient(0, 0, 0, DH);
    g.addColorStop(0, top); g.addColorStop(1, bot);
    ctx.fillStyle = g; ctx.fillRect(0, 0, DW, DH);

    // 太陽
    const sy = up(DH * 0.80 - S.camY * 0.12);
    ctx.fillStyle = 'rgba(255,236,190,0.16)';
    ctx.beginPath(); ctx.arc(DW * 0.78, sy, 110, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,246,214,0.47)';
    ctx.beginPath(); ctx.arc(DW * 0.78, sy, 58, 0, 7); ctx.fill();

    // 高空星點
    if (alt > 0.35) {
        ctx.fillStyle = `rgba(255,255,255,${(alt - 0.35) / 0.65 * 0.67})`;
        for (let i = 0; i < 40; i++) {
            const x = ((i * 7919) % 1000) / 1000 * DW;
            const y = ((i * 6151) % 1000) / 1000 * DH * 0.65;
            ctx.beginPath(); ctx.arc(x, y, 1 + (i % 3) * 0.6, 0, 7); ctx.fill();
        }
    }
}

/** 航母。甲板面落在 PHYS.DECK_Y，所以飛機真的停在甲板上。 */
function paintCarrier(cx, waterUp, s, haze, destination) {
    const fade = hex => haze > 0 ? mixHex(hex, CFG.skyBottom, haze) : hex;
    const base = CFG.carrier;
    const dark = fade('#455666'), mid = fade('#63707f'), deck = fade(base);

    const D = PHYS.DECK_Y * s, deckH = 20 * s, hullTop = D - deckH;
    const X = v => cx + v * s;
    const Y = v => up(waterUp + v);

    ctx.beginPath();                                   // 船身
    ctx.moveTo(X(-152), Y(hullTop)); ctx.lineTo(X(152), Y(hullTop));
    ctx.lineTo(X(124), Y(-34 * s)); ctx.lineTo(X(-118), Y(-34 * s));
    ctx.closePath(); ctx.fillStyle = dark; ctx.fill();

    const bandH = Math.min(46 * s, hullTop * 0.45);    // 上半段亮一階
    ctx.fillStyle = mid;
    ctx.fillRect(X(-152), Y(hullTop), 304 * s, bandH);

    if (s > 0.5) {                                     // 舷側開口
        ctx.fillStyle = fade('#121a26');
        for (let x = -120; x < 120; x += 42) ctx.fillRect(X(x), Y(hullTop - 34 * s), 22 * s, 12 * s);
    }

    ctx.fillStyle = deck;                              // 甲板
    ctx.fillRect(X(-152), Y(D), 304 * s, deckH);
    ctx.strokeStyle = `rgba(255,255,255,${0.37 * (1 - haze)})`;
    ctx.lineWidth = 3 * s; ctx.beginPath();
    for (let x = -134; x < 134; x += 34) {
        ctx.moveTo(X(x), Y(hullTop + deckH / 2)); ctx.lineTo(X(x + 18), Y(hullTop + deckH / 2));
    }
    ctx.stroke();

    const ix = destination ? 64 : -120;                // 艦島
    ctx.fillStyle = dark; ctx.fillRect(X(ix), Y(D + 46 * s), 48 * s, 46 * s);
    ctx.fillStyle = fade('#ffd25a'); ctx.fillRect(X(ix + 8), Y(D + 34 * s), 32 * s, 8 * s);
    ctx.strokeStyle = dark; ctx.lineWidth = 3 * s;
    ctx.beginPath(); ctx.moveTo(X(ix + 24), Y(D + 46 * s)); ctx.lineTo(X(ix + 24), Y(D + 74 * s)); ctx.stroke();

    if (destination) {                                 // 降落導引燈
        ctx.fillStyle = 'rgba(120,255,180,0.86)';
        for (let x = -140; x < 40; x += 30) { ctx.beginPath(); ctx.arc(X(x), Y(D + 6 * s), 4 * s, 0, 7); ctx.fill(); }
    }
    ctx.strokeStyle = CFG.foam; ctx.lineWidth = 4 * s; // 吃水線
    ctx.beginPath(); ctx.moveTo(X(-160), Y(2 * s)); ctx.lineTo(X(160), Y(2 * s)); ctx.stroke();
}

/** 海面上持續出現的航母 —— 跟目的艦長得一模一樣，同速捲動 */
function drawSeaCarriers(scroll) {
    if (SEA.SPACING <= 0) return;
    const W = SEA.HALF_W * 2, gap = SEA.SPACING;
    const endX = (S.script ? S.script.carrierTick : 30) * PHYS.PX_PER_TICK;
    const i0 = Math.floor((-scroll - DW * 0.4) / gap) - 1;
    const i1 = Math.ceil((-scroll + DW * 1.4) / gap) + 1;
    for (let i = i0; i <= i1; i++) {
        // 位置由演算法那份 seaCarrierX() 決定，兩邊必須一致
        const wx = seaCarrierX(i);
        if (Math.abs(wx) < W || Math.abs(wx - endX) < W) continue;
        const x = wx + scroll;
        if (x < -W || x > DW + W) continue;
        paintCarrier(x, CFG.waterScreenY - S.camY, 1, 0, true);
    }
}

function drawSea(scroll) {
    const layers = [
        { dy: 26, amp: 7, len: 260, par: 0.25, spd: 0.5, col: CFG.seaLight },
        { dy: 6, amp: 11, len: 170, par: 0.6, spd: 0.9, col: CFG.seaDeep },
    ];
    for (const L of layers) {
        const top = CFG.waterScreenY + L.dy - S.camY;
        ctx.beginPath(); ctx.moveTo(0, DH);
        for (let x = 0; x <= DW; x += 8) {
            const p = (x - scroll * L.par) / L.len + S.clock * L.spd;
            ctx.lineTo(x, up(top + Math.sin(p) * L.amp + Math.sin(p * 2.3) * L.amp * 0.35));
        }
        ctx.lineTo(DW, DH); ctx.closePath();
        ctx.fillStyle = L.col; ctx.fill();
    }
    ctx.strokeStyle = CFG.foam; ctx.lineWidth = 2; ctx.beginPath();
    const top = CFG.waterScreenY + 6 - S.camY;
    for (let x = 0; x <= DW; x += 8) {
        const p = (x - scroll * 0.6) / 170 + S.clock * 0.9;
        const y = up(top + Math.sin(p) * 11 + Math.sin(p * 2.3) * 3.85);
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
}

function drawPlane(x, yUp, pitch) {
    ctx.save();
    ctx.translate(x, up(yUp));
    ctx.rotate(-pitch);
    const P = new Path2D();
    P.moveTo(38, 0); P.lineTo(6, -12); P.lineTo(-32, -9); P.lineTo(-36, 6); P.lineTo(6, 10);
    P.closePath();
    ctx.fillStyle = CFG.planeBody; ctx.fill(P);
    ctx.fillStyle = CFG.planeAccent;
    ctx.beginPath(); ctx.moveTo(6, -2); ctx.lineTo(-16, 22); ctx.lineTo(-2, 22); ctx.lineTo(14, 1);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(6, -2); ctx.lineTo(-14, -20); ctx.lineTo(0, -20); ctx.lineTo(14, -3);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-30, -6); ctx.lineTo(-40, -26); ctx.lineTo(-24, -12);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(150,225,255,0.92)';
    ctx.beginPath(); ctx.arc(12, -6, 7, 0, 7); ctx.fill();
    ctx.restore();
}

function drawObject(o, x, yUp) {
    const y = up(yUp);
    if (o.kind.kind === 'ROCKET') {
        ctx.fillStyle = rgba(CFG.rocket, 0.27);
        ctx.beginPath(); ctx.arc(x, y, 34, 0, 7); ctx.fill();
        ctx.fillStyle = CFG.rocket;                       // 機首朝左
        ctx.beginPath(); ctx.moveTo(x - 26, y); ctx.lineTo(x - 2, y - 11); ctx.lineTo(x + 22, y - 8);
        ctx.lineTo(x + 22, y + 8); ctx.lineTo(x - 2, y + 11); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#a82828';
        ctx.beginPath(); ctx.moveTo(x + 22, y - 8); ctx.lineTo(x + 30, y - 18); ctx.lineTo(x + 30, y - 2); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x + 22, y + 8); ctx.lineTo(x + 30, y + 18); ctx.lineTo(x + 30, y + 2); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#ffdc78';                        // 尾焰在右
        ctx.beginPath(); ctx.moveTo(x + 24, y - 6); ctx.lineTo(x + 46, y); ctx.lineTo(x + 24, y + 6); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,150,60,0.75)';
        ctx.beginPath(); ctx.moveTo(x + 30, y - 4); ctx.lineTo(x + 62, y); ctx.lineTo(x + 30, y + 4); ctx.closePath(); ctx.fill();
        return;
    }
    const boost = o.kind.kind === 'BOOST';
    const col = boost ? CFG.boost : CFG.pickup;
    ctx.fillStyle = rgba(col, 0.22);
    ctx.beginPath(); ctx.arc(x, y, 36, 0, 7); ctx.fill();
    ctx.fillStyle = col; ctx.beginPath();
    if (boost) {
        for (let i = 0; i < 6; i++) {
            const a = Math.PI / 3 * i - Math.PI / 6;
            const px = x + Math.cos(a) * 28, py = y + Math.sin(a) * 28;
            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
    } else ctx.arc(x, y, 26, 0, 7);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.82)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, boost ? 30 : 27, 0, 7); ctx.stroke();

    ctx.fillStyle = '#141f30';
    ctx.font = 'bold 26px system-ui,sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(boost ? `×${o.kind.value}` : `+${o.kind.value}`, x, y + 1);
}

/** 軌跡點存的是「世界座標」，畫的時候才套用捲動與鏡頭 —— 不會累積誤差 */
function drawTrail(scroll) {
    if (S.trail.length < 2) return;
    const sx = p => p.wx + scroll;
    const sy = p => up(CFG.waterScreenY + p.wy - S.camY);
    for (let i = 1; i < S.trail.length; i++) {
        const a = i / S.trail.length;
        ctx.strokeStyle = `rgba(255,255,255,${a * a * 0.67})`;
        ctx.lineWidth = 2 + a * 9;
        ctx.beginPath();
        ctx.moveTo(sx(S.trail[i - 1]), sy(S.trail[i - 1]));
        ctx.lineTo(sx(S.trail[i]), sy(S.trail[i]));
        ctx.stroke();
    }
}

function drawHud(frame) {
    const s = S.script;
    const bar = (x, yUp, w, p, col) => {
        ctx.fillStyle = 'rgba(255,255,255,0.13)';
        ctx.fillRect(x, up(yUp + 10), w, 10);
        ctx.fillStyle = col;
        ctx.fillRect(x, up(yUp + 10), Math.max(6, w * clamp(p, 0, 1)), 10);
    };
    const dist = clamp(S.t / Math.max(1, s.carrierTick), 0, 1);
    const alt = clamp(frame.y / PHYS.ALT_DISPLAY_MAX, 0, 1);
    bar(150, DH - 47, 210, dist, CFG.accent);
    bar(150, DH - 81, 210, alt, CFG.hud);

    const u = CFG.metersPerPx, un = CFG.distanceUnit;
    ctx.font = '20px system-ui,sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = CFG.hud;
    ctx.fillText(`距離 ${fmtLen(S.t * PHYS.PX_PER_TICK * u)} / ${fmtLen(s.carrierTick * PHYS.PX_PER_TICK * u)} ${un}`, 36, up(DH - 42));
    ctx.fillText(`高度 ${fmtLen(frame.y * u)} ${un}`, 36, up(DH - 76));

    ctx.font = 'bold 40px system-ui,sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = S.targetBalance >= 20 ? CFG.accent : CFG.text;
    ctx.fillText(`${fmtMul(S.shownBalance)}×`, DW / 2, up(DH - 56));
}

// ── 特效 ──────────────────────────────────────────────────
function pushFx(kind, x, yUp, dur, r0, r1, col) {
    S.fx.push({ kind, x, y: yUp, t: 0, dur, r0, r1, col, seed: Math.random() * 100 });
}
function drawFx(dt) {
    for (let i = S.fx.length - 1; i >= 0; i--) {
        const f = S.fx[i]; f.t += dt;
        const p = f.t / f.dur;
        if (p >= 1) { S.fx.splice(i, 1); continue; }
        const a = 1 - p, r = f.r0 + (f.r1 - f.r0) * easeOutC(p);
        const y = up(f.y - S.camY);
        if (f.kind === 'RING') {
            ctx.strokeStyle = rgba(f.col, a); ctx.lineWidth = 6 * a + 1;
            ctx.beginPath(); ctx.arc(f.x, y, r, 0, 7); ctx.stroke();
        } else if (f.kind === 'FLASH') {
            ctx.fillStyle = rgba(f.col, a * 0.55);
            ctx.beginPath(); ctx.arc(f.x, y, r, 0, 7); ctx.fill();
        } else if (f.kind === 'SPRAY') {
            ctx.strokeStyle = rgba(f.col, a); ctx.lineWidth = 3; ctx.beginPath();
            for (let k = 0; k < 12; k++) {
                const ang = k / 12 * Math.PI * 2 + f.seed;
                const rr = r * (0.55 + ((k * 37 + f.seed) % 10) / 18);
                ctx.moveTo(f.x + Math.cos(ang) * rr * 0.35, y + Math.sin(ang) * rr * 0.35);
                ctx.lineTo(f.x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
            }
            ctx.stroke();
        } else if (f.kind === 'SMOKE') {
            for (let k = 0; k < 5; k++) {
                ctx.fillStyle = rgba(f.col, a * (0.16 + k * 0.05));
                ctx.beginPath();
                ctx.arc(f.x - k * r * 0.45, y + Math.sin(k + f.seed) * 8, r * (0.5 + k * 0.16), 0, 7);
                ctx.fill();
            }
        }
    }
}
function floatText(x, yUp, txt, col, size) {
    S.floats.push({ x, y: yUp, txt, col, size, t: 0 });
}
function drawFloats(dt) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = S.floats.length - 1; i >= 0; i--) {
        const f = S.floats[i]; f.t += dt;
        if (f.t > 0.8) { S.floats.splice(i, 1); continue; }
        const k = f.t / 0.8;
        ctx.globalAlpha = k < 0.4 ? 1 : 1 - (k - 0.4) / 0.6;
        ctx.fillStyle = f.col;
        ctx.font = `bold ${f.size}px system-ui,sans-serif`;
        ctx.fillText(f.txt, f.x, up(f.y - S.camY + 92 * easeOutC(k)));
        ctx.globalAlpha = 1;
    }
}

// ══════════════════════════════════════════════════════════
//  演出節拍
// ══════════════════════════════════════════════════════════

function onBeat(b) {
    const s = S.script;
    const px = DW * CFG.planeScreenXRatio;
    const obj = s.objects.find(o => o.id === b.objId);
    const oy = obj ? CFG.waterScreenY + obj.y : CFG.waterScreenY + 200;

    switch (b.type) {
        case 'TAKEOFF':
            pushFx('SMOKE', px - 60, CFG.waterScreenY + PHYS.DECK_Y, 0.6, 20, 90, '#ffffff');
            break;
        case 'HIT_PICKUP':
        case 'HIT_BOOST': {
            const boost = b.type === 'HIT_BOOST';
            S.targetBalance = b.payload.balance;
            S.consumed.add(b.objId);
            pushFx('RING', px, oy, 0.42, 20, boost ? 120 : 78, boost ? CFG.boost : CFG.pickup);
            floatText(px, oy + 20, boost ? `×${b.payload.value}` : `+${b.payload.value}`,
                boost ? CFG.boost : CFG.pickup, boost ? 52 : 40);
            if (boost) S.shake = Math.max(S.shake, 0.45);
            break;
        }
        case 'HIT_ROCKET':
            S.targetBalance = b.payload.balance;
            S.consumed.add(b.objId);
            pushFx('FLASH', px, oy, 0.3, 30, 150, CFG.rocket);
            pushFx('SPRAY', px, oy, 0.55, 10, 130, CFG.rocket);
            floatText(px, oy + 16, '÷2', CFG.rocket, 50);
            S.shake = 1;
            break;
        case 'LAND': {
            pushFx('SMOKE', px, CFG.waterScreenY + PHYS.DECK_Y, 0.9, 18, 130, '#ffffff');
            S.shake = 0.8;
            const m = s.finalBalance;
            S.big = {
                text: m >= 80 ? 'SUPER MEGA WIN' : m >= 40 ? 'MEGA WIN' : m >= 20 ? 'BIG WIN' : 'LAND!',
                color: m >= 20 ? CFG.accent : CFG.text, t: 0,
            };
            S.lastWin = bet() * m;
            S.balance += S.lastWin;
            syncUi();
            break;
        }
        case 'DECK_SLIDE':
            // 該墜海卻剛好撞上一艘航母 —— 觸艦、擦出火花、開始滑行
            pushFx('SMOKE', px, CFG.waterScreenY + PHYS.DECK_Y, 1.1, 14, 120, '#ffffff');
            pushFx('SPRAY', px, CFG.waterScreenY + PHYS.DECK_Y, 0.5, 8, 90, '#ffd678');
            S.shake = 0.9;
            S.big = { text: '停在艦上了…', color: CFG.text, t: 0 };
            break;

        case 'SPLASH':
            S.sinking = 1; S.shake = 1; S.targetBalance = 0;
            pushFx('RING', px, CFG.waterScreenY + 8, 0.8, 14, 190, '#dcf6ff');
            pushFx('SPRAY', px, CFG.waterScreenY + 10, 0.9, 8, 210, '#dcf6ff');
            S.big = { text: 'SPLASH', color: '#ff7878', t: 0 };
            S.info = `差一點 —— 最高曾到 ${s.peakBalance.toFixed(2)}×`;
            S.lastWin = 0;
            syncUi();
            break;
    }
}

// ══════════════════════════════════════════════════════════
//  主迴圈
// ══════════════════════════════════════════════════════════

function idleFrame(clock) {
    return { tick: 0, y: PHYS.DECK_Y + 18 + Math.sin(clock * 2) * 4, vy: 0, pitch: Math.sin(clock * 1.3) * 0.035 };
}

function spin() {
    if (S.state !== 'IDLE') return;
    let b = bet();
    if (S.balance < b) {
        const best = BET_OPTIONS.filter(v => v <= S.balance).pop();
        if (best === undefined) { S.info = '餘額不足'; syncUi(); return; }
        S.betIdx = BET_OPTIONS.indexOf(best); b = best;
    }
    S.balance -= b;
    S.lastWin = 0; S.info = '';
    S.script = buildPerformance(offlineResult());
    S.t = 0; S.beatIdx = 0; S.state = 'PLAY';
    S.camY = 0; S.sinking = 0; S.shake = 0;
    S.trail.length = 0; S.fx.length = 0; S.floats.length = 0;
    S.consumed.clear(); S.big = null;
    S.shownBalance = 1; S.targetBalance = 1;
    syncUi();
}

let last = performance.now();
function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now; S.clock += dt;

    if (S.state === 'IDLE') {
        render(dt, 0, idleFrame(S.clock), false);
    } else {
        const s = S.script, ms = TICK_MS[S.speed];
        if (S.state === 'PLAY') {
            S.t = Math.min(S.t + dt * 1000 / ms, s.totalTicks);
            while (S.beatIdx < s.beats.length && s.beats[S.beatIdx].tick <= S.t) onBeat(s.beats[S.beatIdx++]);
            if (S.t >= s.terminalTick) { S.state = 'END'; S.endTimer = 0; }
        } else {
            S.endTimer += dt;
            if (S.endTimer >= 1.8) {
                S.state = 'IDLE'; S.script = null; S.camY = 0; S.sinking = 0;
                S.consumed.clear(); S.big = null; syncUi();
                if (S.autoSpin) setTimeout(spin, 400);
                requestAnimationFrame(frame); return;
            }
        }
        const tt = Math.min(S.t, s.terminalTick);
        render(dt, tt, sampleFrame(s, tt), true);
    }
    requestAnimationFrame(frame);
}

function render(dt, t, fr, playing) {
    const s = S.script;
    const planeX = t * PHYS.PX_PER_TICK;
    const scroll = DW * CFG.planeScreenXRatio - planeX;

    if (S.sinking > 0) S.sinking += dt * 46;
    const planeUpAbs = CFG.waterScreenY + fr.y - S.sinking;

    // 垂直鏡頭：超過畫面高度的 camFollowStart 就往上跟，沒有上限
    const target = Math.max(0, planeUpAbs - DH * CFG.camFollowStart);
    S.camY += (target - S.camY) * Math.min(1, dt * CFG.camLag);

    ctx.save();
    if (S.shake > 0) {
        S.shake = Math.max(0, S.shake - dt * 3.2);
        const k = S.shake * CFG.shakeIntensity;
        ctx.translate((Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
    }

    drawSky();
    drawSeaCarriers(scroll);

    // 起飛艦與目的艦
    paintCarrier(scroll, CFG.waterScreenY - S.camY, 1, 0, false);
    paintCarrier((s ? s.carrierTick : 30) * PHYS.PX_PER_TICK + scroll, CFG.waterScreenY - S.camY, 1, 0, true);

    if (s && CFG.showDebugPath) {
        ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2; ctx.beginPath();
        for (let i = 0; i <= s.terminalTick; i++) {
            const x = i * PHYS.PX_PER_TICK + scroll, y = up(CFG.waterScreenY + s.frames[i].y - S.camY);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    // 物件（飛彈額外往左飛）
    if (s) {
        for (const o of s.objects) {
            if (S.consumed.has(o.id)) continue;
            let x = o.tick * PHYS.PX_PER_TICK + scroll;
            if (o.kind.kind === 'ROCKET') x += Math.min((o.tick - t) * CFG.rocketApproach, DW * 1.4);
            if (x < -120 || x > DW + 120) continue;
            drawObject(o, x, CFG.waterScreenY + o.y - S.camY);
        }
    }

    if (playing) {
        S.trail.push({ wx: planeX - 30, wy: fr.y - S.sinking - 2 });
        while (S.trail.length > CFG.trailLength) S.trail.shift();
        drawTrail(scroll);
    }

    drawSea(scroll);
    drawFx(dt);

    drawPlane(DW * CFG.planeScreenXRatio, planeUpAbs - S.camY,
        fr.pitch + (S.sinking > 0 ? -S.sinking * 0.006 : 0));

    if (playing) {                                     // Counter Balance 跟著飛機
        S.shownBalance += (S.targetBalance - S.shownBalance) * Math.min(1, dt * 12);
        ctx.font = 'bold 30px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = CFG.text;
        ctx.fillText(`${fmtMul(S.shownBalance)}×`, DW * CFG.planeScreenXRatio, up(planeUpAbs - S.camY + 58));
    }

    drawFloats(dt);
    if (playing && s) drawHud(fr);

    if (S.big) {                                       // 大字
        S.big.t += dt;
        const k = Math.min(1, S.big.t / 0.28);
        const sc = k < 1 ? 0.3 + 0.9 * easeOutC(k) : 1;
        ctx.save();
        ctx.translate(DW / 2, up(DH * 0.62)); ctx.scale(sc, sc);
        ctx.font = 'bold 96px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.strokeText(S.big.text, 0, 0);
        ctx.fillStyle = S.big.color; ctx.fillText(S.big.text, 0, 0);
        ctx.restore();
    }
    ctx.restore();
}

// ══════════════════════════════════════════════════════════
//  UI（HTML，不畫在 canvas 上）
// ══════════════════════════════════════════════════════════

let elChips, elSpin, elSpeeds, elBalance, elBet, elWin, elInfo;

function buildUi() {
    const ui = document.getElementById('ui');
    ui.innerHTML = `
      <div class="row top">
        <div><b id="bal"></b><span id="betl"></span></div>
        <div id="win"></div>
      </div>
      <div class="row bottom">
        <div id="chips"></div>
        <div class="right">
          <div id="speeds"></div>
          <button id="spin">SPIN</button>
        </div>
      </div>
      <div id="info"></div>`;

    elChips = document.getElementById('chips');
    elSpeeds = document.getElementById('speeds');
    elSpin = document.getElementById('spin');
    elBalance = document.getElementById('bal');
    elBet = document.getElementById('betl');
    elWin = document.getElementById('win');
    elInfo = document.getElementById('info');

    BET_OPTIONS.forEach((v, i) => {
        const b = document.createElement('button');
        b.className = 'chip'; b.textContent = '$' + trimNum(v);
        b.onclick = () => { if (S.state === 'IDLE') { S.betIdx = i; syncUi(); } };
        elChips.appendChild(b);
    });
    SPEED_LABELS.forEach((s, i) => {
        const b = document.createElement('button');
        b.className = 'sp'; b.textContent = s;
        b.onclick = () => { S.speed = SPEED_KEYS[i]; syncUi(); };
        elSpeeds.appendChild(b);
    });
    elSpin.onclick = spin;

    addEventListener('keydown', e => {
        if (e.code === 'Space') { e.preventDefault(); spin(); }
        if (e.code === 'KeyA') { S.autoSpin = !S.autoSpin; syncUi(); if (S.autoSpin) spin(); }
    });
    syncUi();
}

function syncUi() {
    const idle = S.state === 'IDLE';
    [...elChips.children].forEach((c, i) => {
        c.classList.toggle('on', i === S.betIdx);
        c.disabled = !idle;
    });
    [...elSpeeds.children].forEach((c, i) => c.classList.toggle('on', SPEED_KEYS[i] === S.speed));
    elSpin.disabled = !idle;
    elSpin.textContent = idle ? (S.autoSpin ? 'AUTO' : 'SPIN') : '飛行中';
    elBalance.textContent = `餘額 $${money(S.balance)}`;
    elBet.textContent = `　下注 $${trimNum(bet())}`;
    elWin.textContent = S.lastWin > 0 ? `贏 $${money(S.lastWin)}` : '';
    elInfo.textContent = S.info;
}

// ── 啟動 ──────────────────────────────────────────────────
buildUi();
resize();
requestAnimationFrame(frame);
