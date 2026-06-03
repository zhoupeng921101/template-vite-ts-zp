// 8 种算法实现 —— 每种返回 3 个 shapeId
//
// 三档质量：
//   1) TFLite 神经网络（FILL / ADD3 / STRAIGHT_DEATH_DIFF）—— 真原版同款模型，
//      `TFLiteInferencer.isReady()` 为 true 时优先用，输出 trio 再做合法性校验。
//   2) bit-aware 启发式（FILL / DIFF / STRAIGHT_DEATH_DIFF）—— TFLite 未就绪 / 输出
//      不合法时的兜底。识别棋盘模式 + 定向选块。
//   3) Monte-Carlo（其他 5 个算法）—— 简化版采样打分。
import { BinaryBoard } from '../BinaryBoard';
import { COMMON_SHAPE_IDS, BlockNumMap, BlockShapeMap } from '../BlockShapeMap';
import { BoardEvaluator } from './BoardEvaluator';
import {
    rowsMissingRange, colsMissing, largestEmptyRect, fillRatio,
    shapesByWidth, shapesByHeight, horizontalLineShape, verticalLineShape,
    shapesFittingRect,
} from './BoardAnalysis';
import { TFLiteInferencer, TFLiteModelKey } from './TFLiteInferencer';
import { AlgorithmKind, ALGORITHM_NAME } from './types';
import { GameConfig } from '../GameConfig';

/**
 * 把 BinaryBoard 转回 8×8 saveArr 格式（TFLite 输入需要）。
 * 我们不关心颜色，所以直接用 0/1 标记占用。
 */
function boardToSaveArr(board: BinaryBoard): number[][] {
    const out: number[][] = [];
    for (let r = 0; r < 8; r++) {
        const row: number[] = [];
        for (let c = 0; c < 8; c++) {
            row.push(board.emptyAt(c, r) ? -1 : 1);
        }
        out.push(row);
    }
    return out;
}

/**
 * 异步：用 ONNX 模型出 trio。若模型未就绪 / 输出无效 / 不可放，返回 null。
 * 上层只在 async 路径（generateTrioByAlgorithmAsync）调用；sync 路径不用 ML。
 */
async function tryTFLiteTrioAsync(key: TFLiteModelKey, board: BinaryBoard): Promise<number[] | null> {
    const inf = TFLiteInferencer.instance;
    if (!inf.isReady(key)) return null;
    try {
        const ids = await inf.offerTrioAsync(key, boardToSaveArr(board));
        for (const id of ids) {
            if (id <= 0 || !BlockShapeMap.has(id)) return null;
        }
        if (!board.checkPutAllBlocks(ids)) return null;
        return ids;
    } catch {
        return null;
    }
}

/** 从 Config 拿采样次数（GameConfig 始终有默认值，无需 fallback） */
function samples(kind: AlgorithmKind, fallback: number): number {
    try {
        return GameConfig.instance.samplesFor(ALGORITHM_NAME[kind]);
    } catch {
        return fallback;
    }
}

/** 从 39 个白名单 ID 中均匀随机抽一个（原版 FirstRoundProTurnPutCtrl.useBlocks） */
function uniformRandomShape(): number {
    return COMMON_SHAPE_IDS[Math.floor(Math.random() * COMMON_SHAPE_IDS.length)];
}

function sampleTrio(): number[] {
    return [uniformRandomShape(), uniformRandomShape(), uniformRandomShape()];
}

/**
 * "难块"子池：cells>=5 或 max(w,h)>=4，把整个 trio 的可放置点压低，
 * 用于 DIFF / STRAIGHT_DEATH_DIFF 这类需要"低解数"的算法。
 * 在 COMMON_SHAPE_IDS（39 个）中能筛出 ~22 个（5×1、4×1、3×3 实心、3×2 实心、各类 6 格 L/T 等）。
 */
const HARD_SHAPE_IDS: number[] = COMMON_SHAPE_IDS.filter((id) => {
    const cells = BlockNumMap.get(id) ?? 0;
    const sh = BlockShapeMap.get(id);
    const maxDim = sh ? Math.max(sh.width, sh.height) : 0;
    return cells >= 5 || maxDim >= 4;
});

function hardShape(): number {
    return HARD_SHAPE_IDS[Math.floor(Math.random() * HARD_SHAPE_IDS.length)];
}

/**
 * 难题倾向采样：70% 抽难块、30% 抽普通块。
 * 全 hard 偏好会让 trio 在中度棋盘上根本无解，混入一些小块能保证至少有解。
 */
function sampleHardBiasedTrio(): number[] {
    const pick = () => (Math.random() < 0.7 ? hardShape() : uniformRandomShape());
    return [pick(), pick(), pick()];
}

/** 公共后备：随机无死亡 */
function fallbackTrio(board: BinaryBoard): number[] {
    for (let i = 0; i < 50; i++) {
        const t = sampleTrio();
        if (board.checkPutAllBlocks(t)) return t;
    }
    return [1, 1, 1];
}

// ─────────────────────────────────────────────────────────────────────────
// #0 FILL — 填空消除：bit-aware 版
//
// 策略：
//   1) 扫"近完成行/列"（缺 1~3 格）。
//   2) 对每个近完成行，看缺口是否连续——如果是，挑一个"刚好填进去"的形状作为
//      "钥匙块"（kept ID）；不连续就用 1×1。
//   3) 钥匙块 + 2 个随机块组成 trio；验证 trio 可放且能触发消除。
//   4) 都搞不出 → 退回原 Monte-Carlo 采样路径。
// ─────────────────────────────────────────────────────────────────────────
function fillTrio(board: BinaryBoard, samplesCount = samples(AlgorithmKind.FILL, 80)): number[] {
    // 1) 找近完成行
    const candidatesRow = rowsMissingRange(board, 1, 3);
    const candidatesCol = colsMissing(board, 1).concat(colsMissing(board, 2)).concat(colsMissing(board, 3));

    const keyShapes: number[] = [];

    // 行优先：缺口连续 → 用同长度的横线 shape；不连续 → 用 1×1
    for (const { gapMask, missing } of candidatesRow) {
        if (isContiguousMask(gapMask)) {
            const sid = horizontalLineShape(missing);
            if (sid != null) keyShapes.push(sid);
        } else {
            keyShapes.push(1); // 1×1 总能填散点
        }
    }
    // 列同理
    for (const { gapMask } of candidatesCol) {
        if (isContiguousMask(gapMask)) {
            const m = bitCount(gapMask);
            const sid = verticalLineShape(m);
            if (sid != null) keyShapes.push(sid);
        } else {
            keyShapes.push(1);
        }
    }

    // 2) 用 key + 2 个其它块试 trio
    //    - 多个 key 可用时：[k1, k2, k3] 三 key 并发，最大化连消
    //    - 只有 1 个 key 时：[key, random, random]
    if (keyShapes.length > 0) {
        const KEY_TRIES = Math.min(samplesCount, 40);
        let best: { trio: number[]; cleared: number } | null = null;
        for (let i = 0; i < KEY_TRIES; i++) {
            let t: number[];
            if (keyShapes.length >= 3) {
                // 多 key：随机抽 3 个不同 key
                const shuffled = keyShapes.slice().sort(() => Math.random() - 0.5);
                t = [shuffled[0], shuffled[1], shuffled[2]];
            } else if (keyShapes.length === 2) {
                t = [keyShapes[0], keyShapes[1], uniformRandomShape()];
            } else {
                t = [keyShapes[0], uniformRandomShape(), uniformRandomShape()];
            }
            if (!board.checkPutAllBlocks(t)) continue;
            const result = BoardEvaluator.findBest(board, t, (_rows, cleared) => cleared, 24);
            if (result && result.cleared > 0) {
                if (!best || result.cleared > best.cleared) best = { trio: t, cleared: result.cleared };
                if (best.cleared >= 24) return best.trio; // 3 行已达成
            }
        }
        if (best) return best.trio;
    }

    // 3) 退回纯采样（原 Monte-Carlo）
    let best: { trio: number[]; cleared: number } | null = null;
    for (let i = 0; i < samplesCount; i++) {
        const t = sampleTrio();
        if (!board.checkPutAllBlocks(t)) continue;
        const result = BoardEvaluator.findBest(board, t, (_rows, cleared) => cleared, 24);
        if (result && result.cleared > 0) {
            if (!best || result.cleared > best.cleared) best = { trio: t, cleared: result.cleared };
            if (best.cleared >= 16) break;
        }
    }
    return best ? best.trio : fallbackTrio(board);
}

/** 8-bit 掩码：bit 是否构成连续区段 */
function isContiguousMask(mask: number): boolean {
    if (mask === 0) return false;
    // 找出第一个 1 和最后一个 1，看中间是否全 1
    let firstSet = -1, lastSet = -1;
    for (let i = 0; i < 8; i++) {
        if ((mask >> i) & 1) {
            if (firstSet < 0) firstSet = i;
            lastSet = i;
        }
    }
    const expected = ((1 << (lastSet - firstSet + 1)) - 1) << firstSet;
    return mask === expected;
}

function bitCount(x: number): number {
    let n = 0;
    while (x) { n += x & 1; x >>>= 1; }
    return n;
}

// ─────────────────────────────────────────────────────────────────────────
// #1 RANDOM_NO_DIE — 随机无死亡：纯加权随机 + checkPutAllBlocks 保活
// ─────────────────────────────────────────────────────────────────────────
function randomNoDieTrio(board: BinaryBoard): number[] {
    return fallbackTrio(board);
}

// ─────────────────────────────────────────────────────────────────────────
// #2 ADD3 — 熵增：选 trio 使放置后熵最大（最乱、最难继续）
// ─────────────────────────────────────────────────────────────────────────
function add3Trio(board: BinaryBoard, samplesCount = samples(AlgorithmKind.ADD3, 60)): number[] {
    let best: { trio: number[]; entropy: number } | null = null;
    for (let i = 0; i < samplesCount; i++) {
        const t = sampleTrio();
        const result = BoardEvaluator.findBest(board, t, (rows) => BoardEvaluator.entropy(rows), 16);
        if (!result) continue;
        if (!best || result.score > best.entropy) {
            best = { trio: t, entropy: result.score };
        }
    }
    return best ? best.trio : fallbackTrio(board);
}

// ─────────────────────────────────────────────────────────────────────────
// #3 EASY_DIFF — 简单难题：解多（≥5）但需要思考的 trio
// ─────────────────────────────────────────────────────────────────────────
function easyDiffTrio(board: BinaryBoard, samplesCount = samples(AlgorithmKind.EASY_DIFF, 80)): number[] {
    const targetMin = 5, targetMax = 30;
    let best: { trio: number[]; dist: number } | null = null;
    for (let i = 0; i < samplesCount; i++) {
        const t = sampleTrio();
        const solCount = BoardEvaluator.countSolutions(board, t, targetMax + 1);
        if (solCount < 1) continue;
        const idealMid = (targetMin + targetMax) / 2;
        const dist = Math.abs(solCount - idealMid);
        if (!best || dist < best.dist) best = { trio: t, dist };
    }
    return best ? best.trio : fallbackTrio(board);
}

// ─────────────────────────────────────────────────────────────────────────
// #4 DIFF — 困难难题：bit-aware 版
//
// 策略：
//   1) 算最大空矩形 (W, H)。
//   2) 选一个 "刚好塞满" 的形状（width≈W、height≈H）作为约束块——它只剩 1~2 个落点。
//   3) 加 2 个随机块组成 trio，countSolutions ≤ COUNT_LIMIT。
//   4) 记录历史最低解数，最后退回 hard-biased 采样兜底。
// ─────────────────────────────────────────────────────────────────────────
function hardDiffTrio(board: BinaryBoard, samplesCount = samples(AlgorithmKind.DIFF, 160)): number[] {
    const rect = largestEmptyRect(board);
    let best: { trio: number[]; count: number } | null = null;
    const COUNT_LIMIT = 12;

    // 1) 用 "刚好填满最大空矩形" 的块作锚
    if (rect.w >= 3 || rect.h >= 3) {
        const anchorCandidates = pickAnchorShapes(rect.w, rect.h);
        const ANCHOR_TRIES = Math.min(samplesCount / 2, 60);
        for (let i = 0; i < ANCHOR_TRIES; i++) {
            const anchor = anchorCandidates[i % anchorCandidates.length];
            const t = [anchor, uniformRandomShape(), uniformRandomShape()];
            const c = BoardEvaluator.countSolutions(board, t, COUNT_LIMIT);
            if (c < 1) continue;
            if (!best || c < best.count) best = { trio: t, count: c };
            if (best.count === 1) return best.trio;
        }
    }

    // 2) hard-biased 采样补充
    for (let i = 0; i < samplesCount; i++) {
        const t = sampleHardBiasedTrio();
        const c = BoardEvaluator.countSolutions(board, t, COUNT_LIMIT);
        if (c < 1) continue;
        if (!best || c < best.count) best = { trio: t, count: c };
        if (best.count === 1) break;
        if (best.count <= 3 && i > samplesCount / 2) break;
    }
    return best ? best.trio : fallbackTrio(board);
}

// ─────────────────────────────────────────────────────────────────────────
// #5 STRAIGHT_DEATH_DIFF — 直觉/死亡难题：bit-aware 版
//
// 策略：同 DIFF 的锚点法，但目标更严格（c=1 立即返回）。再加一层 "塞 2 个锚"
// 的双锁定尝试，把候选空间砍到极小。
// ─────────────────────────────────────────────────────────────────────────
function straightDeathTrio(board: BinaryBoard, samplesCount = samples(AlgorithmKind.STRAIGHT_DEATH_DIFF, 320)): number[] {
    const rect = largestEmptyRect(board);
    let best: { trio: number[]; count: number } | null = null;
    const COUNT_LIMIT = 8;

    // 1) 双锚点：连续两个大块锁死布局
    if (rect.w >= 3 && rect.h >= 3) {
        const anchorCandidates = pickAnchorShapes(rect.w, rect.h);
        const ANCHOR_TRIES = Math.min(samplesCount / 2, 80);
        for (let i = 0; i < ANCHOR_TRIES; i++) {
            const a1 = anchorCandidates[i % anchorCandidates.length];
            const a2 = anchorCandidates[(i + 1) % anchorCandidates.length];
            const t = [a1, a2, uniformRandomShape()];
            const c = BoardEvaluator.countSolutions(board, t, COUNT_LIMIT);
            if (c === 1) return t;
            if (c < 1) continue;
            if (!best || c < best.count) best = { trio: t, count: c };
        }
    }

    // 2) hard-biased 采样补充
    for (let i = 0; i < samplesCount; i++) {
        const t = sampleHardBiasedTrio();
        const c = BoardEvaluator.countSolutions(board, t, COUNT_LIMIT);
        if (c === 1) return t;
        if (c < 1) continue;
        if (!best || c < best.count) best = { trio: t, count: c };
    }
    return best ? best.trio : fallbackTrio(board);
}

/**
 * 给定最大空矩形尺寸 (w, h)，返回能塞进去的、面积大的形状候选（优先大尺寸）。
 * 用于 DIFF / STRAIGHT_DEATH 的锚点选择：锚点越大、候选放置位置越少 → 解数越少。
 */
function pickAnchorShapes(w: number, h: number): number[] {
    const candidates = shapesFittingRect(w, h)
        .map((id) => ({ id, cells: BlockNumMap.get(id) ?? 0 }))
        .sort((a, b) => b.cells - a.cells)
        .slice(0, 10);            // 取面积最大的 10 个
    if (candidates.length === 0) return [uniformRandomShape()];
    return candidates.map((c) => c.id);
}

// ─────────────────────────────────────────────────────────────────────────
// #6 CLEAR_ALL — 清盘 Plus：trio 中存在一种放置序列能清空整个棋盘
// ─────────────────────────────────────────────────────────────────────────
function clearAllTrio(board: BinaryBoard, samplesCount = samples(AlgorithmKind.CLEAR_ALL, 120)): number[] {
    const filled = BoardEvaluator.filledCount(board.rowBinary);
    // 棋盘几乎空就直接 fallback：清盘没意义
    if (filled < 10) return fallbackTrio(board);

    for (let i = 0; i < samplesCount; i++) {
        const t = sampleTrio();
        if (!board.checkPutAllBlocks(t)) continue;
        // 三块总格数必须 >= 当前已占格（否则填不满）
        if (BoardEvaluator.trioCells(t) < filled) continue;
        const result = BoardEvaluator.findBest(board, t,
            (rows) => (rows.every((r) => r === 0) ? 10000 : -BoardEvaluator.filledCount(rows)),
            32);
        if (result && result.score >= 10000) return t;
    }
    return fillTrio(board, 50); // 退而求其次：能消除就行
}

// ─────────────────────────────────────────────────────────────────────────
// #7 ALL_COMBINATION — 全组合填空消除：FILL 升级版，目标最大消除格数
// ─────────────────────────────────────────────────────────────────────────
function allCombinationTrio(board: BinaryBoard, samplesCount = samples(AlgorithmKind.ALL_COMBINATION, 150)): number[] {
    let best: { trio: number[]; cleared: number } | null = null;
    for (let i = 0; i < samplesCount; i++) {
        const t = sampleTrio();
        if (!board.checkPutAllBlocks(t)) continue;
        const result = BoardEvaluator.findBest(board, t, (_rows, cleared) => cleared, 48);
        if (result && result.cleared > 0) {
            if (!best || result.cleared > best.cleared) {
                best = { trio: t, cleared: result.cleared };
            }
            if (best.cleared >= 24) break; // 已 3 行以上，够了
        }
    }
    return best ? best.trio : fillTrio(board, 50);
}

// ─────────────────────────────────────────────────────────────────────────
// 主分发器
// ─────────────────────────────────────────────────────────────────────────
export function generateTrioByAlgorithm(
    algo: AlgorithmKind,
    board: BinaryBoard,
): number[] {
    switch (algo) {
        case AlgorithmKind.FILL:                return fillTrio(board);
        case AlgorithmKind.RANDOM_NO_DIE:       return randomNoDieTrio(board);
        case AlgorithmKind.ADD3:                return add3Trio(board);
        case AlgorithmKind.EASY_DIFF:           return easyDiffTrio(board);
        case AlgorithmKind.DIFF:                return hardDiffTrio(board);
        case AlgorithmKind.STRAIGHT_DEATH_DIFF: return straightDeathTrio(board);
        case AlgorithmKind.CLEAR_ALL:           return clearAllTrio(board);
        case AlgorithmKind.ALL_COMBINATION:     return allCombinationTrio(board);
        default:                                return randomNoDieTrio(board);
    }
}

/**
 * 异步主分发器：FILL/ADD3/STRAIGHT_DEATH_DIFF 优先用 ONNX 神经网络，
 * 模型未就绪或推理失败时回退 sync bit-aware。
 * 其余 5 个算法不走 ML，直接走 sync。
 */
export async function generateTrioByAlgorithmAsync(
    algo: AlgorithmKind,
    board: BinaryBoard,
): Promise<number[]> {
    let mlKey: TFLiteModelKey | null = null;
    if (algo === AlgorithmKind.FILL) mlKey = TFLiteModelKey.FILL;
    else if (algo === AlgorithmKind.ADD3) mlKey = TFLiteModelKey.ADD3;
    else if (algo === AlgorithmKind.STRAIGHT_DEATH_DIFF) mlKey = TFLiteModelKey.DEATH;

    if (mlKey) {
        const ml = await tryTFLiteTrioAsync(mlKey, board);
        if (ml) return ml;
    }
    return generateTrioByAlgorithm(algo, board);
}

// 暴露给单元测试
export const _internal = {
    fillTrio, randomNoDieTrio, add3Trio, easyDiffTrio, hardDiffTrio,
    straightDeathTrio, clearAllTrio, allCombinationTrio,
    sampleTrio, uniformRandomShape, BlockNumMap,
};
