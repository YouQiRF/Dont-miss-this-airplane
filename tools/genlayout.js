/**
 * 把整棵版面節點樹寫進 assets/scenes/game.scene
 *
 *   node tools/genlayout.js            看它會做什麼（不寫檔）
 *   node tools/genlayout.js --write    真的寫進場景
 *
 * 為什麼要這支：
 *
 * 以前所有 GameObject 都是程式 `new Node()` 出來的，位置寫死在 AviaGame.buildUi()
 * 裡（例如 `W - 150, 74`）。要調一顆按鈕的位置得改程式、存檔、等編譯、再預覽 ——
 * 而且我（AI）沒有編輯器，根本沒辦法確認擺得對不對。
 *
 * 這支把節點樹先寫進場景，AviaView 改成「**場景裡有同名節點就用它**」（見 AviaView.mk）。
 * 所以：
 *
 *   · 在編輯器裡拖節點 = 改位置，不用動程式
 *   · 改 UITransform 的寬高 = 改按鈕大小，程式會照著畫
 *   · 刪掉某個節點 = 退回程式建，一切照舊（不會壞）
 *
 * 不放進場景的東西（**位置由航線演算法決定，擺了也會被程式蓋掉**）：
 *   飛機、起飛航母、目的艦、+N／×N／飛彈、尾煙、特效
 *   —— 這些要換外觀請走 Inspector ⑨ 的 Prefab，不是搬節點。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCENE = path.join(ROOT, 'assets/scenes/game.scene');
const WRITE = process.argv.includes('--write');
const CHECK = process.argv.includes('--check');

const W = 1280, H = 720;
const UI_LAYER = 33554432;

// ── 版面定義 ────────────────────────────────────────────────
// [名字, 寬, 高, x, y, 錨點x, 錨點y, 子節點]
// x / y 是相對父節點的位置。stage 的原點在畫面左下角，所以這裡的座標
// 跟 AviaGame.buildUi() 裡的數字是同一套，對照著看就懂。
/**
 * @param art  編輯器預覽用的長相：'btn' | 'frame' | 'text' | 'sky' | 'sun' | 'sea'
 *             有給就掛一顆 AviaUiArt（executeInEditMode），**編輯器裡就看得到外框**。
 *             沒給就是純容器節點（camRoot、world 之類），本來就不該有外觀。
 * @param text 節點自己的 cc.Label 內容。場景裡存著，所以編輯器也看得到字；
 *             執行期 AviaView 會沿用同一個 Label 只換內容，不會多生一個。
 */
const N = (name, w, h, x, y, ax = 0, ay = 0, children = [], art = null, text = null,
    fontSize = 18) => ({ name, w, h, x, y, ax, ay, children, art, text, fontSize });

/** 按鈕：一行搞定「框 + 字」 */
const B = (name, w, h, x, y, text = '', fontSize = 18) =>
    N(name, w, h, x, y, .5, .5, [], 'btn', text, fontSize);
/** 純文字 */
const T = (name, w, h, x, y, ax, ay, text = '', fontSize = 18) =>
    N(name, w, h, x, y, ax, ay, [], null, text, fontSize);
/** 底板 */
const F = (name, w, h, x, y) => N(name, w, h, x, y, .5, .5, [], 'frame');

const UI_KIND = { btn: 0, frame: 1, text: 2, sky: 3, sun: 4, sea: 5 };
const ALIGN = { 0: 0, 0.5: 1, 1: 2 };   // 錨點 → Label 水平對齊

/**
 * 一開場就該是關著的節點（浮層）。
 * 場景若給 active=true，開場會閃一格才被 refreshUi() 關掉。
 * 名字開頭符合就標成隱藏 —— 程式該開的時候自然會開。
 */
const HIDDEN = ['bigText', 'speedMenu', 'speedOption', 'autoPanel', 'autoTitle',
    'autoCount', 'autoCustom', 'autoCond', 'autoAmount', 'autoStart', 'keypad', 'key'];
const startsHidden = name => HIDDEN.some(h => name.startsWith(h));

// 下注器
const bw = 236, bx = 30 + bw / 2, by = 58;
// 速度選單
const sx = W - 300 + 44, sy = 140, sw = 152, sh = 36, sgap = 4;
const optY = i => sy + sh + 8 + (3 - i) * (sh + sgap);
// 自動面板
const pw = 460, ph = 330, cx = W - 250, cy = H - 300;
const top = cy + ph / 2, left = cx - pw / 2;
const row = i => top - 92 - i * 42;
const cbw = Math.min(84, (pw - 36) / 6 - 6);
const cbx = i => left + 18 + cbw / 2 + i * (cbw + 6);
// 停止條件列：左邊標題 + 右邊金額輸入框（跟 AviaGame.buildAutoPanel 同一組數字）
const amtW = 132, condW = pw - 36 - amtW - 8;
const condX = left + 18 + condW / 2;
const amtX = left + 18 + condW + 8 + amtW / 2;
// 數字鍵盤
const kw = 216, kh = 300, kx = cx - pw / 2 - 130;

const SPEED_LABELS = ['慢', '中', '快', '極快'];
const AUTO_COUNTS = ['10', '25', '50', '100', '∞'];
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'];

const ui = [
    // 下注器（框先擺，按鈕蓋在上面 —— 場景的兄弟順序就是疊放順序）
    F('betFrame', bw, 56, bx, by),
    B('betMinus', 48, 44, bx - bw / 2 + 30, by, '−', 30),
    B('betPlus', 48, 44, bx + bw / 2 - 30, by, '＋', 26),
    T('betValue', 400, 38, bx, by, .5, .5, '$1', 24),
    B('spin', 200, 76, W - 150, 74, 'SPIN', 34),
    B('auto', 88, 76, W - 300, 74, 'AUTO', 20),
    // 速度選單（往上展開）
    F('speedMenu', sw + 8, 3 * (sh + sgap) + sh + 8, sx, (optY(0) + optY(3)) / 2),
    ...SPEED_LABELS.map((s, i) => B('speedOption' + i, sw, sh, sx, optY(i), s, 17)),
    B('speedBtn', sw, sh, sx, sy, '速度  中  ▴', 17),
    // 自動下注面板
    F('autoPanel', pw, ph, cx, cy),
    B('autoTitle', pw - 24, 36, cx, top - 30, '自動下注', 19),
    ...AUTO_COUNTS.map((v, i) => B('autoCount' + i, cbw, 36, cbx(i), row(0), v, 17)),
    B('autoCustom', cbw, 36, cbx(5), row(0), '自訂', 15),
    // 停止條件：第一條佔滿整列，其餘三條是「標題 + 金額輸入框」
    B('autoCond1', pw - 36, 36, cx, row(1), '☐  任何勝利就停', 16),
    B('autoCond2', condW, 36, condX, row(2), '☐  單次獎金 ≥', 16),
    B('autoCond3', condW, 36, condX, row(3), '☐  餘額增加 ≥', 16),
    B('autoCond4', condW, 36, condX, row(4), '☐  餘額減少 ≥', 16),
    B('autoAmount2', amtW, 36, amtX, row(2), '點此輸入', 15),
    B('autoAmount3', amtW, 36, amtX, row(3), '點此輸入', 15),
    B('autoAmount4', amtW, 36, amtX, row(4), '點此輸入', 15),
    B('autoStart', pw - 36, 44, cx, row(5) - 6, '開始自動  10 局', 20),
    // 數字鍵盤
    F('keypad', kw, kh, kx, cy),
    B('keypadValue', kw - 24, 40, kx, cy + kh / 2 - 28, '輸入局數', 26),
    ...KEYS.map((k, i) => B('key' + i, 58, 44,
        kx - 66 + (i % 3) * 66, cy + kh / 2 - 84 - ((i / 3) | 0) * 52, k, 22)),
    // 讀數
    T('balance', 400, 38, 30, H - 120, 0, .5, '餘額  $1000.00', 24),
    T('betText', 400, 32, 30, H - 152, 0, .5, '下注  $1', 20),
    T('win', 400, 44, W - 30, H - 120, 1, .5, '', 28),
    T('info', 400, 28, W / 2, 122, .5, .5, '', 18),
    T('autoText', 400, 28, W - 30, H - 152, 1, .5, '', 18),
];

const TREE = N('stage', W, H, -W / 2, -H / 2, 0, 0, [
    N('sky', W, H, 0, 0, 0, 0, [], 'sky'),
    N('sun', 220, 220, W * 0.78, H * 0.80, .5, .5, [], 'sun'),
    N('camRoot', W, H, 0, 0, 0, 0, [
        N('seaBack', W, H, 0, 0, 0, 0, [], 'sea'),
        N('seaCarriers', W, H, 0, 0),
        // world 底下的飛機／航母／物件全部由程式生，位置由航線決定，所以不擺在場景上
        N('world', W, H, 0, 0),
        N('seaFront', W, H, 0, 0),
        N('fxLayer', W, H, 0, 0),
        N('fx', W, H, 0, 0),
    ]),
    N('hud', W, H, 0, 0, 0, 0, [
        T('dist', 400, 32, 36, H - 42, 0, .5, '距離 0 / 0 m', 20),
        T('alt', 400, 32, 36, H - 76, 0, .5, '高度 0 m', 20),
        T('mult', 400, 64, W / 2, H - 56, .5, .5, '1.00×', 40),
    ]),
    T('bigText', 900, 140, W / 2, H * 0.62, .5, .5, 'BIG WIN', 96),
    N('ui', W, H, 0, 0, 0, 0, ui),
]);

// ── 場景序列化 ──────────────────────────────────────────────
const scene = JSON.parse(fs.readFileSync(SCENE, 'utf8'));

// ── --check：程式會去找的節點名字 vs 場景實際有的 ──────────────
// 沒有 Cocos 編輯器也能抓出「改了程式忘了改場景」這種錯。
if (CHECK) {
    const src = fs.readFileSync(path.join(ROOT, 'assets/scripts/AviaGame.ts'), 'utf8');
    const wanted = new Set();
    // createButton('spin', ...) / createText('info', ...) / createFrame('keypad', ...)
    for (const m of src.matchAll(/create(?:Button|Text|Frame)\(\s*'([^']+)'/g)) wanted.add(m[1]);
    // createButton('speedOption' + i, ...) / ('autoAmount' + (i + 2), ...) 這種動態名字，
    // 用前綴比對就好
    for (const m of src.matchAll(/create(?:Button|Text|Frame)\(\s*'([A-Za-z]+)'\s*\+\s*\(?\s*i\b/g)) {
        wanted.delete(m[1]);            // 上面那條會把 'speedOption' 當成完整名字撈進來
        wanted.add({ prefix: m[1] });
    }
    const have = new Set(scene.filter(o => o && o.__type__ === 'cc.Node').map(o => o._name));
    const miss = [];
    for (const w of wanted) {
        if (typeof w === 'string') { if (!have.has(w)) miss.push(w); }
        else if (![...have].some(h => h.startsWith(w.prefix))) miss.push(w.prefix + '*');
    }
    // 反向：場景有、但程式不會去找的（改名之後的孤兒）
    const codeNames = [...wanted].map(w => typeof w === 'string' ? w : w.prefix);
    const layoutNames = new Set();
    (function walk(n) { layoutNames.add(n.name); (n.children || []).forEach(walk); })(TREE);
    const orphan = [...have].filter(h =>
        layoutNames.has(h) && !codeNames.some(c => h === c || h.startsWith(c)) &&
        !['stage', 'sky', 'sun', 'camRoot', 'seaBack', 'seaCarriers', 'world', 'seaFront',
            'fxLayer', 'fx', 'hud', 'dist', 'alt', 'mult', 'bigText', 'ui'].includes(h));

    console.log(`程式會找 ${codeNames.length} 個具名節點，場景有 ${have.size} 個節點`);
    if (miss.length) {
        console.error('\n✗ 場景缺少這些節點（程式會退回自己建，位置就不是你擺的了）：');
        miss.forEach(m => console.error('   ' + m));
    }
    if (orphan.length) {
        console.warn('\n⚠ 場景有、但程式不再使用的節點（可能是改名留下的孤兒）：');
        orphan.forEach(o => console.warn('   ' + o));
    }
    if (!miss.length && !orphan.length) console.log('\n✓ 程式與場景完全對得上');
    process.exit(miss.length ? 1 : 0);
}

// GameRoot：找掛著 AviaGame 的那個節點（它的 _components 指向自訂型別）
const gameRootId = scene.findIndex(o =>
    o.__type__ === 'cc.Node' && o._name === 'GameRoot');
if (gameRootId < 0) {
    console.error('✗ 場景裡找不到 GameRoot 節點，沒有動任何東西');
    process.exit(1);
}

// 已經有 stage 了就不重複塞（這支腳本可以重跑，不會長出兩棵）
const already = (scene[gameRootId]._children || []).some(c => {
    const child = scene[c.__id__];
    return child && child._name === 'stage';
});
if (already) {
    console.log('場景裡已經有 stage 節點樹了，沒有動任何東西。');
    console.log('要重生請先在編輯器裡把 stage 整個刪掉，或還原 game.scene 再跑一次。');
    process.exit(0);
}

// AviaUiArt 的元件型別 = 它 .meta 的壓縮 uuid（跟 genscene.js 同一套算法）
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function compressUuid(uuid) {
    const hex = uuid.replace(/-/g, '');
    let s = hex.slice(0, 5);
    for (let i = 5; i < hex.length; i += 3) {
        const v = parseInt(hex.slice(i, i + 3), 16);
        s += B64[v >> 6] + B64[v & 63];
    }
    return s;
}
const uiArtMeta = path.join(ROOT, 'assets/scripts/AviaUiArt.ts.meta');
if (!fs.existsSync(uiArtMeta)) {
    console.error('✗ 找不到 assets/scripts/AviaUiArt.ts.meta —— 編輯器預覽元件掛不上去');
    process.exit(1);
}
const UI_ART_TYPE = compressUuid(JSON.parse(fs.readFileSync(uiArtMeta, 'utf8')).uuid);

const COL = (r, g, b, a) => ({ __type__: 'cc.Color', r, g, b, a });

let count = 0;
/** 把一棵子樹接到 scene 陣列尾巴，回傳它的 __id__ */
function emit(node, parentId) {
    const id = scene.length;
    scene.push(null);                       // 先佔位，子節點才拿得到正確的 id
    const comps = [];

    const utId = scene.length;
    comps.push({ __id__: utId });
    scene.push({
        __type__: 'cc.UITransform', _name: '', _objFlags: 0, __editorExtras__: {},
        node: { __id__: id }, _enabled: true, __prefab: null,
        _contentSize: { __type__: 'cc.Size', width: node.w, height: node.h },
        _anchorPoint: { __type__: 'cc.Vec2', x: node.ax, y: node.ay },
        _id: '',
    });

    // 編輯器預覽（executeInEditMode）—— 有它才在 Scene 視窗看得到外框
    if (node.art) {
        comps.push({ __id__: scene.length });
        scene.push({
            __type__: UI_ART_TYPE, _name: '', _objFlags: 0, __editorExtras__: {},
            node: { __id__: id }, _enabled: true, __prefab: null,
            kind: UI_KIND[node.art], drawDefaultArt: true, previewOn: false,
            _id: '',
        });
    }

    // 文字。
    //
    // ⚠ Cocos 一個節點只能掛一個 UIRenderer，**Graphics 與 Label 互斥**。
    // 所以會畫外框的節點（按鈕、底板），文字一定要放在 label 子節點上，
    // 不然編輯器會噴 "conflicts with the existing cc.Label"。
    // 純文字節點（沒有外框）才把 Label 放自己身上。
    const hasBox = node.art && node.art !== 'text';
    const labelOwnerIsSelf = !hasBox;
    if (node.text !== null && node.text !== undefined && labelOwnerIsSelf) {
        comps.push({ __id__: scene.length });
        scene.push({
            __type__: 'cc.Label', _name: '', _objFlags: 0, __editorExtras__: {},
            node: { __id__: id }, _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: COL(255, 255, 255, 255), _string: node.text,
            _horizontalAlign: ALIGN[node.ax] ?? 1, _verticalAlign: 1,
            _actualFontSize: node.fontSize, _fontSize: node.fontSize, _fontFamily: 'Arial',
            _lineHeight: Math.round(node.fontSize * 1.15), _overflow: 0,
            _enableWrapText: false, _font: null, _isSystemFontUsed: true, _spacingX: 0,
            _isItalic: false, _isBold: true, _isUnderline: false, _underlineHeight: 2,
            _cacheMode: 0, _enableOutline: false, _outlineColor: COL(0, 0, 0, 255),
            _outlineWidth: 2, _enableShadow: false, _shadowColor: COL(0, 0, 0, 255),
            _shadowOffset: { __type__: 'cc.Vec2', x: 2, y: 2 }, _shadowBlur: 2, _id: '',
        });
    }

    // 有外框的節點：文字掛在一個叫 label 的子節點上（AviaView.mkLabel 就是去找這個名字）
    const kids = [...(node.children || [])];
    if (node.text !== null && node.text !== undefined && hasBox) {
        kids.push(N('label', node.w, node.h, 0, 0, .5, .5, [], null, node.text, node.fontSize));
    }
    const childIds = kids.map(c => emit(c, id));
    scene[id] = {
        __type__: 'cc.Node', _name: node.name, _objFlags: 0, __editorExtras__: {},
        _parent: { __id__: parentId },
        _children: childIds.map(i => ({ __id__: i })),
        _active: !startsHidden(node.name),
        _components: comps,
        _prefab: null,
        _lpos: { __type__: 'cc.Vec3', x: node.x, y: node.y, z: 0 },
        _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
        _lscale: { __type__: 'cc.Vec3', x: 1, y: 1, z: 1 },
        _mobility: 0, _layer: UI_LAYER,
        _euler: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
    };
    count++;
    return id;
}

const stageId = emit(TREE, gameRootId);
scene[gameRootId]._children = [...(scene[gameRootId]._children || []), { __id__: stageId }];

// ── 檢查（寧可不寫，也不要寫壞）──────────────────────────────
const problems = [];
scene.forEach((o, i) => {
    if (!o) problems.push(`第 ${i} 個物件是空的`);
    if (o && o.__type__ === 'cc.Node') {
        (o._children || []).forEach(c => {
            if (!scene[c.__id__]) problems.push(`${o._name} 指到不存在的子節點 ${c.__id__}`);
        });
    }
});
if (problems.length) {
    console.error('✗ 產生出來的場景有問題，沒有寫檔：');
    problems.slice(0, 10).forEach(p => console.error('   ' + p));
    process.exit(1);
}

console.log(`節點樹共 ${count} 個 GameObject，場景物件數 ${scene.length}`);
if (!WRITE) {
    console.log('\n這是預演，沒有寫檔。確認沒問題就加 --write：');
    console.log('    node tools/genlayout.js --write');
    console.log('\n⚠ 寫檔前務必先關掉 Cocos 編輯器 —— 它會抱著記憶體裡的舊場景把你的改動蓋回去。');
    process.exit(0);
}

// 備份放在 assets/ 外面 —— 放裡面 Cocos 會把 .bak 也當成資產去匯入，
// 還會生一個 .bak.meta 出來礙眼。local/ 本來就在 .gitignore 裡。
const backupDir = path.join(ROOT, 'local');
fs.mkdirSync(backupDir, { recursive: true });
const backup = path.join(backupDir, `game.scene.${Date.now()}.bak`);
fs.copyFileSync(SCENE, backup);
fs.writeFileSync(SCENE, JSON.stringify(scene, null, 2), 'utf8');
console.log(`\n已寫入 ${SCENE}`);
console.log(`舊檔備份在 ${backup}（要還原就把它改回 game.scene）`);
console.log('\n開 Cocos 就會看到 GameRoot 底下多出整棵 stage 節點樹，直接拖就能調版面。');
