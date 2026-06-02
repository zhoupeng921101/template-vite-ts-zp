// 关卡加载器

/** 单个收集要求；Key 9999 表示分数，其他对应元素类型 */
export interface RequiredCollection {
    Key: number;
    Value: number;
}

export interface LevelCondition {
    Name: string;          // score_to_win / 等
    Way: number;
    RequiredScore: number;
    RequiredCollections: RequiredCollection[];
}

export interface LevelConfig {
    Num: number;
    modeType: number;
    weightMin: number;
    weightMax: number;
    levelParam: string;
    levelType: number;
    levelTarget: number;
    /** 64 个值：8×8 棋盘预设，0 = 空，>0 = 固定障碍格 */
    Map: number[];
    Condition: LevelCondition;
    MapParam?: unknown[];
    collectParam?: unknown[];
    collectInBlock?: number[];
    elementWeight?: number[];
    collectWeight?: number[];
    collectNoWeight?: number[];
    blockAlgorithm?: unknown[];
}

interface RawLevelsFile {
    LevelConfigs: LevelConfig[];
}

export class LevelLoader {
    private static _levels: LevelConfig[] = [];

    /** 从 Phaser cache 加载关卡数据（必须在 Scene 里调用） */
    static loadFromCache(jsonData: RawLevelsFile | LevelConfig[]): void {
        this._levels = Array.isArray(jsonData) ? jsonData : jsonData.LevelConfigs;
    }

    static get count(): number { return this._levels.length; }

    /** 按编号取关卡（1-based） */
    static get(num: number): LevelConfig | null {
        if (num < 1 || num > this._levels.length) return null;
        return this._levels[num - 1];
    }

    /** 把关卡的 Map[64] 解析成 8×8 棋盘初始状态：0/障碍 → 颜色索引，否则 → -1 */
    static buildBoardFromMap(level: LevelConfig): number[][] {
        const board: number[][] = [];
        for (let r = 0; r < 8; r++) {
            const row: number[] = [];
            for (let c = 0; c < 8; c++) {
                const v = level.Map[r * 8 + c];
                // 原游戏：0 = 空白可放置, 1-7 = 预置障碍方块（带颜色）
                if (v === 0) row.push(-1);
                else row.push(v - 1);  // 1..7 → 颜色索引 0..6
            }
            board.push(row);
        }
        return board;
    }
}
