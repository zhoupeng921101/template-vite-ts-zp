// 8 种动态权重算法（对应原游戏 main_bundle.js 内 DynamicWeightDiff）
export enum AlgorithmKind {
    FILL = 0,                // 填空消除 (tiankongxiaochu2)
    RANDOM_NO_DIE = 1,       // 随机无死亡 (suijiwusiwang)
    ADD3 = 2,                // 熵增算法 (shangzeng3)
    EASY_DIFF = 3,           // 简单难题
    DIFF = 4,                // 困难难题
    STRAIGHT_DEATH_DIFF = 5, // 直觉/死亡难题
    CLEAR_ALL = 6,           // 清盘 Plus
    ALL_COMBINATION = 7,     // 全组合填空消除
}

export const ALGORITHM_NAME: Record<AlgorithmKind, string> = {
    [AlgorithmKind.FILL]: 'FILL',
    [AlgorithmKind.RANDOM_NO_DIE]: 'RANDOM_NO_DIE',
    [AlgorithmKind.ADD3]: 'ADD3',
    [AlgorithmKind.EASY_DIFF]: 'EASY_DIFF',
    [AlgorithmKind.DIFF]: 'DIFF',
    [AlgorithmKind.STRAIGHT_DEATH_DIFF]: 'STRAIGHT_DEATH_DIFF',
    [AlgorithmKind.CLEAR_ALL]: 'CLEAR_ALL',
    [AlgorithmKind.ALL_COMBINATION]: 'ALL_COMBINATION',
};

/** weightcfg.json 单项 */
export interface WeightConfigEntry {
    id: number;
    FillBlankOdds: number;
    RandomOdds: number;
    EntropyOdds: number;
    EasyOdds: number;
    HardOdds: number;
    IntuitionOdds: number;
    Clearboard: number;
    Allunite: number;
    HighScoreRange: [number, number]; // [min, max]，max=-1 表示无上限
    FactorRange: [number, number];    // [low, high]，会取 min/max
}

/** 单个 odds 字段顺序，与 AlgorithmKind 一一对应 */
export const ODDS_FIELDS: (keyof Pick<WeightConfigEntry,
    'FillBlankOdds' | 'RandomOdds' | 'EntropyOdds' | 'EasyOdds' |
    'HardOdds' | 'IntuitionOdds' | 'Clearboard' | 'Allunite'
>)[] = [
    'FillBlankOdds',
    'RandomOdds',
    'EntropyOdds',
    'EasyOdds',
    'HardOdds',
    'IntuitionOdds',
    'Clearboard',
    'Allunite',
];

/** 每种算法的"调权因子"。原游戏从 featInfo.weightList 来；这里给一组合理默认 */
export interface WeightFactor {
    /** 首次/换向时的增量 */
    basic: number;
    /** 同向连续时的增量 */
    consecutive: number;
}

/**
 * 真实 weightList，来自原游戏 cfg.json (`unitWay.json`) 中
 * `feature.dynamicWeightDiff[0].param.weightList`（feature id=184100001）。
 *
 * 设计逻辑（与最初直觉相反）：
 *   - 软算法（FILL / RANDOM_NO_DIE / CLEAR_ALL / ALL_COMBINATION）→ basic 为负，
 *     给玩家"福利"后 factor 下降 → 下次还落在偏软 tier。**强化"放水"惯性**。
 *   - 硬算法（ADD3 / EASY_DIFF / DIFF / STRAIGHT_DEATH_DIFF）→ basic 为正，
 *     刚整了一波难题后 factor 上升 → 下次更可能继续硬 tier。**强化"惩罚"惯性**。
 *
 * 这是 **动量** 模型而非补偿模型：连续硬题会累加 +10/+20/+20...，把玩家
 * 推进高难度 tier；一遇到软算法（preDynamicWeight 反号）就 reset 到 basic，
 * 拉回中性区间。CLEAR_ALL / STRAIGHT_DEATH_DIFF 的系数 ±20/±40 最大，
 * 代表"大事件"时的剧烈摆动。
 */
export const DEFAULT_WEIGHT_FACTORS: Record<AlgorithmKind, WeightFactor> = {
    [AlgorithmKind.FILL]:               { basic: -10, consecutive: -20 },
    [AlgorithmKind.RANDOM_NO_DIE]:      { basic:  -5, consecutive: -10 },
    [AlgorithmKind.ADD3]:               { basic:   5, consecutive:  10 },
    [AlgorithmKind.EASY_DIFF]:          { basic:   5, consecutive:  10 },
    [AlgorithmKind.DIFF]:               { basic:  10, consecutive:  20 },
    [AlgorithmKind.STRAIGHT_DEATH_DIFF]:{ basic:  20, consecutive:  40 },
    [AlgorithmKind.CLEAR_ALL]:          { basic: -20, consecutive: -40 },
    [AlgorithmKind.ALL_COMBINATION]:    { basic: -10, consecutive: -20 },
};

/** 算法激活的分数下限（对应原游戏 isCondition: score > 1000） */
export const DYNAMIC_ACTIVATION_SCORE = 1000;
