# Inspector 參數預設值

共 **150** 個參數，全部可在 Cocos 的 Inspector 調整。

這份文件由 `node tools/gendefaults.js` 從 `AviaGame.ts` 自動產生，改完預設值重跑一次就同步。

**還原預設值**：Inspector 最後一組（測試）有一個「還原預設值」勾選框，
勾一下就把 125 個欄位設回這裡的值。
標成「（未指定）」的 25 個是 Prefab / AudioClip 等資產參考，
**還原時不會被清空** —— 拖好的美術與音檔不會因為按錯一下就消失。

**驗證覆蓋率**：`node tools/audit-inspector.ts` 會檢查演算法裡每個可設定變數
是否都真的接進了 Inspector（目前 71/71 全接）。

---

## ① 下注

| 參數 | 預設值 | 說明 |
|---|---|---|
| `betOptions` | `[0.1, 0.5, 1, 2, 5, 10, 25, 50, 100]` | 可選下注額。有幾個就出現幾顆籌碼,順序即按鈕順序 |
| `defaultBetIndex` | `2` | 預設選中第幾個下注額（從 0 起算） |
| `startingBalance` | `1000` | 起始餘額 |
| `currencySymbol` | `'$'` | 幣別符號 |
| `autoDowngradeBet` | `true` | 餘額不足時自動降到買得起的最大下注額 |
| `autoCountOptions` | `[10, 25, 50, 100, 0]` | 自動下注的局數選項。有幾個就出現幾顆按鈕；最後一個固定是無限循環（顯示 ∞），數值忽略 |
| `stopAmountSteps` | `[0, 1, 2, 5, 10, 25, 50, 100, 250, 500]` | 停止條件金額的可選級距（單位：當前下注額的倍數）。第一個 0 = 關閉 |
| `autoInterval` | `0.5` | 自動下注每局之間的間隔（秒） |

## ② 符號數值

| 參數 | 預設值 | 說明 |
|---|---|---|
| `pickupValues` | `[1, 2, 5, 10]` | 加值物件（+N）。想改成 +1/+3/+7 就直接改這裡 |
| `boostValues` | `[2, 3, 4, 5]` | 乘算物件（×N）。必須 > 1 |
| `rocketDivisor` | `2` | 火箭除數。預設 2（÷2）。非 2 的值會讓部分倍數湊不出來,系統會自動退回近似值 |
| `maxObjects` | `30` | 一局最多幾個命中物件 |
| `maxRockets` | `6` | 一局最多幾顆火箭 |
| `boostChance` | `0.30` | 分解時優先用乘算的機率。調低 → 改用加值湊 → 場上物件變多 |
| `rocketChance` | `0.22` | 分解時額外塞火箭的機率 |
| `pickupStepTarget` | `8` | 期望用幾步加值湊完。調高 → 每步變小 → 場上物件變多 |

## ③ 離線結果

| 參數 | 預設值 | 說明 |
|---|---|---|
| `offlineMode` | `true` | 打勾 = 離線版（結果本地隨機，不連線）；取消 = 正式版（向 serverUrl 要結果） |
| `serverUrl` | `''` | 正式版的開局 API。會 POST { bet } 並期待回傳 { roundId, multiplier, landed } |
| `requestTimeout` | `8` | 正式版連線逾時（秒）。逾時或失敗會退款並顯示錯誤，不會偷偷用本地結果頂替 |
| `winChance` | `0.5` | 【僅離線版】降落成功率 |
| `biasPower` | `2.1` | 倍數偏移次方。越大越偏小倍數 |
| `multiplierPool` | `[ 0.25, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10, 12, 15, 20, 25, 40, 60, 80, 120, 250, ]` | 離線抽獎用的倍數池 |

## ④ 航線編排

| 參數 | 預設值 | 說明 |
|---|---|---|
| `stepUp` | `82` | 【只有吃到才上升】吃到任何 +N 或 ×N,弧線頂點比命中點高這麼多 px。與數字大小、當前高度都無關 |
| `stepDown` | `82` | 【只有飛彈才有下降表演】吃到飛彈一律往下砸這麼多 px |
| `glideDrop` | `30` | 【弧線後半】每段從頂點再往下掉這麼多 px。每個物件的淨變化 = ±階距 − 這個值 |
| `arcApexBias` | `1` | 弧線頂點位置偏移。1 = 幾何上正確的彈道頂點。調小 → 頂點提前、上升急促;調大 → 頂點延後、爬升悠長 |
| `rocketDiveFrac` | `0.45` | 飛彈命中後,前幾成的段落用來俯衝,其餘滑降。調小 → 撞擊更猛 |
| `lastArcTicks` | `7` | 最後一個物件的升／降表演長度（tick）,之後交給收尾段 |
| `slideDecelTicks` | `11` | 觸艦後減速滑行幾 tick 停下（實際 tick 數會依滑行距離等比縮放） |
| `edgeLandChance` | `0.5` | 贏局走「邊緣半截懸空 + 搖晃」的機率。1 = 每局都驚險；0 = 每局都乾淨停在甲板上 |
| `deckStopMin` | `0.35` | 乾淨降落時停在甲板寬度的哪個比例（下限）。0 = 近端邊緣 |
| `deckStopMax` | `0.70` | 乾淨降落的停止位置上限 |
| `edgeOverhang` | `0` | 停下時機身中心相對甲板尾端的位移。0 = 剛好半截機身在外 |
| `minSlideRoom` | `90` | 觸艦點離甲板尾端至少要有這麼多 px,否則當作沒撞到（沒有滑行空間） |
| `wobbleTicks` | `34` | 搖晃總長度（tick）。這個值決定快慢 —— 越大越慢 |
| `wobbleAmpDeg` | `19` | 前傾／抬高的最大角度（度） |
| `wobbleCycles` | `2` | 晃幾下（一下 = 前傾一次 + 抬高一次） |
| `wobbleSink` | `5` | 搖晃時機身中心的上下位移。0 = 完全只有轉動,不上下浮 |
| `settleTicks` | `12` | 穩住收斂的長度（tick） |
| `holdPitchDeg` | `-9` | 穩住後停在邊緣的傾角（度,負 = 機首朝下） |
| `tipTicks` | `13` | 前傾翻落的長度（tick） |
| `tipPitchDeg` | `-78` | 翻落時的最終傾角（度） |
| `takeoffSteps` | `2` | 第一個物件放在甲板上方幾階 |
| `minAlt` | `130` | 航線最低高度（= 甲板高度）。再低就沒有下一階了 |
| `maxAlt` | `0` | 航線最高高度。0 = 不封頂（天空無限,鏡頭會跟上去） |
| `decoyMinY` | `24` | 誘餌可放置的最低高度 |
| `baseGap` | `9` | 物件間距（tick）。調小 → 場上物件更多更密 |
| `gapJitter` | `0.35` | 間距隨機抖動比例 |
| `minGap` | `6` | — |
| `maxGap` | `22` | — |
| `takeoffTicks` | `10` | 從航母甲板起飛到第一個物件的距離（tick） |
| `pxPerTick` | `40` | 每 tick 前進的水平像素 |
| `pitchRun` | `34` | 算俯仰角的水平參考量。調小 → 抬頭更誇張 |
| `pitchMaxDeg` | `42` | 俯仰角上限（度） |
| `landRate` | `9` | 降落段每 tick 下降 px |
| `landTicksMin` | `10` | — |
| `landTicksMax` | `34` | — |
| `splashRate` | `14` | 墜海段每 tick 下降 px |
| `splashTicksMin` | `8` | — |
| `splashTicksMax` | `22` | — |
| `maxRoundTicks` | `300` | 【終點保證】局長 tick 上限。超過會自動縮短物件間距重排。實際上限會取 max(這個值, 最緊排列所需長度),所以一定達得到 |
| `hitRadius` | `46` | 碰撞半徑 |
| `decoyDensity` | `0.35` | 誘餌密度。0 = 場上只有必中物件（會很假） |
| `decoyClearance` | `1.9` | 誘餌離航線的最小淨空 = 碰撞半徑 × 這個倍數。> 1 就保證碰不到 |
| `decoyNearMiss` | `1.45` | 「差一點」誘餌的淨空倍數。仍然必須 > 1 |
| `altDisplayMax` | `420` | HUD 高度條的滿格參考值（純顯示,不是高度上限） |
| `waterY` | `0` | 水面的高度基準。改這個等於整體上下平移航線,通常不用動 |
| `tailTicks` | `26` | 結束之後多留幾 tick 給演出收尾 |

## ⑤ 手感範圍

| 參數 | 預設值 | 說明 |
|---|---|---|
| `gapMin` | `0.85` | 物件間距縮放下限（這是唯一的每局隨機項） |
| `gapMax` | `1.20` | — |

## ⑥ 播放速度

| 參數 | 預設值 | 說明 |
|---|---|---|
| `tickMsSlow` | `140` | 「慢」每 tick 幾毫秒 |
| `tickMsMedium` | `82` | — |
| `tickMsFast` | `50` | — |
| `tickMsUltra` | `24` | — |
| `defaultSpeed` | `1` | 預設速度。速度只改播放快慢,絕不影響結果 |
| `autoSpin` | `false` | 自動連續開局 |
| `autoSpinDelay` | `1.2` | 自動開局間隔（秒） |
| `endHoldSeconds` | `1.8` | 結算後停留幾秒再回到待機 |

## ⑦ 畫面

| 參數 | 預設值 | 說明 |
|---|---|---|
| `waterScreenY` | `110` | 水面距畫面底部的高度 |
| `planeScreenXRatio` | `0.34` | 飛機固定在畫面寬度的幾成位置 |
| `camFollowStart` | `0.62` | 飛機超過畫面高度的幾成時,鏡頭開始往上跟 |
| `camLag` | `4` | 鏡頭跟隨速度。越大越硬,越小越飄 |
| `rocketApproach` | `55` | 飛彈額外的向左速度（px/tick）。飛彈一律從畫面右側往左飛,越大越晚出現、飛得越快 |
| `seaCarrierSpacing` | `1500` | 海面航母的間距（px）。跟目的艦長得一模一樣,整片海會持續有船經過。0 = 關閉 |
| `carrierHalfWidth` | `152` | 航母甲板的半寬（px）。同時決定碰撞範圍與「半截懸空」的停止點 |
| `seaCarrierJitter` | `0.25` | 海面航母位置的隨機抖動比例,免得排成整齊一列 |
| `metersPerPx` | `0.25` | HUD 讀數的單位換算：1 px = 幾個顯示單位。純表演,不影響任何邏輯 |
| `distanceUnit` | `'m'` | HUD 讀數的單位文字 |
| `trailEnabled` | `true` | — |
| `trailLength` | `26` | 尾煙保留幾個取樣點 |
| `shakeIntensity` | `14` | 螢幕震動強度。0 = 關閉 |
| `showDebugPath` | `false` | 把整條預算航線畫出來（調參用） |
| `skyTop` | `#2660a8` | — |
| `skyBottom` | `#96d6ec` | — |
| `skyHigh` | `#080e2e` | 高空時天空要染向的顏色 |
| `seaDeep` | `#12467a` | — |
| `seaLight` | `#1e6ca8` | — |
| `foam` | `#dcf6ff` (a=190) | — |
| `planeBody` | `#f2f6fc` | — |
| `planeAccent` | `#e4543e` | — |
| `trailColor` | `#ffffff` | — |
| `pickupColor` | `#5ce2c8` | — |
| `boostColor` | `#ffca46` | — |
| `rocketColor` | `#f04e4e` | — |
| `carrierColor` | `#7e8ea0` | — |
| `hudColor` | `#c4def4` | — |
| `hudAccent` | `#ffca46` | — |
| `textColor` | `#ffffff` | — |

## ⑧ 結算動畫權重

| 參數 | 預設值 | 說明 |
|---|---|---|
| `weightDeckLand` | `1` | 【贏】乾淨停在甲板上,不懸空不搖晃 |
| `weightEdgeHold` | `1` | 【贏】衝到邊緣半截懸空,搖晃兩下後穩住 |
| `weightSplash` | `3` | 【輸】直接砸進海裡 |
| `weightEdgeTip` | `1` | 【輸】觸艦、搖晃兩下,最後前傾翻落海中 |
| `glideToDeckMax` | `70` | 為了湊出「觸艦翻落」,最多可以往前滑幾 tick 去找船 |

## ⑨ 物件 Prefab

| 參數 | 預設值 | 說明 |
|---|---|---|
| `planePrefab` | （未指定） | 飛機。機首朝右,節點會依航線斜率旋轉 |
| `carrierPrefab` | （未指定） | 起飛航母。原點 = 水線,艦島建議放左邊 |
| `carrierDestPrefab` | （未指定） | 目的航母（海面上的佈景船目前仍用預設美術繪製） |
| `pickupPrefab` | （未指定） | 加值物件 +N。放一個名叫 value 的 Label 子節點就會自動帶入數字 |
| `boostPrefab` | （未指定） | 乘算物件 ×N。同樣支援 value 子節點 |
| `rocketPrefab` | （未指定） | 飛彈。機首要朝左 —— 它是從畫面右側往左飛過來的 |

## ⑩ 音效

| 參數 | 預設值 | 說明 |
|---|---|---|
| `masterVolume` | `1` | 總音量。所有聲音都會先乘上它 |
| `sfxVolume` | `1` | 一次性音效的音量（下面所有 sfx 欄位） |
| `engineVolume` | `0.55` | 引擎循環音的音量。它整局都在響,通常要壓比音效低 |
| `ambienceVolume` | `0.45` | 環境音（海浪／風）的音量 |
| `bgmVolume` | `0.35` | 背景音樂的音量 |
| `muted` | `false` | 全部靜音。循環音只是音量歸零,不會被停掉,取消靜音就接回去 |
| `sfxMinGapMs` | `45` | 同一顆音效的最短間隔（毫秒）。連發時只留第一下,避免疊成噪音。0 = 不節流 |
| `sfxClick` | （未指定） | 按鈕通用音（籌碼與 SPIN 除外,它們有自己的音） |
| `sfxBet` | （未指定） | 改下注額 |
| `sfxSpin` | （未指定） | 真的開了一局才響 —— 餘額不足按不動時不會出聲 |
| `sfxAutoStart` | （未指定） | 自動下注開始 |
| `sfxAutoStop` | （未指定） | 自動下注結束（含達成停止條件而自己停） |
| `sfxTakeoff` | （未指定） | 起飛 |
| `sfxPickup` | （未指定） | 吃到 +N |
| `sfxBoost` | （未指定） | 吃到 ×N |
| `sfxRocket` | （未指定） | 被飛彈打到 ÷N |
| `sfxNearMiss` | （未指定） | 擦身而過的誘餌。會連發,音量已自動壓到 55%,再靠 sfxMinGapMs 節流 |
| `sfxReveal` | （未指定） | 目的艦進場（結局揭曉前的那一下） |
| `sfxDeckTouch` | （未指定） | 輪胎觸艦,開始減速滑行 |
| `sfxWobble` | （未指定） | 半截機身懸在甲板外開始搖晃 —— 結局未定的張力點,適合放持續的緊張音 |
| `sfxLand` | （未指定） | 降落成功 |
| `sfxBigWin` | （未指定） | 大獎（≥20×,跟 BIG WIN 字樣同一條門檻）。疊在 sfxLand 上面一起播 |
| `sfxSplash` | （未指定） | 墜海 |
| `loopEngine` | （未指定） | 引擎循環。起飛時自動開,降落／落海／回待機自動關 |
| `loopAmbience` | （未指定） | 環境音循環（海浪／風）。開場就播,一直播 |
| `loopBgm` | （未指定） | 背景音樂循環。開場就播,一直播 |

## ⑪ 測試

| 參數 | 預設值 | 說明 |
|---|---|---|
| `forceResult` | `false` | 打開後忽略離線抽獎,每局都用下面指定的結果 |
| `forceLanded` | `true` | 強制降落成功 / 強制落海 |
| `forceMultiplier` | `15` | 強制的最終倍數。演算法會反推一條剛好等於它的航線 |
| `forceSeed` | `''` | 固定 seed（留空 = 每局隨機）。同一個 seed 永遠長出同一條航線 |
| `logRound` | `true` | 在 Console 印出每局分解出來的物件序列與驗算結果 |

