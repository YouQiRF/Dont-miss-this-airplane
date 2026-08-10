# Aviamasters 型玩法 — Cocos 離線版

**Cocos Creator 3.8.6**（3.7.x / 3.8.x 皆可,改 `package.json` 的 `creator.version` 即可）
純程式繪製,**不需要任何美術素材**,匯入就能跑。

## 開起來

1. Cocos Dashboard → 專案 → 加入 → 選 `avia-cocos` 資料夾
2. 開啟 `assets/scenes/game.scene`
3. 按預覽 ▶

場景已經建好：`Canvas → GameRoot`,`AviaGame` 組件已掛上,所有參數都在 Inspector。
設計解析度 1280×720（Project Settings 可改,程式會讀實際 Canvas 尺寸自適應）。

## 三個檔案

| 檔案 | 職責 | 依賴 |
|---|---|---|
| `AviaPath.ts` | **航線合成演算法**。結果 → 物件序列 → 航線曲線 → 演出節拍 | 無（不 import `cc`,可單獨在 node 跑） |
| `AviaView.ts` | **畫面表演**。海浪、雲、天空、鏡頭、航母、飛機、尾煙、物件、特效、HUD、按鈕 | `cc` |
| `AviaGame.ts` | 組件本體。Inspector 參數、下注、局流程、輸入 | `cc` + 上面兩支 |

`AviaView` 完全不認識「倍數」「結果」,它只消費 `PerformanceScript`。
想換成 3D、換成 Spine 骨架、換成別的美術風格,只要重寫 `AviaView`,演算法一行都不用動。

---

## 航線演算法

> Server 只給 `{ multiplier, landed }`。客戶端反推一條「演起來剛好等於這個結果」的航線。

### 五條硬規則

| 規則 | 怎麼保證的 |
|---|---|
| **不用物理** | 沒有重力、沒有速度積分、沒有終端速度。航線 = 關鍵影格 + Catmull-Rom 取樣 |
| **每一階等高** | 所有 `+N`／`×N` 一律 `+STEP_UP`,所有火箭一律 `−STEP_DOWN`。與數字大小、當前高度都無關 |
| **天空不封頂** | 高度沒有上限,`MAX_ALT = 0`。飛多高都行,垂直鏡頭會跟上去 |
| **一定有終點** | 局長上限 = `max(MAX_ROUND_TICKS, 最緊排列所需長度)` → 這個上限一定達得到。贏 = 降落目的艦,輸 = 墜海（目的艦仍在前方可見） |
| **誘餌碰不到** | 幾何淨空硬檢查：誘餌與航線的距離 > `碰撞半徑 × DECOY_CLEARANCE`,而且是檢查整個佔位寬度而非單一 tick |

### 流程

```
① 用 roundId 當 seed 開一條確定性亂數流（重整後重播一模一樣）
② 反向分解：從最終倍數倒推回 1
      正向  +k   ×m   ÷2(火箭)
      逆向  -k   ÷m   ×2
   只有火箭能製造小數 → 0.5× 必然含奇數顆火箭
③ 編排階梯：第 i 個物件的高度 = 第 i-1 個 ± 一個固定階距
④ 補關鍵影格：命中點 → 短暫彈起 → 段落中間的下垂 → 下一個命中點
⑤ Catmull-Rom 取樣成逐 tick 曲線,俯仰角取曲線斜率
⑥ 收尾：降落曲線落在目的艦甲板,或墜海曲線砸進水裡
⑦ 灑誘餌 —— 場上一堆無關緊要的加減數字,飛機保證碰不到
```

### 為什麼下垂量不會讓飛機提前墜海

段落下垂量會依「離下緣還剩多少空間」自動收斂：

```ts
const room = Math.min(popY, nextY) - FLOOR_Y;
const sag  = Math.min(SAG * style.sag, room * 0.55);
```

`0.55 < 1`,所以曲線在數學上不可能穿過 `FLOOR_Y`。不需要任何修補迴圈或保險絲。

### 算術精確性

起點 1,運算只有「加整數 / 乘整數 / 除以 2」→ 所有可達值都是 `k/2^j`(二進位有理數)
→ **double 完全精確,不需要定點數**。
（只有把 `rocketDivisor` 改成非 2 的值時才會失準,那時會自動退回近似值並在 Console 警告。）

---

## Inspector 參數（8 組）

| 組 | 重點欄位 |
|---|---|
| ① 下注 | `betOptions` 下注額清單（有幾個就出現幾顆籌碼）、`startingBalance`、`currencySymbol` |
| ② 符號數值 | `pickupValues` `+N` 清單、`boostValues` `×N` 清單、`rocketDivisor`、`pickupStepTarget`（調高 → 物件更多） |
| ③ 離線結果 | `winChance`、`multiplierPool`、`biasPower` |
| ④ 航線編排 | `stepUp` / `stepDown`（**等高階梯的階距**）、`sag`、`baseGap`（**物件密度**）、`maxAlt`（0 = 不封頂）、`maxRoundTicks`（**終點上限**）、`decoyDensity` / `decoyClearance` |
| ⑤ 手感範圍 | 每局在區間內隨機的只有「間距」與「下垂」。**階梯高度不在此列 —— 它永遠等高** |
| ⑥ 播放速度 | 四段 tick 毫秒數、預設速度、autoSpin |
| ⑦ 畫面 | 水面高度、飛機螢幕位置、**鏡頭跟隨**（`camFollowStart` / `camLag`）、尾煙、震動、全部顏色 |
| ⑧ 測試 | `forceResult` + `forceMultiplier` + `forceLanded` + `forceSeed` + `showDebugPath` |

### 想要什麼就調哪一根

| 想要 | 調這個 |
|---|---|
| 升降幅度再小一點 | ④ `stepUp` / `stepDown` |
| 場上物件再多一點 | ④ `baseGap` 調小,② `pickupStepTarget` 調大,② `boostChance` 調小 |
| 誘餌再多一點 | ④ `decoyDensity` |
| 航線更平直（去掉滑翔起伏） | ④ `sag` 設 0 |
| 鏡頭更早開始跟 | ⑦ `camFollowStart` 調小 |
| 限制最高高度 | ④ `maxAlt` 設非 0（代價：碰到上限那幾階會變平,不再等高） |
| 局再短一點 | ④ `maxRoundTicks` 調小 |

**測試建議**：打開 `forceResult`,把 `forceMultiplier` 設成 250,連按 SPIN ——
每次都會生出不同的航線,但最後一定是 250×。這就是「結果先決」的直觀驗證。
再填一個 `forceSeed`,就會每次長出同一條航線。
打開 `showDebugPath` 會把整條預算曲線畫出來。

---

## 畫面表演

三層視差海浪、垂直循環的雲、**會隨高度往深藍染色並浮出星點的天空**、兩艘航母、
向量飛機（俯仰角取曲線斜率）、漸層尾煙、物件命中的撐大→收縮、浮字、螢幕震動、
火箭閃光+放射水花、墜海水柱+機身下沉、降落煙霧、
BIG / MEGA / SUPER MEGA 分層大字、高度/距離/倍數 HUD。

**垂直鏡頭**：飛機超過畫面高度的 `camFollowStart` 之後,鏡頭開始往上跟,沒有上限。
海面、物件、特效都掛在 `camRoot` 底下一起移動;天空與雲自己做視差;HUD 與 UI 固定不動。

---

## 離線 → 線上

`AviaPath.ts` 最底下的 `offlineResult()` 換成一次 HTTP request 就好,其餘程式碼一行不用改：

```ts
const result = await fetch('/api/spin', { ... }).then(r => r.json());
// → { roundId, multiplier, landed }
const script = buildPerformance(result);
```

因為這個玩法**沒有 cash out**,整局腳本可以一次性下發給客戶端 —— 就算玩家把結果挖出來
也無法改變任何事（錢已經下了,沒有任何按鈕可按）。這是砍掉 cash out 換來的架構紅利：
不用 WebSocket、不用逐 tick 推送、斷線重整可完美續播。

---

## 驗證工具

```bash
node tools/verify.ts
```

不需要 Cocos。22 個倍數 × 400 seed = 8800 局 + 3000 局落海,逐局檢查：

- 演出結果精確等於目標倍數,物件鏈重算一致
- 命中物件確實落在航線上
- 飛行途中不觸水
- **誘餌淨空 > 碰撞半徑**（碰不到的硬保證）
- **航線有限、有終點、在上限之內**,`frames` 長度與終點相符
- **每一階的高度差都等於同一個常數**（觸底除外）
- 墜海位置分佈不集中在最後一格

目前結果：**0 失敗**。航程 13–299 tick（平均 93）、命中物件平均 7.6 個、
誘餌平均 14 個、最高點 164–1213px、誘餌最小淨空 66.7px（碰撞半徑 46）。

同時會印出四局 ASCII 航線圖供肉眼檢查 —— 可以直接看到等高階梯的形狀。
