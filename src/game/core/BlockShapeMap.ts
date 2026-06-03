// 方块形状定义（来自 BinaryBoard.js 的 BlockShapeMap）
// shape[i] 是第 i 行的二进制掩码（从左到右，最高位代表最左列）

export interface BlockShape {
    width: number;
    height: number;
    shape: number[];
}

export const BlockShapeMap = new Map<number, BlockShape>([
    [1,   { width: 1, height: 1, shape: [1] }],
    [2,   { width: 1, height: 2, shape: [1, 1] }],
    [3,   { width: 2, height: 1, shape: [3] }],
    [4,   { width: 1, height: 3, shape: [1, 1, 1] }],
    [5,   { width: 3, height: 1, shape: [7] }],
    [6,   { width: 2, height: 2, shape: [3, 2] }],
    [7,   { width: 1, height: 4, shape: [1, 1, 1, 1] }],
    [8,   { width: 3, height: 2, shape: [4, 7] }],
    [9,   { width: 2, height: 2, shape: [3, 3] }],
    [10,  { width: 3, height: 2, shape: [2, 7] }],
    [11,  { width: 5, height: 1, shape: [31] }],
    [12,  { width: 3, height: 3, shape: [7, 1, 1] }],
    [13,  { width: 3, height: 3, shape: [7, 7, 7] }],
    [14,  { width: 3, height: 2, shape: [3, 6] }],
    [15,  { width: 2, height: 2, shape: [3, 1] }],
    [16,  { width: 2, height: 3, shape: [2, 3, 1] }],
    [17,  { width: 4, height: 1, shape: [15] }],
    [18,  { width: 3, height: 2, shape: [6, 3] }],
    [19,  { width: 2, height: 3, shape: [1, 3, 2] }],
    [20,  { width: 2, height: 3, shape: [2, 3, 2] }],
    [21,  { width: 3, height: 3, shape: [7, 4, 4] }],
    [22,  { width: 1, height: 5, shape: [1, 1, 1, 1, 1] }],
    [23,  { width: 3, height: 3, shape: [4, 4, 7] }],
    [24,  { width: 3, height: 3, shape: [1, 1, 7] }],
    [25,  { width: 2, height: 3, shape: [1, 3, 1] }],
    [26,  { width: 3, height: 2, shape: [7, 2] }],
    [27,  { width: 2, height: 2, shape: [2, 3] }],
    [28,  { width: 2, height: 2, shape: [1, 3] }],
    [29,  { width: 2, height: 3, shape: [1, 1, 3] }],
    [30,  { width: 3, height: 2, shape: [7, 1] }],
    [31,  { width: 2, height: 3, shape: [3, 2, 2] }],
    [32,  { width: 2, height: 3, shape: [3, 1, 1] }],
    [33,  { width: 3, height: 2, shape: [1, 7] }],
    [34,  { width: 3, height: 2, shape: [7, 4] }],
    [35,  { width: 3, height: 2, shape: [7, 7] }],
    [36,  { width: 2, height: 3, shape: [3, 3, 3] }],
    [37,  { width: 2, height: 2, shape: [2, 1] }],
    [38,  { width: 2, height: 2, shape: [1, 2] }],
    [39,  { width: 3, height: 3, shape: [4, 2, 1] }],
    [40,  { width: 3, height: 3, shape: [1, 2, 4] }],
    [41,  { width: 3, height: 3, shape: [1, 2, 4] }],
    [42,  { width: 2, height: 3, shape: [2, 2, 3] }],
    [53,  { width: 2, height: 3, shape: [1, 1, 2] }],
    [54,  { width: 2, height: 3, shape: [2, 2, 1] }],
    [55,  { width: 3, height: 2, shape: [4, 3] }],
    [56,  { width: 3, height: 2, shape: [1, 6] }],
    [57,  { width: 3, height: 3, shape: [7, 2, 2] }],
    [58,  { width: 3, height: 3, shape: [2, 2, 7] }],
    [59,  { width: 3, height: 3, shape: [4, 7, 4] }],
    [60,  { width: 3, height: 3, shape: [1, 7, 1] }],
    [61,  { width: 3, height: 2, shape: [7, 5] }],
    [62,  { width: 3, height: 2, shape: [5, 7] }],
    [63,  { width: 3, height: 3, shape: [3, 2, 3] }],
    [64,  { width: 3, height: 3, shape: [3, 1, 3] }],
    [65,  { width: 3, height: 3, shape: [7, 5, 5] }],
    [66,  { width: 3, height: 3, shape: [5, 5, 7] }],
    [67,  { width: 3, height: 3, shape: [7, 4, 7] }],
    [68,  { width: 3, height: 3, shape: [7, 1, 7] }],
    [69,  { width: 3, height: 3, shape: [2, 7, 2] }],
    [70,  { width: 3, height: 3, shape: [5, 2, 5] }],
    [101, { width: 5, height: 2, shape: [31, 31] }],
    [102, { width: 2, height: 5, shape: [3, 3, 3, 3, 3] }],
    [103, { width: 4, height: 2, shape: [15, 15] }],
    [104, { width: 2, height: 4, shape: [3, 3, 3, 3] }],
    [105, { width: 5, height: 3, shape: [31, 31, 31] }],
    [106, { width: 3, height: 5, shape: [7, 7, 7, 7, 7] }],
    [107, { width: 4, height: 3, shape: [15, 15, 15] }],
    [108, { width: 3, height: 4, shape: [7, 7, 7, 7] }],
    [109, { width: 5, height: 4, shape: [31, 31, 31, 31] }],
    [110, { width: 4, height: 5, shape: [15, 15, 15, 15, 15] }],
    [111, { width: 5, height: 5, shape: [31, 31, 31, 31, 31] }],
]);

// 每个形状包含的格子数（预计算）
export const BlockNumMap = new Map<number, number>();
BlockShapeMap.forEach((shape, id) => {
    let n = 0;
    for (const row of shape.shape) {
        for (let b = 0; b < 10; b++) {
            if ((row >> b) & 1) n++;
        }
    }
    BlockNumMap.set(id, n);
});

/**
 * 原游戏生产形状池（FirstRoundProTurnPutCtrl.useBlocks）
 * 39 个 ID，覆盖 1×2 ~ 5×1 / 各种 L、T、Z、S / 2×2、2×3、3×2、3×3 实心与变体
 * 来源：原游戏 com.block.juggle 反编译 main_bundle.js 行 234644
 * 注意：刻意不包含 id=1 (1×1)，避免送给玩家过于简单的"安全块"
 */
export const COMMON_SHAPE_IDS: number[] = [
    2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37,
    38, 39, 42,
];

export const ALL_SHAPE_IDS: number[] = Array.from(BlockShapeMap.keys());

/**
 * 新玩家首发的 3 个形状（来自原游戏 03_board_configs/shapeCfg.json firstIds）
 * 9 = 2x2 实心, 39 = 3x3 对角, 24 = 3x3 L
 */
export const FIRST_HAND_SHAPE_IDS: number[] = [9, 39, 24];
