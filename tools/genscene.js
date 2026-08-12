// 產生 Cocos Creator 3.8 專案骨架：meta / scene / settings
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const ROOT = 'C:/Users/youqichang/avia-cocos';
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

/**
 * ⚠ 這支腳本只在「從零建立專案」時需要跑一次。
 *
 * 平常改程式碼、加 @property 都不用碰它 —— 場景檔只存你在 Inspector 手動改過的覆寫值,
 * 沒存到的欄位 Cocos 會自動用 class 裡的預設值,新欄位照樣會出現在 Inspector。
 *
 * 如果在 Cocos 開著的時候覆寫 game.scene / *.meta,編輯器接不住外部改動,
 * 就會逼你重開編輯器。所以預設會跳過已存在的檔案,要真的重建才加 --force。
 */
const FORCE = process.argv.includes('--force');
let skipped = 0;

const w = (p, data) => {
  const full = path.join(ROOT, p);
  if (!FORCE && fs.existsSync(full)) { skipped++; return full; }
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, typeof data === 'string' ? data : JSON.stringify(data, null, 2), 'utf8');
  return full;
};

// ───── uuid（冪等：已存在的 meta 就沿用,重跑不會換 uuid、不會害 Cocos 重匯入）─────
const keep = (rel, fallbackKey) => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')).uuid; }
  catch { return randomUUID(); }
};
const U = {
  project: (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).uuid; } catch { return randomUUID(); } })(),
  dirScripts: keep('assets/scripts.meta'),
  dirScenes: keep('assets/scenes.meta'),
  path: keep('assets/scripts/AviaPath.ts.meta'),
  viewS: keep('assets/scripts/AviaView.ts.meta'),
  art: keep('assets/scripts/AviaArt.ts.meta'),
  audio: keep('assets/scripts/AviaAudio.ts.meta'),
  defaults: keep('assets/scripts/AviaDefaults.ts.meta'),
  game: keep('assets/scripts/AviaGame.ts.meta'),
  scene: keep('assets/scenes/game.scene.meta'),
};
const GAME_TYPE = compressUuid(U.game);

// ───── meta ─────
const dirMeta = (uuid) => ({
  ver: '1.2.0', importer: 'directory', imported: true, uuid,
  files: [], subMetas: {}, userData: {},
});
const tsMeta = (uuid, file) => ({
  ver: '4.0.24', importer: 'typescript', imported: true, uuid,
  files: [], subMetas: {},
  userData: { moduleId: `project:///assets/scripts/${file}` },
});

w('assets/scripts.meta', dirMeta(U.dirScripts));
w('assets/scenes.meta', dirMeta(U.dirScenes));
w('assets/scripts/AviaPath.ts.meta', tsMeta(U.path, 'AviaPath.ts'));
w('assets/scripts/AviaView.ts.meta', tsMeta(U.viewS, 'AviaView.ts'));
w('assets/scripts/AviaArt.ts.meta', tsMeta(U.art, 'AviaArt.ts'));
w('assets/scripts/AviaAudio.ts.meta', tsMeta(U.audio, 'AviaAudio.ts'));
w('assets/scripts/AviaDefaults.ts.meta', tsMeta(U.defaults, 'AviaDefaults.ts'));
w('assets/scripts/AviaGame.ts.meta', tsMeta(U.game, 'AviaGame.ts'));
w('assets/scenes/game.scene.meta', {
  ver: '1.1.51', importer: 'scene', imported: true, uuid: U.scene,
  files: ['.json'], subMetas: {}, userData: {},
});

// ───── 場景 ─────
const W = 1280, H = 720;
const V3 = (x, y, z) => ({ __type__: 'cc.Vec3', x, y, z });
const COL = (r, g, b, a) => ({ __type__: 'cc.Color', r, g, b, a });
const node = (name, parent, children, comps, lpos, layer) => ({
  __type__: 'cc.Node', _name: name, _objFlags: 0, __editorExtras__: {},
  _parent: parent, _children: children, _active: true, _components: comps,
  _prefab: null, _lpos: lpos,
  _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
  _lscale: V3(1, 1, 1), _mobility: 0, _layer: layer, _euler: V3(0, 0, 0),
});
const uiTransform = (id, width, height) => ({
  __type__: 'cc.UITransform', _name: '', _objFlags: 0, __editorExtras__: {},
  node: { __id__: id }, _enabled: true, __prefab: null,
  _contentSize: { __type__: 'cc.Size', width, height },
  _anchorPoint: { __type__: 'cc.Vec2', x: 0.5, y: 0.5 }, _id: '',
});

// AviaGame 的 Inspector 初值（對應 AviaGame.ts 的 @property 預設）
const gameProps = {
  betOptions: [0.1, 0.5, 1, 2, 5, 10, 25, 50, 100],
  defaultBetIndex: 2,
  startingBalance: 1000,
  currencySymbol: '$',
  autoDowngradeBet: true,

  pickupValues: [1, 2, 5, 10],
  boostValues: [2, 3, 4, 5],
  rocketDivisor: 2,
  maxObjects: 30,
  maxRockets: 6,
  boostChance: 0.30,
  rocketChance: 0.22,
  pickupStepTarget: 8,

  winChance: 0.5,
  biasPower: 2.1,
  multiplierPool: [0.25, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8,
    10, 12, 15, 20, 25, 40, 60, 80, 120, 250],

  // ④ 航線編排
  stepUp: 82, stepDown: 82, glideDrop: 30,
  arcApexBias: 1, rocketDiveFrac: 0.45, lastArcTicks: 7,
  takeoffSteps: 2, minAlt: 130, maxAlt: 0, decoyMinY: 24,
  baseGap: 9, gapJitter: 0.35, minGap: 6, maxGap: 22, takeoffTicks: 10,
  pxPerTick: 40, pitchRun: 34, pitchMaxDeg: 42,
  landRate: 9, landTicksMin: 10, landTicksMax: 34,
  splashRate: 14, splashTicksMin: 8, splashTicksMax: 22,
  maxRoundTicks: 300, hitRadius: 46,
  decoyDensity: 0.35, decoyClearance: 1.9, decoyNearMiss: 1.45, altDisplayMax: 420,

  // ⑤ 手感範圍
  gapMin: 0.85, gapMax: 1.20,

  tickMsSlow: 140, tickMsMedium: 82, tickMsFast: 50, tickMsUltra: 24,
  defaultSpeed: 1, autoSpin: false, autoSpinDelay: 1.2, endHoldSeconds: 1.8,

  waterScreenY: 110, planeScreenXRatio: 0.34,
  camFollowStart: 0.62, camLag: 4, rocketApproach: 55,
  seaCarrierSpacing: 1500, metersPerPx: 0.25, distanceUnit: 'm',
  trailEnabled: true, trailLength: 26, shakeIntensity: 14, showDebugPath: false,
  skyTop: COL(38, 96, 168, 255),
  skyBottom: COL(150, 214, 236, 255),
  skyHigh: COL(8, 14, 46, 255),
  seaDeep: COL(18, 70, 122, 255),
  seaLight: COL(30, 108, 168, 255),
  foam: COL(220, 246, 255, 190),
  planeBody: COL(242, 246, 252, 255),
  planeAccent: COL(228, 84, 62, 255),
  trailColor: COL(255, 255, 255, 255),
  pickupColor: COL(92, 226, 200, 255),
  boostColor: COL(255, 202, 70, 255),
  rocketColor: COL(240, 78, 78, 255),
  carrierColor: COL(126, 142, 160, 255),
  hudColor: COL(196, 222, 244, 255),
  hudAccent: COL(255, 202, 70, 255),
  textColor: COL(255, 255, 255, 255),

  forceResult: false, forceLanded: true, forceMultiplier: 15,
  forceSeed: '', logRound: true,
};

//  id 配置
//  0 SceneAsset | 1 Scene | 2 Canvas | 3 Camera節點 | 4 cc.Camera
//  5 GameRoot   | 6 GameRoot.UITransform | 7 AviaGame
//  8 Canvas.UITransform | 9 cc.Canvas | 10 cc.Widget | 11 SceneGlobals
const scene = [
  {
    __type__: 'cc.SceneAsset', _name: 'game', _objFlags: 0,
    __editorExtras__: {}, _native: '', scene: { __id__: 1 },
  },
  {
    __type__: 'cc.Scene', _name: 'game', _objFlags: 0, __editorExtras__: {},
    _parent: null, _children: [{ __id__: 2 }], _active: true, _components: [],
    _prefab: null, _lpos: V3(0, 0, 0),
    _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
    _lscale: V3(1, 1, 1), _mobility: 0, _layer: 1073741824, _euler: V3(0, 0, 0),
    autoReleaseAssets: false, _globals: { __id__: 11 }, _id: U.scene,
  },
  node('Canvas', { __id__: 1 }, [{ __id__: 3 }, { __id__: 5 }],
    [{ __id__: 8 }, { __id__: 9 }, { __id__: 10 }], V3(W / 2, H / 2, 0), 33554432),
  node('Camera', { __id__: 2 }, [], [{ __id__: 4 }], V3(0, 0, 1000), 1073741824),
  {
    __type__: 'cc.Camera', _name: '', _objFlags: 0, __editorExtras__: {},
    node: { __id__: 3 }, _enabled: true, __prefab: null,
    _projection: 0, _priority: 1073741824, _fov: 45, _fovAxis: 0,
    _orthoHeight: H / 2, _near: 1, _far: 2000,
    _color: COL(0, 0, 0, 255), _depth: 1, _stencil: 0, _clearFlags: 7,
    _rect: { __type__: 'cc.Rect', x: 0, y: 0, width: 1, height: 1 },
    _aperture: 19, _shutter: 7, _iso: 0, _screenScale: 1,
    _visibility: 41943040, _targetTexture: null, _postProcess: null,
    _usePostProcess: false, _cameraType: -1, _trackingType: 0, _id: '',
  },
  node('GameRoot', { __id__: 2 }, [], [{ __id__: 6 }, { __id__: 7 }], V3(0, 0, 0), 33554432),
  uiTransform(5, W, H),
  Object.assign({
    __type__: GAME_TYPE, _name: '', _objFlags: 0, __editorExtras__: {},
    node: { __id__: 5 }, _enabled: true, __prefab: null,
  }, gameProps, { _id: '' }),
  uiTransform(2, W, H),
  {
    __type__: 'cc.Canvas', _name: '', _objFlags: 0, __editorExtras__: {},
    node: { __id__: 2 }, _enabled: true, __prefab: null,
    _cameraComponent: { __id__: 4 }, _alignCanvasWithScreen: true, _id: '',
  },
  {
    __type__: 'cc.Widget', _name: '', _objFlags: 0, __editorExtras__: {},
    node: { __id__: 2 }, _enabled: true, __prefab: null,
    _alignFlags: 45, _target: null,
    _left: 0, _right: 0, _top: 0, _bottom: 0,
    _horizontalCenter: 0, _verticalCenter: 0,
    _isAbsLeft: true, _isAbsRight: true, _isAbsTop: true, _isAbsBottom: true,
    _isAbsHorizontalCenter: true, _isAbsVerticalCenter: true,
    _originalWidth: 0, _originalHeight: 0,
    _alignMode: 2, _lockFlags: 0, _id: '',
  },
  { __type__: 'cc.SceneGlobals' },
];

w('assets/scenes/game.scene', scene);

// ───── 專案設定 ─────
w('package.json', {
  name: 'avia-cocos',
  uuid: U.project,
  version: '3.8.6',
  creator: { version: '3.8.6' },
  type: '2d',
});

w('settings/v2/packages/project.json', {
  general: {
    designResolution: { width: W, height: H, fitWidth: false, fitHeight: true },
  },
});

w('settings/v2/packages/engine.json', {
  modules: { includeModules: [], cache: {} },
});

w('tsconfig.json', JSON.stringify({
  extends: './temp/tsconfig.cocos.json',
  compilerOptions: { strict: false, target: 'ES2015', module: 'ES2015' },
}, null, 2));

w('.gitignore', ['library/', 'temp/', 'local/', 'build/', 'profiles/', 'native/', '.DS_Store', ''].join('\n'));

console.log('AviaGame __type__ =', GAME_TYPE);
console.log('uuid AviaGame     =', U.game);
console.log('scene uuid        =', U.scene);
if (skipped && !FORCE) {
  console.log(`\n跳過 ${skipped} 個已存在的檔案（沒有動任何東西）。`);
  console.log('平常不需要跑這支腳本；真的要整個重建場景才加 --force,');
  console.log('而且務必先關閉 Cocos 編輯器,否則它會抱著舊的場景把你的改動蓋回去。');
} else {
  console.log('OK');
}
