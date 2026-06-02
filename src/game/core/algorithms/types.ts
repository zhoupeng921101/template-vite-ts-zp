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
 * 简化版 weightList：
 *   - 给玩家"福利"的算法（FILL / CLEAR_ALL / RANDOM_NO_DIE）→ 正值（让 dynamicWeight 涨 → 进入更难的 tier）
 *   - 给玩家"惩罚"的算法（DIFF / STRAIGHT_DEATH_DIFF / ADD3）→ 负值（dynamicWeight 跌 → 回到简单 tier）
 *   - EASY_DIFF / ALL_COMBINATION 为中性偏正
 */
export const DEFAULT_WEIGHT_FACTORS: Record<AlgorithmKind, WeightFactor> = {
    [AlgorithmKind.FILL]:               { basic: +40, consecutive: +20 },
    [AlgorithmKind.RANDOM_NO_DIE]:      { basic: +15, consecutive: +5 },
    [AlgorithmKind.ADD3]:               { basic: -25, consecutive: -10 },
    [AlgorithmKind.EASY_DIFF]:          { basic: +30, consecutive: +12 },
    [AlgorithmKind.DIFF]:               { basic: -40, consecutive: -15 },
    [AlgorithmKind.STRAIGHT_DEATH_DIFF]:{ basic: -80, consecutive: -30 },
    [AlgorithmKind.CLEAR_ALL]:          { basic: +60, consecutive: +30 },
    [AlgorithmKind.ALL_COMBINATION]:    { basic: +35, consecutive: +15 },
};

/** 算法激活的分数下限（对应原游戏 isCondition: score > 1000） */
export const DYNAMIC_ACTIVATION_SCORE = 1000;
