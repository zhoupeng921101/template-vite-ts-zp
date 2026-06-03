# 动态难度系统 —— 复刻笔记

> 对应原游戏 `com.block.juggle v7.7.6` 的 `DynamicWeightDiff` 子系统 + 配套的两套机器学习模型（LightGBM 棋盘评分器 + 3 个 ONNX/TFLite 神经网络）。
> 本文档记录核心架构、与原版的对齐程度，以及 2026-06-03 那一轮 8 步重构 + ML 模型集成中拿到的关键发现。

---

## 1. 整体架构

每次给玩家发新 trio（3 个候选方块）走这条管线：

```
                ┌──────────────────────┐
                │  refillPiecesAsync   │
                └─────────┬────────────┘
                          ▼
        ┌─────────────────────────────────┐
        │  forceAlgorithm 强制？ (E1)      │ ──→ 用强制算法
        └─────────┬───────────────────────┘
                          ▼
        ┌─────────────────────────────────┐
        │  OfferRegistry.dispatch          │
        │    ├─ FirstRound override        │ ──→ 接管 (FirstRound_PromoteCombo)
        │    └─ EmptyBoard override        │ ──→ 接管 (RandomRunEmpty)
        └─────────┬───────────────────────┘
                          ▼
        ┌─────────────────────────────────┐
        │  Activation 门槛 (score < 1000)? │ ──→ RANDOM_NO_DIE
        └─────────┬───────────────────────┘
                          ▼
        ┌─────────────────────────────────┐
        │  按 (dynamicWeight, score) 查    │
        │  weightcfg.json → 找到 tier      │
        └─────────┬───────────────────────┘
                          ▼
        ┌─────────────────────────────────┐
        │  tier 内 8 个 Odds 加权抽签      │ ──→ FILL / DIFF / ... 选一个
        └─────────┬───────────────────────┘
                          ▼
        ┌─────────────────────────────────┐
        │  generateTrioByAlgorithmAsync     │
        │    FILL / ADD3 / DEATH:           │
        │      → ONNX 神经网络（首选）       │ ──→ argmax × 3 = trio
        │      → bit-aware 兜底             │
        │    其他 5 个：bit-aware / 采样     │
        └─────────┬───────────────────────┘
                          ▼
                  3 个 shapeId
```

落子时（每放 1 块）触发 `addWeight(piece.algo)`：用真实 `weightList` 系数增量调整 `dynamicWeight`，下次 refill 时落到不同 tier。

---

## 2. 数据源（4 个）

### 2.1 weightcfg.json（136 行 tier 表）

`public/assets/data/weightcfg.json`，与原版 `03_board_configs/weightcfg.json` **字节级一致**。

- 8 个高分桶 (`HighScoreRange`) × 17 段因子区间 (`FactorRange`) = 136 行
- 每行给出 8 个 `Odds`：`FillBlankOdds / RandomOdds / EntropyOdds / EasyOdds / HardOdds / IntuitionOdds / Clearboard / Allunite`
- 形状规律：低因子 tier → Fill/Allunite 主导（友善）；高因子 tier → HardOdds≈910（约 90% 困难难题）

### 2.2 weightList（8 个算法的反馈系数）

来源：原版 `cfg.json`（`unitWay.json`）→ `feature.dynamicWeightDiff[0].param.weightList`，feature id=184100001。

```json
{
  "weightList": [
    [-10, -20],   // FILL
    [ -5, -10],   // RANDOM_NO_DIE
    [  5,  10],   // ADD3 (熵增 3)
    [  5,  10],   // EASY_DIFF (简单难题)
    [ 10,  20],   // DIFF (困难难题)
    [ 20,  40],   // STRAIGHT_DEATH_DIFF (死亡难题)
    [-20, -40],   // CLEAR_ALL (清盘 plus)
    [-10, -20]    // ALL_COMBINATION (全组合填空消除)
  ]
}
```

每条是 `[basic, consecutive]`：首次切换方向用 `basic`，连续同方向用 `consecutive`。

### 2.3 complex_model.json（LightGBM 棋盘评分器，3.2MB）

`public/assets/data/complex_model.json`，原版 `complex_model_1111_v1_new`。

- **390 棵决策树**，12870 个叶子节点，59 个 split feature
- 输入：59 维特征向量（详见 §5.2）
- 输出：boardWeight ∈ ~[0, 650]，越高表示棋盘越复杂/难
- 推理：每棵树独立遍历叶子 → 求和 → sigmoid → ×650

### 2.4 ONNX 神经网络（3 个，各 ~6MB）

`public/assets/models/`，原版同款 .tflite 离线转 ONNX：

| 文件 | 算法 | 原版来源 |
|---|---|---|
| `model_tkxc_v1.onnx` | FILL（填空消除） | `model_tkxc_v1_xxx.tflite` |
| `model_sang.onnx` | ADD3（熵增） | `model_sang_xxx.tflite` |
| `model_death.onnx` | STRAIGHT_DEATH_DIFF（死亡/直觉难题） | `model_death_xxx.tflite` |

形状：input `[1, 8, 8, 3]` float32（3 通道：放第 1 块前/放第 1 块后/放第 2 块后的棋盘），output `[1, 43]` float32（43 个 shape ID 的 logits）。

---

## 3. 关键发现：动量模型（不是补偿模型）

最初凭直觉以为 weightList 是"补偿"——出了 DIFF 让玩家受苦，下次回到 FILL 补救——所以猜的系数全部签反。**真实 weightList 是动量模型**：

| 算法 | 我的猜测 | 真实值 | 真实含义 |
|---|---|---|---|
| FILL | +40, +20 | **-10, -20** | 出福利 → factor↓ → 下次还更软（动量放水） |
| RANDOM_NO_DIE | +15, +5 | -5, -10 | 同上，幅度更小 |
| ADD3 | -25, -10 | +5, +10 | 出乱 → factor↑ → 维持难题侧 |
| EASY_DIFF | +30, +12 | +5, +10 | 简单难题 → 维持难题侧 |
| DIFF | -40, -15 | +10, +20 | 困难难题 → 推向高难 tier |
| STRAIGHT_DEATH_DIFF | -80, -30 | **+20, +40** | 死亡难题→剧烈推进（连出几次就 90% 难题 tier） |
| CLEAR_ALL | +60, +30 | **-20, -40** | 清盘 → 剧烈放水 |
| ALL_COMBINATION | +35, +15 | -10, -20 | 全组合填空 → 温和放水 |

### 对称性

- **硬算法基础梯度** 5 → 5 → 10 → 20 单调递增；consecutive = 2× basic
- **软算法对称下降** -5 → -10 → -20，CLEAR_ALL/ALL_COMBINATION 收尾
- **CLEAR_ALL 和 STRAIGHT_DEATH_DIFF 都是 ±20/±40**，是系统的"剧情事件"（最大摆动幅度）

### 设计含义

1. **连续硬题会累加** `+10, +20, +20, +20, ...` ——5 个 DIFF 串就推 factor 到 +90；继续到 +230 就进入 tier 17，那里 HardOdds=908 几乎只发死亡难题
2. **单个 FILL 不足以扭转方向**：preDynamicWeight 反号时只用 basic=-10，比硬题的 consecutive=+20 慢；玩家需要被 _连续_ 给福利才能滑回安全 tier
3. **CLEAR_ALL 是大事件**：清盘瞬间 -20 + 反向后再 -40 = 60 点回拉，相当于一次性把 5-6 局难题的积累全部归零

---

## 4. 算法实现层

`src/game/core/algorithms/`

### 4.1 公共池

```ts
COMMON_SHAPE_IDS = [2..39, 42]   // 39 个形状，对齐原版 FirstRoundProTurnPutCtrl.useBlocks
HARD_SHAPE_IDS  = COMMON ∩ {cells≥5 OR maxDim≥4}  // ~22 个大块
BLOCK_PUT_COUNT_IDS = [6, 27, 28, ..., 22]  // LightGBM 用，39 项含 26 重复
```

### 4.2 三档质量

| 档 | 适用算法 | 实现 |
|---|---|---|
| **A. ONNX 神经网络** | FILL / ADD3 / STRAIGHT_DEATH_DIFF | 原版同款模型；3 步级联预测（每步把前一块虚拟放置在 (0,0) 更新 channel） |
| **B. bit-aware 启发式** | FILL / DIFF / STRAIGHT_DEATH_DIFF（ONNX 兜底） | `BoardAnalysis` 工具识别棋盘模式 + 定向选块 |
| **C. Monte-Carlo** | ADD3 / EASY_DIFF / CLEAR_ALL / ALL_COMBINATION / RANDOM_NO_DIE | 随机采样 + 打分 |

ONNX 走 `generateTrioByAlgorithmAsync`，模型未就绪 / 输出无效 / 棋盘上放不下时回退到同名 bit-aware 函数。

### 4.3 Bit 工具 (`BoardAnalysis.ts`)

- `rowsMissingRange(board, min, max)` —— 缺 N 格的行 + 缺口 mask
- `colsMissing(board, k)` —— 缺 N 格的列
- `largestEmptyRect(board)` —— 直方图法 O(N²)，返回 `{w, h, r, c}`
- `shapesFittingRect(w, h)` —— 能塞进 w×h 矩形的形状池
- `horizontalLineShape(w) / verticalLineShape(h)` —— 给定长度的纯横/竖线 shape

### 4.4 bit-aware 算法策略

| 算法 | 策略 |
|---|---|
| **FILL** | ① 扫近完成行/列 ② 缺口连续→选同长度横/竖线作"钥匙块" ③ 不连续→用 1×1 ④ 多个 key 可用时直接 `[k1, k2, k3]` 三 key 并发 |
| **DIFF** | ① `largestEmptyRect` → 挑面积最大的能塞进去的 anchor ② anchor + 2 随机块 ③ history 最低解数追踪 |
| **STRAIGHT_DEATH_DIFF** | ① 双 anchor 锁死布局 (`[a1, a2, random]`) ② c=1 立即返回 ③ 否则 hard-biased 采样兜底 |

### 4.5 优先级覆盖层 (`OfferOverrides.ts`)

对应原版 `OfferUtilManager.offerBlocksBaseList`：

| 名称 | 优先级 | 触发 | 输出 |
|---|---|---|---|
| `FirstRound_PromoteCombo` | 2 | 一局首次 refill | FILL 算法（开局必出消除） |
| `RandomRunEmpty` | 3 | 棋盘是空的 | RANDOM_NO_DIE（空盘上死亡难题无意义） |

其他 timing (`ByExpectation / AfterQuanZuhe / BeforeBottom / AfterRevive`) 为占位。

---

## 5. ML 模型详解

### 5.1 ONNX 推理（`TFLiteInferencer.ts`）

虽然类名叫 TFLite（历史命名），底层实际是 `onnxruntime-web` 跑 ONNX 模型。

**为什么不直接用 TFLite？** tfjs-tflite 最后一个发布版（`0.0.1-alpha.10`, 2021）跑这些模型直接 `Aborted()`——版本太老 / 后端不兼容。改成 `tf2onnx` 离线转出 opset=15 ONNX 跑通。

**运行时**：`onnxruntime-web` 的精简版 `ort.wasm.min.js`（避免拉 jsep/jspi/asyncify 几十 MB），`executionProviders: ['wasm']` + `numThreads: 1`，单线程 WASM。

**3 步级联预测**：
```
1. fillBuffer(channel=0, currentBoard) → infer → argmax = f1
2. clear board → putBlock(f1, (0,0)) → fillBuffer(channel=1) → infer → f2
3. clear board → putBlock(f2, (0,0)) → fillBuffer(channel=2) → infer → f3
return [f1, f2, f3]
```

模型 channel 1/2 不是"f1/f2 真实放置位置后的棋盘"，而是"f1/f2 放在原点后的合成棋盘"。原版训练时就这么做的——网络只看"还有几块没选"的形状提示，不关心具体落点。

**实测推理速度**：~22-30ms/trio（3 次推理串行），fire-and-forget 不阻塞 UI。

**实测输出**（空棋盘）：
- FILL = `[17, 27, 28]`（4×1 横 + 两个 2×2 L → setup combo）
- ADD3 = `[2, 2, 2]`（三个 1×2 竖 → 散开熵增）
- DEATH = `[13, 13, 13]`（三个 3×3 实心 → 经典死亡题）

### 5.2 LightGBM 棋盘评分器（`BoardWeightLGBM.ts`）

59 维特征向量：

| 索引 | 内容 | 提取函数 |
|---|---|---|
| `[0..38]` | 39 个 shape 各自的"贪婪重复放置数" | `getBlockMaxPutCount` |
| `[39]` | 空格率 | `calculateEmptyRatio` |
| `[40..43]` | smoothness 4 项（列高差和/最大、行宽差和/最大） | `calculateSmoothnessScore` |
| `[44..45]` | holes 2 项（小空洞数、受限小空洞数） | `countHoles` (DFS flood-fill) |
| `[46..47]` | lineClearPotential 2 项（近完成行/列段数） | `calculateLineClearPotential` |
| `[48]` | 3×3 全空块数 | `count3x3ZeroSquares` |
| `[49..50]` | 有 ≥5 连续占用的行/列数 | `countConsecutiveOnesInMatrix` |
| `[51]` | 暴露面数（占用格的空邻居数） | `countExposedFaces` |
| `[52]` | freedomZero（四面被围的空格） | `countFreedomZeroSpaces` |
| `[53]` | freedomOne（恰一面有空邻居的空格） | `countFreedomOneSpaces` |
| `[54..55]` | row/col completeness | `rowAndColCompleteness` |
| `[56..57]` | row/col connectivity | 同上 |
| `[58]` | `getOldBoardWeight` 启发式 baseline | 原版逐行翻译 |

**用途**：`BoardWeightProvider.getBoardWeight(saveArr)` 返回 0~650 标量。当前主要给 HUD 调试用；未来可接入 WAYNAME 选择（原版用它决定 fill/hard/etc 子变体）。

---

## 6. 文件清单

```
src/game/core/
├── BinaryBoard.ts                          # 8×8 二进制棋盘
├── BlockShapeMap.ts                        # 73 形状 + 39 COMMON_SHAPE_IDS
├── DynamicWeightDiff.ts                    # 主分发器（offerTrio / offerTrioAsync）
├── OfferOverrides.ts                       # 优先级覆盖框架
├── GameState.ts                            # refillPieces / refillPiecesAsync
├── GameConfig.ts                           # gameconfig.json 读取入口
└── algorithms/
    ├── types.ts                            # AlgorithmKind + 真实 weightList
    ├── Algorithms.ts                       # 8 算法 + generateTrioByAlgorithm{,Async}
    ├── BoardAnalysis.ts                    # bit 工具
    ├── BoardEvaluator.ts                   # 解枚举 / 模拟 / 熵
    ├── BoardWeightLGBM.ts                  # LightGBM 推理 + 59 特征
    ├── BoardWeightProvider.ts              # LightGBM 单例壳
    └── TFLiteInferencer.ts                 # ONNX 推理壳（class 名是历史的）

public/assets/data/
├── weightcfg.json                          # 136 行 tier 表（原版字节级 copy）
├── gameconfig.json                         # factorList（真实 weightList）+ samples
└── complex_model.json                      # LightGBM 模型（3.2MB，390 棵树）

public/assets/models/
├── model_tkxc_v1.onnx                      # FILL 模型（~6MB）
├── model_sang.onnx                         # ADD3 模型（~6MB）
└── model_death.onnx                        # DEATH 模型（~6MB）

public/onnx-runtime/                        # onnxruntime-web 运行时（~13MB）
├── ort.wasm.min.js
├── ort-wasm-simd-threaded.mjs
└── ort-wasm-simd-threaded.wasm
```

---

## 7. 与原版的对齐度

| 维度 | 状态 |
|---|---|
| weightcfg.json 数据 | ✅ 字节级一致 |
| weightList 真实值 | ✅ 已从 cfg.json 提取，无 A/B 分流（唯一 variant id=184100001） |
| Tier 查找逻辑 (factor + score) | ✅ 一致 |
| 8 个 Odds 加权抽签 | ✅ 一致 |
| addWeight 方向切换公式 | ✅ `pre * basic > 0 ? consec : basic` 与原版同 |
| addWeight 触发节奏 | ✅ 每放 1 块（不是每 refill） |
| FirstRound override | ✅ 框架 + 一条默认 override |
| EmptyBoard override | ✅ 框架 + 一条默认 override |
| chapter==class 守卫 | ✅ Adventure 模式不走动态调度 |
| activation 门槛 (score=1000) | ✅ 一致 |
| **LightGBM 棋盘评分器** | ✅ **1:1 移植，59 维特征对齐原版** |
| **FILL 算法** | ✅ **原版同款 model_tkxc_v1 ONNX 神经网络** |
| **ADD3 算法** | ✅ **原版同款 model_sang ONNX 神经网络** |
| **STRAIGHT_DEATH_DIFF 算法** | ✅ **原版同款 model_death ONNX 神经网络** |
| DIFF 算法 | 🟡 bit-aware 启发式（原版的 model_death 也带 DIFF；未拆分） |
| 其他 4 个算法（RANDOM/EASY/CLEAR/ALL_COMB） | 🟡 简化版（Monte-Carlo + bit-aware） |
| OfferNewBlockHelper 184 个 WAYNAME 子变体 | ❌ 未移植（次要变体，工程量过大） |
| ByExpectation / AfterQuanZuhe 等 trigger | ❌ 仅占位，无默认 override |
| 服务器 A/B 分桶（bucketId / gameWayNum） | ❌ 无（dynamicWeightDiff 本身只 1 个 variant） |

**整体还原度 ≈ 95%。** 3 个核心算法（FILL/ADD3/DEATH）和原版完全等价的神经网络输出，其余是工程量过大的微变体。

---

## 8. 调试钩子

| 入口 | 用途 |
|---|---|
| `DynamicWeightDiff.instance.getDynamicWeight()` | 当前 factor |
| `DynamicWeightDiff.instance.lastAlgo / lastTierId` | 上次 refill 用了哪个算法、命中哪个 tier |
| `DynamicWeightDiff.instance.forceAlgorithm = X` | HUD E1 强制算法（跳过所有层） |
| `OfferRegistry.instance.lastHitName` | 上次哪个 override 接管了 |
| `BoardWeightProvider.instance.getBoardWeight(arr)` | LightGBM 评分 0~650 |
| `TFLiteInferencer.instance.isReady(key)` | 3 个 ONNX 模型加载状态 |
| `window.__game.tflite.{isReady,offerTrio}` | 浏览器控制台诊断 |
| `DebugHUD` (浏览器右上角) | 实时显示 tier / algo / weight |
| `ConfigPanel` (浏览器) | 调 factorList / samples / activation |

`tierId` 语义：
- `null` —— 未激活（score<1000 或未初始化）
- `-1` —— `forceAlgorithm` 强制
- `-2` —— 被 OfferOverride 覆盖
- `1..136` —— weightcfg.json 行号

---

## 9. 重构日志（2026-06-03）

按时间顺序记录这一轮所有改动：

| # | 改动 | 影响 |
|---|---|---|
| 1 | `COMMON_SHAPE_IDS` 13 → 39 形状 | 候选块多样性恢复 |
| 2 | `addWeight` 改为每放 1 块触发 | 难度反馈速度 3× |
| 3 | DIFF/DEATH 加 hard-biased 采样 + 提高样本数 | 解数 DEATH/EASY 比 2.5× → 持续显著 |
| 4 | `chapter=='classic'` 守卫 | Adventure 不再被橡皮筋污染 |
| 5 | 新增 `OfferOverrides.ts` 优先级覆盖框架 + 2 条默认 | FirstRound 必出消除、空棋盘不发死亡难题 |
| 6 | 新增 `BoardAnalysis.ts`，FILL/DIFF/DEATH 改用 bit-aware 启发式 | FILL 近完成行 12/12 清 ≥3 行；DIFF 受限棋盘解数 116 vs RANDOM 428 |
| 7 | 从 `cfg.json` 拿到真实 weightList，替换瞎猜的 `DEFAULT_WEIGHT_FACTORS` | **签反的全部修正**；动量模型正式上线 |
| 8 | 移植 LightGBM 棋盘评分器（59 维特征 + 390 棵决策树） | 与原版 `NewBoardWeightMethodCtr.getBoardWeight` 1:1 等价 |
| 9 | 离线转换 5 个 `.tflite` → ONNX，集成 `onnxruntime-web` | 解决 tfjs-tflite 跑模型 `Aborted()` |
| 10 | FILL/ADD3/DEATH 改走 ONNX 神经网络优先，bit-aware 兜底 | **核心 3 算法与原版输出等价**；推理 ~25ms/trio |

测试覆盖：125 单元测试（board/state/level/algorithms/lgbm）+ 10 浏览器 E2E 全过。

`dist/` 最终体积 **56MB**：18MB 模型 + 13MB ONNX 运行时 + 12MB audio + 7MB images + 5.6MB 数据（weightcfg + LightGBM）+ JS bundle。

---

## 10. 待办

- 调研其他动态难度相关 feature（`bAlgorithmDynamicDifficulty`、`isOpenDynamicHardAlgo`、`AlgoDiffWeight` 等）是否有未接入的层
- `OfferOverrides` 加更多 timing 的默认 override（特别是 `AfterQuanZuhe` —— 全组合后的难度回弹）
- DIFF 算法升级到原版 ONNX（原版 `model_death` 似乎也覆盖 DIFF；需要更仔细对照原版的 WAYNAME 调用图）
- 用 boardWeight (LightGBM 输出) 选 WAYNAME 子变体（原版有阈值表 `t<=280 → A 算法 / t<=330 → B / ...`）
- 把 `gameconfig.json` 改成远程拉取 + bucketId 分流，让 weightList 可以运营调参
- 把不用的 2 个 FILL 模型变体（`model_tkxc_v2/tiehe`）加进 A/B 切换（HUD 调试）
