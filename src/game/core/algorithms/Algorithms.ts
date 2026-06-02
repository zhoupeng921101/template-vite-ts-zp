// 8 种算法实现 —— 每种返回 3 个 shapeId
// 共同模式：随机采样 N 个候选 trio，按算法目标打分，取最优。
import { BinaryBoard } from '../BinaryBoard';
import { COMMON_SHAPE_IDS, getShapeWeight, BlockNumMap } from '../BlockShapeMap';
import { BoardEvaluator } from './BoardEvaluator';
import { AlgorithmKind, ALGORITHM_NAME } from './types';
import { GameConfig } from '../GameConfig';

/** 从 Config 拿采样次数（GameConfig 始终有默认值，无需 fallback） */
function samples(kind: AlgorithmKind, fallback: number): number {
    try {
        return GameConfig.instance.samplesFor(ALGORITHM_NAME[kind]);
    } catch {
        return fallback;
    }
}

/** 加权抽一个 shapeId */
function weightedRandomShape(): number {
    let total = 0;
    const weights = COMMON_SHAPE_IDS.map((id) => {
        const w = getShapeWeight(id);
        total += w;
        return w;
    });
    let r = Math.random() * total;
    for (let i = 0; i < weights.length; i++) {
        if (r < weights[i]) return COMMON_SHAPE_IDS[i];
        r -= weights[i];
    }
    return COMMON_SHAPE_IDS[COMMON_SHAPE_IDS.length - 1];
}

function sampleTrio(): number[] {
    return [weightedRandomShape(), weightedRandomShape(), weightedRandomShape()];
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
// #0 FILL — 填空消除：确保 trio 中至少有一种放置序列会触发消除
// ─────────────────────────────────────────────────────────────────────────
function fillTrio(board: BinaryBoard, samplesCount = samples(AlgorithmKind.FILL, 80)): number[] {
    let best: { trio: number[]; cleared: number } | null = null;
    for (let i = 0; i < samplesCount; i++) {
        const t = sampleTrio();
        if (!board.checkPutAllBlocks(t)) continue;
        const result = BoardEvaluator.findBest(board, t, (_rows, cleared) => cleared, 24);
        if (result && result.cleared > 0) {
            if (!best || result.cleared > best.cleared) {
                best = { trio: t, cleared: result.cleared };
            }
            if (best.cleared >= 16) break; // 已有 ≥2 行/列 消除，够好
        }
    }
    return best ? best.trio : fallbackTrio(board);
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
// #4 DIFF — 困难难题：解很少（1~3）但仍可解
// ─────────────────────────────────────────────────────────────────────────
function hardDiffTrio(board: BinaryBoard, samplesCount = samples(AlgorithmKind.DIFF, 100)): number[] {
    let best: { trio: number[]; count: number } | null = null;
    for (let i = 0; i < samplesCount; i++) {
        const t = sampleTrio();
        const c = BoardEvaluator.countSolutions(board, t, 6);
        if (c >= 1 && c <= 3) {
            if (!best || c < best.count) best = { trio: t, count: c };
            if (best.count === 1) break;
        }
    }
    return best ? best.trio : fallbackTrio(board);
}

// ─────────────────────────────────────────────────────────────────────────
// #5 STRAIGHT_DEATH_DIFF — 直觉/死亡难题：恰好 1 个合法解，错一步即死
// ─────────────────────────────────────────────────────────────────────────
function straightDeathTrio(board: BinaryBoard, samplesCount = samples(AlgorithmKind.STRAIGHT_DEATH_DIFF, 200)): number[] {
    let any1: number[] | null = null;
    let any2: number[] | null = null;
    for (let i = 0; i < samplesCount; i++) {
        const t = sampleTrio();
        const c = BoardEvaluator.countSolutions(board, t, 4);
        if (c === 1) return t;        // 完美匹配
        if (c === 2 && !any2) any2 = t;
        if (c === 3 && !any1) any1 = t;
    }
    if (any2) return any2;
    if (any1) return any1;
    return fallbackTrio(board);
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

// 暴露给单元测试
export const _internal = {
    fillTrio, randomNoDieTrio, add3Trio, easyDiffTrio, hardDiffTrio,
    straightDeathTrio, clearAllTrio, allCombinationTrio,
    sampleTrio, weightedRandomShape, BlockNumMap,
};
