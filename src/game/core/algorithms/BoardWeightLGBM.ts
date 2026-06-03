// LightGBM 棋盘权重评分器 —— 1:1 移植自原版
// `NewBoardWeightMethodCtr`（main_bundle.js:335668-336022）
//
// 输入：8×8 saveArr (-1=空，其它=已占用)
// 输出：boardWeight ∈ ~[0, 650]，越高表示越"难/复杂"
//
// 模型：LightGBM gradient boosted trees, 390 棵, 12870 个叶子, 59 个 split feature
// 推理：每棵树独立遍历叶子值求和 → sigmoid → ×650 取整
//
// 数据：public/assets/data/complex_model.json
//
// 特征向量布局（59 维）：
//   [0..38]  : getBlockMaxPutCount —— 39 个形状各能在棋盘上塞多少次
//   [39]     : emptyRatio
//   [40..43] : smoothnessScore[0..3]
//   [44..45] : holes[0..1]
//   [46..47] : lineClearPotential[0..1]
//   [48]     : bigSquares (3×3 全空块数)
//   [49..50] : bigRowCol[0..1]   (连续 5+ 占用的行/列数)
//   [51]     : lines (countExposedFaces)
//   [52]     : zeroSpaces (freedomZero)
//   [53]     : oneSpaces  (freedomOne)
//   [54]     : rowCompleteness
//   [55]     : colCompleteness
//   [56]     : totalRowConnectivity
//   [57]     : totalColumnConnectivity
//   [58]     : getOldBoardWeight

import { BinaryBoard } from '../BinaryBoard';
import { BlockShapeMap } from '../BlockShapeMap';

/** 原版 getBlockMaxPutCount 使用的 39 个 shape ID（顺序与特征 [0..38] 对齐） */
export const BLOCK_PUT_COUNT_IDS: number[] = [
    6, 27, 28, 15, 9, 5, 4, 17, 7, 11, 24, 12, 23, 21, 13, 31, 30, 29, 8, 32,
    33, 42, 34, 10, 20, 26, 26, 25, 19, 18, 16, 14, 35, 36, 37, 38, 39, 40, 22,
]; // 注意：原版列表里 26 出现了 2 次（疑似手抖，但训练时如此，复刻保留）

// ─────────────────────────────────────────────────────────────────────────
// 棋盘归一化：原版用 1=占用 / 0=空 (vs BinaryBoard 的 1=占用 / -1=空)
// ─────────────────────────────────────────────────────────────────────────

/** -1 → 0; 其它 → 1。复刻原版 replaceNonMinusOneWithOne。 */
function normalize(saveArr: number[][]): number[][] {
    return saveArr.map((r) => r.map((c) => (c !== -1 ? 1 : 0)));
}

/** "-1 视图"（占用=1，空=-1） —— 用于 lines/zeroSpaces/oneSpaces */
function normalizeNeg(saveArr01: number[][]): number[][] {
    return saveArr01.map((r) => r.map((c) => (c === 0 ? -1 : c)));
}

// ─────────────────────────────────────────────────────────────────────────
// 单项特征
// ─────────────────────────────────────────────────────────────────────────

/** 空格率 ∈ [0, 1] */
function calculateEmptyRatio(b01: number[][]): number {
    let n = 0;
    for (const row of b01) for (const v of row) if (v === 0) n++;
    return parseFloat((n / 64).toFixed(4));
}

/**
 * smoothness 4 项 = [
 *   按列：从下往上数第一个占用格的"高度差"绝对值之和,
 *   按列：最高高度差,
 *   按行：同上 sum,
 *   按行：max,
 * ]
 *
 * 原版 calculateSmoothnessScore 用 lastIndexOf(1) 找列的"最下面 1" 位置，
 * height = length - lastIndex - 1（距离底部的距离），然后相邻列高度差。
 */
function calculateSmoothnessScore(b01: number[][]): number[] {
    const N = 8;
    // 列高（每列最下面 1 距底部多少行；没 1 则 0）
    const colHeights: number[] = [];
    for (let c = 0; c < N; c++) {
        let last = -1;
        for (let r = 0; r < N; r++) if (b01[r][c] === 1) last = r;
        colHeights.push(last === -1 ? 0 : N - last - 1);
    }
    const colDiffs = colHeights.slice(1).map((v, i) => Math.abs(v - colHeights[i]));
    const colSum = colDiffs.reduce((a, b) => a + b, 0);
    const colRange = Math.max(...colHeights) - Math.min(...colHeights);

    // 行同理（每行最右面 1 距右多少列）
    const rowHeights: number[] = b01.map((row) => {
        let last = -1;
        for (let c = 0; c < N; c++) if (row[c] === 1) last = c;
        return last === -1 ? 0 : N - last - 1;
    });
    const rowDiffs = rowHeights.slice(1).map((v, i) => Math.abs(v - rowHeights[i]));
    const rowSum = rowDiffs.reduce((a, b) => a + b, 0);
    const rowRange = Math.max(...rowHeights) - Math.min(...rowHeights);

    return [colSum, colRange, rowSum, rowRange];
}

/**
 * holes = [小空洞数, "受限"小空洞数]
 * 用 DFS flood-fill 找尺寸 1~2 的空洞团；如果该团所在行/列总空格数 > 团尺寸，
 * 说明这团是被"包围"的孤立洞，记入 holes[1]。
 */
function countHoles(b01: number[][]): [number, number] {
    const N = 8;
    const visited: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
    let small = 0, restricted = 0;

    const dfs = (r: number, c: number): number => {
        if (r < 0 || r >= N || c < 0 || c >= N) return 0;
        if (b01[r][c] === 1 || visited[r][c] === 1) return 0;
        visited[r][c] = 1;
        let s = 1;
        s += dfs(r - 1, c);
        s += dfs(r + 1, c);
        s += dfs(r, c - 1);
        s += dfs(r, c + 1);
        return s;
    };

    for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
            if (b01[r][c] === 0 && visited[r][c] === 0) {
                const size = dfs(r, c);
                if (size >= 1 && size <= 2) {
                    small++;
                    const rowZeros = b01[r].filter((v) => v === 0).length;
                    let colZeros = 0;
                    for (let rr = 0; rr < N; rr++) if (b01[rr][c] === 0) colZeros++;
                    if (rowZeros > size || colZeros > size) restricted++;
                }
            }
        }
    }
    return [small, restricted];
}

/**
 * lineClearPotential = [
 *   "整行已占用 7 格的连续段（段长 ≥3）"的段数,
 *   同列方向
 * ]
 */
function calculateLineClearPotential(b01: number[][]): [number, number] {
    const N = 8;
    const rowOnes: number[] = b01.map((row) => row.filter((v) => v === 1).length);
    const colOnes: number[] = [];
    for (let c = 0; c < N; c++) {
        let n = 0;
        for (let r = 0; r < N; r++) if (b01[r][c] === 1) n++;
        colOnes.push(n);
    }
    const countSegments = (counts: number[]) => {
        let segs = 0, run = 0;
        for (let i = 0; i < counts.length; i++) {
            if (counts[i] === 7) {
                run++;
                if (i === counts.length - 1 && run >= 3) segs++;
            } else {
                if (run >= 3) segs++;
                run = 0;
            }
        }
        return segs;
    };
    return [countSegments(rowOnes), countSegments(colOnes)];
}

/** 全 0 的 3×3 子矩阵数量 */
function count3x3ZeroSquares(b01: number[][]): number {
    let n = 0;
    for (let r = 0; r <= 5; r++) {
        for (let c = 0; c <= 5; c++) {
            let allZero = true;
            for (let dr = 0; dr < 3 && allZero; dr++) {
                for (let dc = 0; dc < 3 && allZero; dc++) {
                    if (b01[r + dr][c + dc] !== 0) allZero = false;
                }
            }
            if (allZero) n++;
        }
    }
    return n;
}

/**
 * bigRowCol = [有≥5连续占用的行数, 有≥5连续占用的列数]
 */
function countConsecutiveOnesInMatrix(b01: number[][], threshold = 5): [number, number] {
    const N = 8;
    const rowHas = (arr: number[]) => {
        let run = 0;
        for (const v of arr) {
            if (v === 1) { if (++run >= threshold) return true; }
            else run = 0;
        }
        return false;
    };
    let rows = 0, cols = 0;
    for (let r = 0; r < N; r++) if (rowHas(b01[r])) rows++;
    for (let c = 0; c < N; c++) {
        const col: number[] = [];
        for (let r = 0; r < N; r++) col.push(b01[r][c]);
        if (rowHas(col)) cols++;
    }
    return [rows, cols];
}

/** 棋盘上每个占用格 → 4 邻方向中有几个邻居是空格 */
function countExposedFaces(bNeg: number[][]): number {
    const N = 8;
    let n = 0;
    for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
            if (bNeg[r][c] === 1) {
                if (r > 0 && bNeg[r - 1][c] === -1) n++;
                if (r < N - 1 && bNeg[r + 1][c] === -1) n++;
                if (c > 0 && bNeg[r][c - 1] === -1) n++;
                if (c < N - 1 && bNeg[r][c + 1] === -1) n++;
            }
        }
    }
    return n;
}

/** 上下都被占用包围的空格数 */
function countFreedomZeroSpaces(bNeg: number[][]): number {
    const N = 8;
    let n = 0;
    for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
            if (bNeg[r][c] === -1 && r > 0 && bNeg[r - 1][c] === 1 && r < N - 1 && bNeg[r + 1][c] === 1
                && c > 0 && bNeg[r][c - 1] === 1 && c < N - 1 && bNeg[r][c + 1] === 1) {
                n++;
            }
        }
    }
    return n;
}

/** 恰好有 1 个空邻居的空格数 */
function countFreedomOneSpaces(bNeg: number[][]): number {
    const N = 8;
    let n = 0;
    for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
            if (bNeg[r][c] !== -1) continue;
            const empties = [
                r > 0 && bNeg[r - 1][c] === -1,
                r < N - 1 && bNeg[r + 1][c] === -1,
                c > 0 && bNeg[r][c - 1] === -1,
                c < N - 1 && bNeg[r][c + 1] === -1,
            ].filter(Boolean).length;
            if (empties === 1) n++;
        }
    }
    return n;
}

/** 行/列方向的"邻接连续度"（垂直方向：同列上下都空，水平：同行左右都空） */
function rowAndColCompleteness(b01: number[][]): { rowComp: number; colComp: number; rowConn: number; colConn: number } {
    const N = 8;
    let rowComp = 0, colComp = 0, rowConn = 0, colConn = 0;
    // rowCompleteness: 每行 1 占比之和
    for (const row of b01) {
        rowComp += row.filter((v) => v >= 1).length / 8;
    }
    // colCompleteness: 每列 1 占比之和
    for (let c = 0; c < N; c++) {
        let cnt = 0;
        for (let r = 0; r < N; r++) if (b01[r][c] === 1) cnt++;
        colComp += cnt / 8;
    }
    // totalRowConnectivity: 列方向相邻空格对数（×2 因为原版双向数了 -1↔-1）
    for (let r = 0; r < N - 1; r++) {
        for (let c = 0; c < N; c++) {
            if (b01[r][c] === 0 && b01[r + 1][c] === 0) rowConn += 2;
        }
    }
    // totalColumnConnectivity: 行方向相邻空格对数
    for (let r = 0; r < N; r++) {
        for (let c = 0; c < N - 1; c++) {
            if (b01[r][c] === 0 && b01[r][c + 1] === 0) colConn += 2;
        }
    }
    return { rowComp, colComp, rowConn, colConn };
}

// ─────────────────────────────────────────────────────────────────────────
// countMaxShapes —— 随机重复放置某 shape 直到放不下，返回最大放置数
// 原版用 Math.random 抽位置；这里允许传 RNG 以便测试。
// ─────────────────────────────────────────────────────────────────────────

function countMaxShapes(saveArr: number[][], shapeId: number, rng: () => number = Math.random): number {
    const board = new BinaryBoard();
    board.convertFromArr(saveArr);
    let count = 0;
    while (board.canPut(shapeId)) {
        const positions = board.getCanPutPoss(shapeId);
        if (positions.length === 0) break;
        const pos = positions[Math.floor(rng() * positions.length)];
        board.putBlock(shapeId, pos);
        count++;
    }
    return count;
}

function getBlockMaxPutCount(saveArr: number[][], rng?: () => number): number[] {
    return BLOCK_PUT_COUNT_IDS.map((id) => countMaxShapes(saveArr, id, rng));
}

// ─────────────────────────────────────────────────────────────────────────
// getOldBoardWeight —— 启发式 baseline，作为 LightGBM 的第 59 个输入特征
// 直接从原版逐行翻译（main_bundle.js:335984-336019）
// ─────────────────────────────────────────────────────────────────────────

function getEmptyCount(rowBinary: number[]): number {
    let n = 0;
    for (const r of rowBinary) n += 8 - popcount(r);
    return n;
}
function popcount(x: number): number {
    let n = 0;
    while (x) { n += x & 1; x >>>= 1; }
    return n;
}

function canPutAt(board: BinaryBoard, shapeId: number, col: number, row: number): boolean {
    const s = BlockShapeMap.get(shapeId);
    if (!s) return false;
    const xShift = 8 - s.width - col;
    if (xShift < 0) return false;
    if (row + s.height > 8) return false;
    for (let i = 0; i < s.height; i++) {
        if ((board.rowBinary[i + row] & (s.shape[i] << xShift)) > 0) return false;
    }
    return true;
}

export function getOldBoardWeight(saveArr: number[][]): number {
    const t = new BinaryBoard();
    t.convertFromArr(saveArr);
    const N = 8;
    let o = 0, i = 0, n = 0, l = 0;        // n=13(3×3) 可放数, l=11(5×1) 可放数
    const d = getEmptyCount(t.rowBinary);
    let f = 0;                              // 22(1×5) 可放数
    const m = new Array(8).fill(0);
    const g = new Array(8).fill(0);

    for (let y = 0; y < N; y++) {
        let v = 0, C = 0;
        for (let b = 0; b < N; b++) {
            const S = N - b - 1;
            if (t.rowBinary[y] & (1 << S)) {
                v++;
                m[b]++;
            } else {
                if (canPutAt(t, 13, b, y)) n++;
                if (canPutAt(t, 11, b, y)) l++;
                if (canPutAt(t, 22, b, y)) f++;
                // C: 水平方向左右邻居占用数
                if (b === 0) { if (t.rowBinary[y] & (1 << (S - 1))) C++; }
                else if (b === 7) { if (t.rowBinary[y] & (1 << (S + 1))) C++; }
                else {
                    if (t.rowBinary[y] & (1 << (S - 1))) C++;
                    if (t.rowBinary[y] & (1 << (S + 1))) C++;
                }
                // g[b]: 垂直方向上下邻居占用数（按列累加）
                if (y === 0) { if (t.rowBinary[y + 1] & (1 << S)) g[b]++; }
                else if (y === 7) { if (t.rowBinary[y - 1] & (1 << S)) g[b]++; }
                else {
                    if (t.rowBinary[y + 1] & (1 << S)) g[b]++;
                    if (t.rowBinary[y - 1] & (1 << S)) g[b]++;
                }
            }
        }
        o += v * C;
    }
    for (let y = 0; y < m.length; y++) i += m[y] * g[y];
    const a = o + i;
    const r = n >= 3 ? n + 20 : 2 * n + 10 + l / 3 + 3 + f / 3 + 3;

    return 246 + (d >= 32
        ? a - r - ((d - 32) * (d - 32)) / 5
        : n > 0
            ? a - r + ((d - 32) * (d - 32)) / 5
            : a - r + ((d - 32) * (d - 32)) / 2);
}

// ─────────────────────────────────────────────────────────────────────────
// 完整特征向量
// ─────────────────────────────────────────────────────────────────────────

export function extractFeatures(saveArr: number[][], rng?: () => number): number[] {
    const b01 = normalize(saveArr);
    const bNeg = normalizeNeg(b01);

    const features = getBlockMaxPutCount(saveArr, rng);   // [0..38]

    features.push(calculateEmptyRatio(b01));               // [39]
    const sm = calculateSmoothnessScore(b01);
    features.push(sm[0], sm[1], sm[2], sm[3]);              // [40..43]
    const holes = countHoles(b01);
    features.push(holes[0], holes[1]);                      // [44..45]
    const lcp = calculateLineClearPotential(b01);
    features.push(lcp[0], lcp[1]);                          // [46..47]
    features.push(count3x3ZeroSquares(b01));                // [48]
    const brc = countConsecutiveOnesInMatrix(b01, 5);
    features.push(brc[0], brc[1]);                          // [49..50]
    features.push(countExposedFaces(bNeg));                 // [51]
    features.push(countFreedomZeroSpaces(bNeg));            // [52]
    features.push(countFreedomOneSpaces(bNeg));             // [53]

    const conn = rowAndColCompleteness(b01);
    features.push(conn.rowComp, conn.colComp);              // [54..55]
    features.push(conn.rowConn, conn.colConn);              // [56..57]

    features.push(getOldBoardWeight(saveArr));              // [58]

    return features;
}

// ─────────────────────────────────────────────────────────────────────────
// LightGBM 推理
// ─────────────────────────────────────────────────────────────────────────

export interface LGBMTree {
    tree_index: number;
    num_leaves: number;
    tree_structure: LGBMNode;
}
export interface LGBMNode {
    split_feature?: number;
    threshold?: number;
    left_child?: LGBMNode;
    right_child?: LGBMNode;
    leaf_index?: number;
    leaf_value?: number;
}

function traverseTree(node: LGBMNode, features: number[]): number {
    while ('split_feature' in node) {
        const sf = node.split_feature!;
        const thr = node.threshold!;
        node = features[sf] <= thr ? node.left_child! : node.right_child!;
    }
    return node.leaf_value ?? 0;
}

/**
 * 主入口：和原版 `NewBoardWeightMethodCtr.getBoardWeight` 完全一致。
 * forest 来自 `public/assets/data/complex_model.json`。
 * 没传 forest 时回退到 getOldBoardWeight（与原版相同的兜底）。
 */
export function predictBoardWeight(saveArr: number[][], forest: LGBMTree[] | null, rng?: () => number): number {
    if (!forest || forest.length === 0) return getOldBoardWeight(saveArr);
    const features = extractFeatures(saveArr, rng);
    let raw = 0;
    for (const tree of forest) {
        raw += traverseTree(tree.tree_structure, features);
    }
    const sigmoid = 1 / (1 + Math.exp(-raw));
    return Math.round(650 * sigmoid);
}
