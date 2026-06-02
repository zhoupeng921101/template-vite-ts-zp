// 棋盘评估器：被算法用来评分候选 trio
import { BinaryBoard, Vec2 } from '../BinaryBoard';
import { BlockShapeMap, BlockNumMap } from '../BlockShapeMap';

export interface Placement { id: number; pos: Vec2; }

export class BoardEvaluator {
    /** 拷贝棋盘（rowBinary） */
    static cloneRows(board: BinaryBoard): number[] {
        return [...board.rowBinary];
    }

    static restoreRows(board: BinaryBoard, rows: number[]): void {
        board.rowBinary = [...rows];
    }

    /**
     * 枚举所有解（trio 的合法放置序列），最多到 limit 个就提前返回。
     * 返回每个解的 Placement[] 路径。
     */
    static enumerateSolutions(board: BinaryBoard, trio: number[], limit = 64): Placement[][] {
        const valid = trio.filter((id) => id > 0);
        if (valid.length === 0) return [[]];

        const solutions: Placement[][] = [];
        const path: Placement[] = [];

        const dfs = (remaining: number[]): boolean => {
            if (solutions.length >= limit) return true;
            if (remaining.length === 0) {
                solutions.push([...path]);
                return solutions.length >= limit;
            }
            for (let i = 0; i < remaining.length; i++) {
                const id = remaining[i];
                const positions = board.getCanPutPoss(id);
                for (const pos of positions) {
                    const backup = BoardEvaluator.cloneRows(board);
                    board.putBlock(id, pos);
                    path.push({ id, pos });
                    const rest = remaining.filter((_, j) => j !== i);
                    const done = dfs(rest);
                    path.pop();
                    BoardEvaluator.restoreRows(board, backup);
                    if (done) return true;
                }
            }
            return false;
        };

        dfs(valid);
        return solutions;
    }

    /** 仅统计解数量（用 limit 控上限以剪枝）；返回 ≥ limit 表示"非常多" */
    static countSolutions(board: BinaryBoard, trio: number[], limit = 64): number {
        return BoardEvaluator.enumerateSolutions(board, trio, limit).length;
    }

    /**
     * 模拟一种放置序列，返回该序列消除的格子数与剩余棋盘的 rowBinary 快照。
     * 期间会消除满行/满列（与游戏内一致）。
     */
    static simulate(board: BinaryBoard, sequence: Placement[]): { cleared: number; finalRows: number[]; clearedAll: boolean } {
        const backup = BoardEvaluator.cloneRows(board);
        let cleared = 0;
        for (const { id, pos } of sequence) {
            board.putBlock(id, pos);
            const r = board.canClearRowCols(true);
            // 这一步消除的格子数：rows × 8 + cols × (8 - rows.length)，避免行列交叉点重复计
            cleared += r.rows.length * 8 + r.cols.length * (8 - r.rows.length);
        }
        const finalRows = BoardEvaluator.cloneRows(board);
        const clearedAll = finalRows.every((r) => r === 0);
        BoardEvaluator.restoreRows(board, backup);
        return { cleared, finalRows, clearedAll };
    }

    /**
     * 找到使指定打分函数最大的放置序列，返回 (sequence, score, cleared)
     * scoreFn 输入：拷贝的 rowBinary（模拟后状态）、累计消除格子数。
     */
    static findBest(
        board: BinaryBoard,
        trio: number[],
        scoreFn: (finalRows: number[], cleared: number) => number,
        solutionLimit = 32,
    ): { sequence: Placement[]; score: number; cleared: number } | null {
        const sols = BoardEvaluator.enumerateSolutions(board, trio, solutionLimit);
        if (sols.length === 0) return null;
        let best: { sequence: Placement[]; score: number; cleared: number } | null = null;
        for (const seq of sols) {
            const sim = BoardEvaluator.simulate(board, seq);
            const sc = scoreFn(sim.finalRows, sim.cleared);
            if (!best || sc > best.score) {
                best = { sequence: seq, score: sc, cleared: sim.cleared };
            }
        }
        return best;
    }

    /**
     * 熵 / 复杂度：相邻格子状态不同的边数（占用-空 边界越多越乱）。
     * 0 = 棋盘全空或全满（最有序），更大 = 越乱。
     */
    static entropy(rows: number[]): number {
        const ROWS = 8, COLS = 8;
        let e = 0;
        // 水平相邻
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS - 1; c++) {
                const a = (rows[r] >> (COLS - c - 1)) & 1;
                const b = (rows[r] >> (COLS - c - 2)) & 1;
                if (a !== b) e++;
            }
        }
        // 垂直相邻
        for (let c = 0; c < COLS; c++) {
            const mask = 1 << (COLS - c - 1);
            for (let r = 0; r < ROWS - 1; r++) {
                const a = (rows[r]   & mask) ? 1 : 0;
                const b = (rows[r+1] & mask) ? 1 : 0;
                if (a !== b) e++;
            }
        }
        return e;
    }

    /** 已占格子数 */
    static filledCount(rows: number[]): number {
        let n = 0;
        for (const r of rows) {
            let x = r;
            while (x) { n += x & 1; x >>>= 1; }
        }
        return n;
    }

    /** trio 总格子数 */
    static trioCells(trio: number[]): number {
        let n = 0;
        for (const id of trio) n += BlockNumMap.get(id) ?? 0;
        return n;
    }

    /** trio 的最大单块尺寸（max(width, height)），用于偏好"难放的大块" */
    static trioMaxDim(trio: number[]): number {
        let m = 0;
        for (const id of trio) {
            const s = BlockShapeMap.get(id);
            if (s) m = Math.max(m, s.width, s.height);
        }
        return m;
    }
}
