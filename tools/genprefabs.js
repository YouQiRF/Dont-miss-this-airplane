/**
 * 產生 6 個預設 Prefab（assets/prefabs/）。
 *
 *   node tools/genprefabs.js            已存在就跳過
 *   node tools/genprefabs.js --force    重建（請先關閉 Cocos 編輯器）
 *
 * 每個 Prefab 就是「一個節點 + AviaVectorArt 元件」，內容是 AviaArt.ts 的預設美術。
 * +N / ×N 另外帶一個名叫 value 的 Label 子節點，遊戲會把數字寫進去。
 *
 * 這些 Prefab 是給你當「替換的起點」用的：
 *   · Inspector ⑨ 物件 Prefab 留空 → 遊戲直接用預設美術（不需要這些檔案也能跑）
 *   · 把 Prefab 拉進槽位 → 換成 Prefab 的外觀
 *   · 想換美術就編輯 Prefab：關掉 AviaVectorArt 的 drawDefaultArt，換上自己的 Sprite
 */

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'assets/prefabs');
const FORCE = process.argv.includes('--force');
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const compressUuid = (uuid) => {
    const hex = uuid.replace(/-/g, '');
    let s = hex.slice(0, 5);
    for (let i = 5; i < hex.length; i += 3) {
        const v = parseInt(hex.slice(i, i + 3), 16);
        s += B64[v >> 6] + B64[v & 63];
    }
    return s;
};

const keepUuid = (rel) => {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')).uuid; }
    catch { return randomUUID(); }
};

// AviaVectorArt 元件的型別 = AviaArt.ts 的 uuid 壓縮碼
const ART_TYPE = compressUuid(keepUuid('assets/scripts/AviaArt.ts.meta'));

// ArtKind 的數值，必須跟 AviaArt.ts 對得上
const KIND = { Plane: 0, Carrier: 1, CarrierDest: 2, Pickup: 3, Boost: 4, Rocket: 5 };

const ITEMS = [
    { file: 'Plane', kind: KIND.Plane, w: 90, h: 60, label: null },
    { file: 'Carrier', kind: KIND.Carrier, w: 330, h: 240, label: null },
    { file: 'CarrierDest', kind: KIND.CarrierDest, w: 330, h: 240, label: null },
    { file: 'Pickup', kind: KIND.Pickup, w: 72, h: 72, label: '+2' },
    { file: 'Boost', kind: KIND.Boost, w: 72, h: 72, label: '×3' },
    { file: 'Rocket', kind: KIND.Rocket, w: 130, h: 72, label: null },
];

const V3 = (x, y, z) => ({ __type__: 'cc.Vec3', x, y, z });
const COL = (r, g, b, a) => ({ __type__: 'cc.Color', r, g, b, a });

function buildPrefab(item) {
    const a = [];
    const push = (o) => (a.push(o), a.length - 1);
    const hasLabel = item.label !== null;

    // 0 cc.Prefab / 1 根節點 / 2 UITransform / 3 Graphics / 4 AviaVectorArt / 5 PrefabInfo
    // 有 label 時再加：6 value 節點 / 7 UITransform / 8 Label / 9 PrefabInfo
    push({ __type__: 'cc.Prefab', _name: item.file, _objFlags: 0, __editorExtras__: {}, _native: '', data: { __id__: 1 }, optimizationPolicy: 0, persistent: false });

    const rootComps = [{ __id__: 2 }, { __id__: 3 }, { __id__: 4 }];
    push({
        __type__: 'cc.Node', _name: item.file, _objFlags: 0, __editorExtras__: {},
        _parent: null, _children: hasLabel ? [{ __id__: 6 }] : [], _active: true,
        _components: rootComps, _prefab: { __id__: hasLabel ? 10 : 5 },
        _lpos: V3(0, 0, 0), _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
        _lscale: V3(1, 1, 1), _mobility: 0, _layer: 33554432, _euler: V3(0, 0, 0),
    });
    push({
        __type__: 'cc.UITransform', _name: '', _objFlags: 0, __editorExtras__: {},
        node: { __id__: 1 }, _enabled: true, __prefab: null,
        _contentSize: { __type__: 'cc.Size', width: item.w, height: item.h },
        _anchorPoint: { __type__: 'cc.Vec2', x: 0.5, y: 0.5 }, _id: '',
    });
    push({
        __type__: 'cc.Graphics', _name: '', _objFlags: 0, __editorExtras__: {},
        node: { __id__: 1 }, _enabled: true, __prefab: null,
        _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: COL(255, 255, 255, 255), _lineWidth: 1, _strokeColor: COL(0, 0, 0, 255),
        _lineJoin: 2, _lineCap: 0, _fillColor: COL(255, 255, 255, 255),
        _miterLimit: 10, _id: '',
    });
    push({
        __type__: ART_TYPE, _name: '', _objFlags: 0, __editorExtras__: {},
        node: { __id__: 1 }, _enabled: true, __prefab: null,
        kind: item.kind, drawDefaultArt: true, _id: '',
    });

    if (hasLabel) {
        push({
            __type__: 'cc.Node', _name: 'value', _objFlags: 0, __editorExtras__: {},
            _parent: { __id__: 1 }, _children: [], _active: true,
            _components: [{ __id__: 7 }, { __id__: 8 }], _prefab: { __id__: 9 },
            _lpos: V3(0, 0, 0), _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
            _lscale: V3(1, 1, 1), _mobility: 0, _layer: 33554432, _euler: V3(0, 0, 0),
        });
        push({
            __type__: 'cc.UITransform', _name: '', _objFlags: 0, __editorExtras__: {},
            node: { __id__: 6 }, _enabled: true, __prefab: null,
            _contentSize: { __type__: 'cc.Size', width: 60, height: 32 },
            _anchorPoint: { __type__: 'cc.Vec2', x: 0.5, y: 0.5 }, _id: '',
        });
        push({
            __type__: 'cc.Label', _name: '', _objFlags: 0, __editorExtras__: {},
            node: { __id__: 6 }, _enabled: true, __prefab: null,
            _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4,
            _color: COL(20, 32, 48, 255), _string: item.label, _horizontalAlign: 1,
            _verticalAlign: 1, _actualFontSize: 26, _fontSize: 26, _fontFamily: 'Arial',
            _lineHeight: 30, _overflow: 0, _enableWrapText: false, _font: null,
            _isSystemFontUsed: true, _spacingX: 0, _isItalic: false, _isBold: true,
            _isUnderline: false, _underlineHeight: 2, _cacheMode: 0, _enableOutline: false,
            _outlineColor: COL(0, 0, 0, 255), _outlineWidth: 2, _enableShadow: false,
            _shadowColor: COL(0, 0, 0, 255), _shadowOffset: { __type__: 'cc.Vec2', x: 2, y: 2 },
            _shadowBlur: 2, _id: '',
        });
        push({ __type__: 'cc.CompPrefabInfo', fileId: 'valueNode0000000000000' });
    }
    // 根節點的 PrefabInfo 一定放最後
    push({
        __type__: 'cc.PrefabInfo', root: { __id__: 1 }, asset: { __id__: 0 },
        fileId: `${item.file}Root00000000000`.slice(0, 22), instance: null,
        targetOverrides: null, nestedPrefabInstanceRoots: null,
    });
    return a;
}

fs.mkdirSync(DIR, { recursive: true });

// 資料夾 meta
const dirMetaPath = path.join(ROOT, 'assets/prefabs.meta');
if (FORCE || !fs.existsSync(dirMetaPath)) {
    fs.writeFileSync(dirMetaPath, JSON.stringify({
        ver: '1.2.0', importer: 'directory', imported: true,
        uuid: keepUuid('assets/prefabs.meta'), files: [], subMetas: {}, userData: {},
    }, null, 2), 'utf8');
}

let made = 0, skipped = 0;
for (const item of ITEMS) {
    const p = path.join(DIR, `${item.file}.prefab`);
    const mp = `${p}.meta`;
    if (!FORCE && fs.existsSync(p)) { skipped++; continue; }
    fs.writeFileSync(p, JSON.stringify(buildPrefab(item), null, 2), 'utf8');
    fs.writeFileSync(mp, JSON.stringify({
        ver: '1.1.50', importer: 'prefab', imported: true,
        uuid: keepUuid(path.relative(ROOT, mp).replace(/\\/g, '/')),
        files: ['.json'], subMetas: {}, userData: { syncNodeName: item.file },
    }, null, 2), 'utf8');
    made++;
}

console.log(`AviaVectorArt 型別碼 = ${ART_TYPE}`);
console.log(`產生 ${made} 個 Prefab，跳過 ${skipped} 個已存在的`);
if (skipped && !FORCE) console.log('要重建請加 --force（先關閉 Cocos 編輯器）');
