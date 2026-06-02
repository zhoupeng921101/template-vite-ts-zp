// 8x8 棋盘核心逻辑（从 BinaryBoard.js 移植，去掉 cc.* 依赖）
//
// 棋盘用二进制位表示：rowBinary[i] 是第 i 行的位掩码
//   bit (colCount - col - 1) 为 1 表示该格被占用
//   例如 8 列时，最左列对应 bit 7 (128)

import { BlockShapeMap } from './BlockShapeMap';

export interface Vec2 { x: number; y: number; }

export interface ClearResult {
    rows: number[];    // 被消除的行索引
    cols: number[];    // 被消除的列索引
}

export class BinaryBoard {
    static readonly ROW_COUNT = 8;
    static readonly COL_COUNT = 8;
    static readonly FULL_ROW = (1 << BinaryBoard.COL_COUNT) - 1;  // 0b11111111 = 255

    rowBinary: number[] = new Array(BinaryBoard.ROW_COUNT).fill(0);

    /** 从 2D 数组初始化（用于关卡 Map 加载或恢复存档） */
    convertFromArr(saveArr: number[][]): void {
        for (let r = 0; r < BinaryBoard.ROW_COUNT; r++) {
            let bits = 0;
            for (let c = 0; c < BinaryBoard.COL_COUNT; c++) {
                if (saveArr[r][c] !== -1) {
                    bits |= 1 << (BinaryBoard.COL_COUNT - c - 1);
                }
            }
            this.rowBinary[r] = bits;
        }
    }

    /** 棋盘是否为空 */
    isEmpty(): boolean {
        return this.rowBinary.every(r => r === 0);
    }

    /** 克隆 */
    clone(): BinaryBoard {
        const b = new BinaryBoard();
        b.rowBinary = [...this.rowBinary];
        return b;
    }

    /** 指定格子是否为空 */
    emptyAt(col: number, row: number): boolean {
        return (this.rowBinary[row] & (1 << (BinaryBoard.COL_COUNT - col - 1))) === 0;
    }

    /** 把形状放到 (col, row) 起点（col=左, row=上）— 不检查是否冲突 */
    putBlock(shapeId: number, pos: Vec2): void {
        const shape = BlockShapeMap.get(shapeId);
        if (!shape) return;
        const xShift = BinaryBoard.COL_COUNT - shape.width - pos.x;
        for (let i = 0; i < shape.height; i++) {
            this.rowBinary[i + pos.y] |= shape.shape[i] << xShift;
        }
    }

    /** 校验是否可以把形状放到 (col, row) 起点 */
    canPutBlock(shapeId: number, pos: Vec2): boolean {
        const shape = BlockShapeMap.get(shapeId);
        if (!shape) return false;
        if (pos.x < 0 || pos.y < 0) return false;
        if (pos.x + shape.width > BinaryBoard.COL_COUNT) return false;
        if (pos.y + shape.height > BinaryBoard.ROW_COUNT) return false;

        const xShift = BinaryBoard.COL_COUNT - shape.width - pos.x;
        for (let i = 0; i < shape.height; i++) {
            if ((this.rowBinary[i + pos.y] & (shape.shape[i] << xShift)) > 0) {
                return false;
            }
        }
        return true;
    }

    /** 返回所有可放置位置 */
    getCanPutPoss(shapeId: number): Vec2[] {
        const shape = BlockShapeMap.get(shapeId);
        if (!shape) return [];
        const result: Vec2[] = [];
        for (let x = 0; x <= BinaryBoard.COL_COUNT - shape.width; x++) {
            for (let y = 0; y <= BinaryBoard.ROW_COUNT - shape.height; y++) {
                if (this.canPutBlock(shapeId, { x, y })) {
                    result.push({ x, y });
                }
            }
        }
        return result;
    }

    /** 判断形状能否放到当前棋盘上任何位置 */
    canPut(shapeId: number): boolean {
        return this.getCanPutPoss(shapeId).length > 0;
    }

    /** 检查 3 个候选形状是否至少有一种放置顺序能全放下（用于 GameOver 检测） */
    checkPutAllBlocks(shapeIds: number[]): boolean {
        const valid = shapeIds.filter(id => id > 0);
        if (valid.length === 0) return true;

        const tryAll = (remaining: number[]): boolean => {
            if (remaining.length === 0) return true;
            for (let i = 0; i < remaining.length; i++) {
                const id = remaining[i];
                const positions = this.getCanPutPoss(id);
                for (const pos of positions) {
                    const backup = [...this.rowBinary];
                    this.putBlock(id, pos);
                    const rest = remaining.filter((_, j) => j !== i);
                    if (tryAll(rest)) {
                        this.rowBinary = backup;
                        return true;
                    }
                    this.rowBinary = backup;
                }
            }
            return false;
        };
        return tryAll(valid);
    }

    /** 仅检查每个形状能否独立放下（更宽松的 GameOver 判定） */
    canPutAnyOf(shapeIds: number[]): boolean {
        return shapeIds.some(id => id > 0 && this.canPut(id));
    }

    /** 找出当前所有满行/满列，可选择就地消除 */
    canClearRowCols(doClear: boolean): ClearResult {
        const rows: number[] = [];
        const cols: number[] = [];

        // 满行
        for (let r = 0; r < BinaryBoard.ROW_COUNT; r++) {
            if (this.rowBinary[r] === BinaryBoard.FULL_ROW) rows.push(r);
        }

        // 满列：所有行的同一列都是 1
        let colBits = BinaryBoard.FULL_ROW;
        for (let r = 0; r < BinaryBoard.ROW_COUNT; r++) {
            colBits &= this.rowBinary[r];
        }
        for (let c = BinaryBoard.COL_COUNT - 1; colBits > 0; c--) {
            if (colBits & 1) cols.push(c);
            colBits >>= 1;
        }

        if (doClear) {
            for (const r of rows) this.rowBinary[r] = 0;
            for (const c of cols) {
                const clearMask = ~(1 << (BinaryBoard.COL_COUNT - c - 1)) & BinaryBoard.FULL_ROW;
                for (let r = 0; r < BinaryBoard.ROW_COUNT; r++) {
                    this.rowBinary[r] &= clearMask;
                }
            }
        }

        return { rows, cols };
    }

    /** 转回 2D 数组（用于渲染/存档），空格用 -1，占用用 1 */
    convertToArr(): number[][] {
        const out: number[][] = [];
        for (let r = 0; r < BinaryBoard.ROW_COUNT; r++) {
            const row: number[] = [];
            for (let c = 0; c < BinaryBoard.COL_COUNT; c++) {
                row.push(this.emptyAt(c, r) ? -1 : 1);
            }
            out.push(row);
        }
        return out;
    }

    /** 调试：打印棋盘 */
    debugPrint(): string {
        return this.rowBinary
            .map(r => r.toString(2).padStart(BinaryBoard.COL_COUNT, '0').replace(/0/g, '·').replace(/1/g, '■'))
            .join('\n');
    }
}
