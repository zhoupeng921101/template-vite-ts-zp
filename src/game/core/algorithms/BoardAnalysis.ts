// 棋盘位运算分析工具 —— 给"bit-aware 启发式"算法（FILL / DIFF / DEATH）用
//
// 命名规则：所有以 row/col 为单位的接口都用 8-bit 掩码（MSB = 最左列），
// 与 BinaryBoard.rowBinary 完全一致；位 = 1 表示已占用。

import { BinaryBoard } from '../BinaryBoard';
import { BlockShapeMap, COMMON_SHAPE_IDS } from '../BlockShapeMap';

const N = BinaryBoard.COL_COUNT; // 8
const FULL = BinaryBoard.FULL_ROW; // 255

/** popcount for 8-bit number */
function popcount(x: number): number {
    let n = 0;
    while (x) { n += x & 1; x >>>= 1; }
    return n;
}

/** ─── 行/列层面 ────────────────────────────────────────── */

/**
 * 找出还缺恰好 `missing` 格才能消除的行。返回 {r, gapMask}，
 * gapMask 是该行"空位的掩码"（取反 & FULL）。
 * missing 越小，越接近"一步消除"。
 */
export function rowsMissing(board: BinaryBoard, missing: number): { r: number; gapMask: number }[] {
    const out: { r: number; gapMask: number }[] = [];
    for (let r = 0; r < N; r++) {
        const filled = board.rowBinary[r];
        if (filled === FULL || filled === 0) continue;
        const gapMask = (~filled) & FULL;
        if (popcount(gapMask) === missing) out.push({ r, gapMask });
    }
    return out;
}

/** 同 rowsMissing，但 missing 可以是范围 [min, max] */
export function rowsMissingRange(board: BinaryBoard, min: number, max: number): { r: number; gapMask: number; missing: number }[] {
    const out: { r: number; gapMask: number; missing: number }[] = [];
    for (let r = 0; r < N; r++) {
        const filled = board.rowBinary[r];
        if (filled === FULL || filled === 0) continue;
        const gapMask = (~filled) & FULL;
        const m = popcount(gapMask);
        if (m >= min && m <= max) out.push({ r, gapMask, missing: m });
    }
    return out;
}

/**
 * 计算列的"填充位掩码"——bit c = 1 表示第 (N-1-c) 列已占用。
 * 返回一个 8-bit number（与 row 同形状）。
 */
function colFilledMask(board: BinaryBoard): number[] {
    const cols = new Array<number>(N).fill(0);
    for (let r = 0; r < N; r++) {
        const row = board.rowBinary[r];
        for (let c = 0; c < N; c++) {
            const bit = (row >> (N - c - 1)) & 1;
            if (bit) cols[c] |= 1 << (N - r - 1);
        }
    }
    return cols;
}

/** 找还缺 `missing` 格的列。gapMask 同 rowsMissing。 */
export function colsMissing(board: BinaryBoard, missing: number): { c: number; gapMask: number }[] {
    const cols = colFilledMask(board);
    const out: { c: number; gapMask: number }[] = [];
    for (let c = 0; c < N; c++) {
        const filled = cols[c];
        if (filled === FULL || filled === 0) continue;
        const gapMask = (~filled) & FULL;
        if (popcount(gapMask) === missing) out.push({ c, gapMask });
    }
    return out;
}

/** ─── 区域层面 ────────────────────────────────────────── */

/**
 * 最大全空矩形：返回 (w, h, r, c)，r/c 是左上角坐标。
 * 经典动态规划：直方图 + 最大矩形。O(N²) 时间。
 */
export function largestEmptyRect(board: BinaryBoard): { w: number; h: number; r: number; c: number } {
    const heights = new Array<number>(N).fill(0);
    let best = { w: 0, h: 0, r: 0, c: 0 };
    for (let r = 0; r < N; r++) {
        const row = board.rowBinary[r];
        for (let c = 0; c < N; c++) {
            const empty = ((row >> (N - c - 1)) & 1) === 0;
            heights[c] = empty ? heights[c] + 1 : 0;
        }
        // 单调栈求当前直方图最大矩形
        const stack: number[] = [];
        for (let c = 0; c <= N; c++) {
            const h = c === N ? 0 : heights[c];
            while (stack.length > 0 && heights[stack[stack.length - 1]] > h) {
                const top = stack.pop()!;
                const left = stack.length === 0 ? -1 : stack[stack.length - 1];
                const width = c - left - 1;
                const height = heights[top];
                if (width * height > best.w * best.h) {
                    best = { w: width, h: height, r: r - height + 1, c: left + 1 };
                }
            }
            stack.push(c);
        }
    }
    return best;
}

/** 棋盘已填充率（0~1） */
export function fillRatio(board: BinaryBoard): number {
    let n = 0;
    for (const row of board.rowBinary) n += popcount(row);
    return n / (N * N);
}

/** ─── 形状索引：按 (w,h) 分组 ────────────────────────── */

const SHAPE_BY_WH = new Map<string, number[]>();
const SHAPE_BY_W  = new Map<number, number[]>();
const SHAPE_BY_H  = new Map<number, number[]>();
const HORIZONTAL_LINES = new Map<number, number>(); // width -> shape id（纯横一行）
const VERTICAL_LINES   = new Map<number, number>(); // height -> shape id（纯竖一列）

(function buildShapeIndex() {
    for (const id of COMMON_SHAPE_IDS) {
        const s = BlockShapeMap.get(id);
        if (!s) continue;
        const keyWH = `${s.width}x${s.height}`;
        const listWH = SHAPE_BY_WH.get(keyWH) ?? []; listWH.push(id); SHAPE_BY_WH.set(keyWH, listWH);
        const listW  = SHAPE_BY_W.get(s.width)   ?? []; listW.push(id);  SHAPE_BY_W.set(s.width, listW);
        const listH  = SHAPE_BY_H.get(s.height)  ?? []; listH.push(id);  SHAPE_BY_H.set(s.height, listH);
        // 纯横一行：height=1, shape=[(1<<w)-1]
        if (s.height === 1 && s.shape[0] === (1 << s.width) - 1) {
            if (!HORIZONTAL_LINES.has(s.width)) HORIZONTAL_LINES.set(s.width, id);
        }
        // 纯竖一列：width=1, shape=[1,1,...,1]
        if (s.width === 1 && s.shape.every((x) => x === 1)) {
            if (!VERTICAL_LINES.has(s.height)) VERTICAL_LINES.set(s.height, id);
        }
    }
})();

/** 找出 width = w 的所有 shape id */
export function shapesByWidth(w: number): number[] {
    return SHAPE_BY_W.get(w) ?? [];
}

/** 找出 height = h 的所有 shape id */
export function shapesByHeight(h: number): number[] {
    return SHAPE_BY_H.get(h) ?? [];
}

/** 纯横一行、width=w 的 shape（用于一次填满一行的尾巴）。可能不存在。 */
export function horizontalLineShape(width: number): number | undefined {
    return HORIZONTAL_LINES.get(width);
}

/** 纯竖一列、height=h 的 shape */
export function verticalLineShape(height: number): number | undefined {
    return VERTICAL_LINES.get(height);
}

/**
 * "适配某 w×h 矩形"的所有 shape：width<=w 且 height<=h。
 * 用来在已知最大空矩形后挑能放进去的形状。
 */
export function shapesFittingRect(w: number, h: number): number[] {
    const out: number[] = [];
    for (const id of COMMON_SHAPE_IDS) {
        const s = BlockShapeMap.get(id);
        if (!s) continue;
        if (s.width <= w && s.height <= h) out.push(id);
    }
    return out;
}

/**
 * "几乎填满某 w×h 矩形"的所有 shape：占用面积 / (w*h) ≥ 0.6 且 width<=w, height<=h。
 * 用来在 CLEAR_ALL 类算法中挑大块。
 */
export function shapesFillingRect(w: number, h: number, minRatio = 0.6): number[] {
    const out: number[] = [];
    for (const id of COMMON_SHAPE_IDS) {
        const s = BlockShapeMap.get(id);
        if (!s) continue;
        if (s.width > w || s.height > h) continue;
        const cells = s.shape.reduce((acc, row) => acc + popcount(row), 0);
        if (cells / (w * h) >= minRatio) out.push(id);
    }
    return out;
}

/** ─── 一些常量 ─────────────────────────────────────── */
export const ALL_COMMON = COMMON_SHAPE_IDS.slice();
