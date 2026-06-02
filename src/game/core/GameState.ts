// 全局游戏状态（单例）
import { BinaryBoard } from './BinaryBoard';
import { BlockShapeMap, COMMON_SHAPE_IDS, getShapeWeight, FIRST_HAND_SHAPE_IDS, BlockNumMap } from './BlockShapeMap';
import { DynamicWeightDiff } from './DynamicWeightDiff';
import { AlgorithmKind } from './algorithms/types';
import { GameConfig } from './GameConfig';

export const COLOR_NAMES = [
    'block_blue',
    'block_green',
    'block_yellow',
    'block_orange',
    'block_red',
    'block_steel',
    'block_teal',
    'block_purple',
] as const;
export type ColorName = typeof COLOR_NAMES[number];

// 收集元素：对应原游戏 RequiredCollections 的 8 个 Key（100-107）+ 200
export type ElementType =
    | 'diamond' | 'pentagon' | 'star'
    | 'heart'   | 'sun'      | 'moon'
    | 'leaf'    | 'crown'    | 'stone';
export const ELEMENT_TYPES: ElementType[] = [
    'diamond', 'pentagon', 'star',
    'heart', 'sun', 'moon',
    'leaf', 'crown', 'stone',
];
export const ELEMENT_GLYPH: Record<ElementType, string> = {
    diamond: '◆', pentagon: '⬟', star: '★',
    heart:   '♥', sun:      '☀', moon: '☾',
    leaf:    '✿', crown:    '♕', stone:'⬢',
};
export const ELEMENT_COLOR: Record<ElementType, string> = {
    diamond: '#44ccff', pentagon: '#ff9944', star: '#ffdd44',
    heart:   '#ff66aa', sun:      '#ffcc22', moon: '#bbccff',
    leaf:    '#88ee66', crown:    '#cc88ff', stone:'#aabbbb',
};
/** Condition.RequiredCollections.Key → ElementType */
export const COLLECT_KEY_MAP: Record<number, ElementType> = {
    100: 'diamond',
    101: 'pentagon',
    102: 'star',
    103: 'heart',
    104: 'sun',
    105: 'moon',
    106: 'leaf',
    107: 'crown',
    200: 'stone',
};

const STORAGE_KEY = 'block_blast_save_v1';

export interface PendingPiece {
    shapeId: number;
    color: ColorName;
    /** D5 每个填充格上是否带元素图标，按 (r,c) 行优先遍历 shape.shape 时的顺序索引 */
    elements?: (ElementType | null)[];
}

export interface SaveData {
    saveArr: number[][];
    operaArr: (PendingPiece | null)[];
    score: number;
    highScore: number;
    level: number;
    levelStars?: Record<number, number>;
}

export type GameMode = 'classic' | 'adventure';

export class GameState {
    private static _instance: GameState;
    static get instance(): GameState {
        if (!this._instance) this._instance = new GameState();
        return this._instance;
    }

    /** 8x8 棋盘：-1 = 空, 0..7 = COLOR_NAMES 索引 */
    saveArr: number[][];
    /** 手持的 3 个候选方块 */
    operaArr: (PendingPiece | null)[];
    /** 收集元素叠加层：与 saveArr 平行，null=无元素 */
    elementArr: (ElementType | null)[][];
    /** 已收集（按元素类型） */
    collected: Partial<Record<ElementType, number>> = {};
    /** 收集目标（按元素类型） */
    collectionTargets: Partial<Record<ElementType, number>> = {};
    /** D7 本关已使用的落子步数（收集模式星级评定用） */
    moves = 0;

    constructor() {
        this.saveArr = this.makeEmptyBoard();
        this.operaArr = [null, null, null] as (PendingPiece | null)[];
        this.elementArr = this.makeEmptyElementBoard();
    }

    private makeEmptyElementBoard(): (ElementType | null)[][] {
        return Array.from({ length: 8 }, () => new Array(8).fill(null) as (ElementType | null)[]);
    }

    /** 重置收集状态（关卡开始时） */
    resetCollection(): void {
        this.elementArr = this.makeEmptyElementBoard();
        this.collected = {};
        this.collectionTargets = {};
        this.moves = 0;
    }

    /** 收集模式星级（基于步数效率） */
    calcCollectionStars(): number {
        let totalTarget = 0;
        for (const t of ELEMENT_TYPES) totalTarget += this.collectionTargets[t] ?? 0;
        if (totalTarget === 0) return 0;
        const m = this.moves;
        if (m <= Math.ceil(totalTarget * 0.6)) return 3;
        if (m <= totalTarget) return 2;
        return 1;
    }

    /** 当前是否处于收集模式 */
    isCollectionMode(): boolean {
        return ELEMENT_TYPES.some((t) => (this.collectionTargets[t] ?? 0) > 0);
    }

    /** 是否所有收集目标都达成 */
    isCollectionComplete(): boolean {
        return ELEMENT_TYPES.every((t) =>
            (this.collected[t] ?? 0) >= (this.collectionTargets[t] ?? 0));
    }

    /** 当前关活跃的元素类型列表（有目标的） */
    activeCollectionTypes(): ElementType[] {
        return ELEMENT_TYPES.filter((t) => (this.collectionTargets[t] ?? 0) > 0);
    }
    /** 当前局得分 */
    score = 0;
    /** 历史最高分（Classic 模式） */
    highScore = 0;
    /** 当前关卡编号（从 1 开始） */
    level = 1;
    /** 连击数（连续消除 +1，未消除清零） */
    combo = 0;
    /** 当前模式（transient） */
    mode: GameMode = 'classic';
    /** 当前关卡目标分（transient） */
    levelTarget = 0;
    /** 每关获得的星数 0..3 */
    levelStars: Record<number, number> = {};

    private makeEmptyBoard(): number[][] {
        return Array.from({ length: 8 }, () => new Array(8).fill(-1));
    }

    /** 重置到关卡开始状态 */
    resetForLevel(board?: BinaryBoard): void {
        this.saveArr = this.makeEmptyBoard();
        this.operaArr = [null, null, null];
        this.score = 0;
        this.combo = 0;
        this.refillPieces(board);
    }

    /** 加权随机选 shapeId（小块概率高） */
    private randomShapeId(): number {
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

    private randomColor(): ColorName {
        return COLOR_NAMES[Math.floor(Math.random() * COLOR_NAMES.length)];
    }

    /**
     * D5 构造 PendingPiece：在收集模式下，对每个填充格按 20% 概率塞入收集元素
     * （元素类型从当前活跃的 collectionTargets 中随机抽）。
     */
    buildPiece(id: number): PendingPiece {
        const piece: PendingPiece = { shapeId: id, color: this.randomColor() };
        if (!this.isCollectionMode()) return piece;
        // 仍需收集的类型（已达成的不再生成）
        const remainingTypes = ELEMENT_TYPES.filter((t) =>
            (this.collected[t] ?? 0) < (this.collectionTargets[t] ?? 0));
        if (remainingTypes.length === 0) return piece;
        const filledCount = BlockNumMap.get(id) ?? 0;
        if (filledCount === 0) return piece;
        const elements: (ElementType | null)[] = new Array(filledCount).fill(null);
        let hasAny = false;
        for (let i = 0; i < filledCount; i++) {
            if (Math.random() < 0.22) {
                elements[i] = remainingTypes[Math.floor(Math.random() * remainingTypes.length)];
                hasAny = true;
            }
        }
        if (hasAny) piece.elements = elements;
        return piece;
    }

    /** 加权随机方块 */
    private randomPiece(): PendingPiece {
        return this.buildPiece(this.randomShapeId());
    }

    /**
     * 当 operaArr 全空时补满 3 个。
     * - board=null：纯加权随机（兼容旧调用）
     * - score < DYNAMIC_ACTIVATION_SCORE（1000）：随机无死亡
     * - 分数 ≥ 1000 且 DynamicWeightDiff 已初始化：按 weightcfg.json tier + 8 算法调度
     * 兜底退到 3 个 1×1。
     */
    refillPieces(board?: BinaryBoard, score = 0): void {
        const allEmpty = this.operaArr.every((p) => p === null);
        if (!allEmpty) return;

        // 走动态调度（已 init 且有 board 时）
        const dyn = DynamicWeightDiff.instance;
        if (board && dyn.isInitialized()) {
            const { ids, algo } = dyn.offerTrio(board, score);
            this.operaArr = ids.map((id) => this.buildPiece(id));
            // 累积 dynamicWeight：每次 refill 算一次
            dyn.addWeight(algo);
            return;
        }

        // 旧行为：board 给但 dyn 未初始化 → 随机无死亡
        let chosen: PendingPiece[] | null = null;
        for (let attempt = 0; attempt < 50; attempt++) {
            const trio = [this.randomPiece(), this.randomPiece(), this.randomPiece()];
            if (!board) { chosen = trio; break; }
            if (board.checkPutAllBlocks(trio.map((p) => p.shapeId))) {
                chosen = trio;
                break;
            }
        }
        if (!chosen) {
            chosen = [
                { shapeId: 1, color: this.randomColor() },
                { shapeId: 1, color: this.randomColor() },
                { shapeId: 1, color: this.randomColor() },
            ];
        }
        this.operaArr = chosen;
    }

    /** 调试钩子：上次实际用了哪种算法 */
    getLastAlgorithm(): AlgorithmKind | null {
        return DynamicWeightDiff.instance.lastAlgo;
    }

    /** 首发 3 个固定形状（默认 [9,39,24]，可在 Config.firstHand 覆盖），颜色随机 */
    setFirstHand(): void {
        let ids = FIRST_HAND_SHAPE_IDS;
        try { ids = GameConfig.instance.firstHand(); } catch { /* ignore */ }
        this.operaArr = ids.map((id) => this.buildPiece(id));
    }

    /** 把指定槽位的方块放置到棋盘上（不做校验） */
    placePiece(slotIdx: number, board: BinaryBoard, posCol: number, posRow: number): void {
        const piece = this.operaArr[slotIdx];
        if (!piece) return;

        // 1) 更新二进制棋盘
        board.putBlock(piece.shapeId, { x: posCol, y: posRow });

        // 2) 更新 saveArr（带颜色）+ 元素 overlay
        const colorIdx = COLOR_NAMES.indexOf(piece.color);
        const shape = this.getShape(piece.shapeId);
        if (shape) {
            let cellIdx = 0;
            for (let r = 0; r < shape.height; r++) {
                for (let c = 0; c < shape.width; c++) {
                    const colBit = shape.shape[r] >> (shape.width - c - 1) & 1;
                    if (colBit) {
                        this.saveArr[posRow + r][posCol + c] = colorIdx;
                        // D5 转移候选方块上的元素到棋盘
                        const e = piece.elements?.[cellIdx];
                        if (e) this.elementArr[posRow + r][posCol + c] = e;
                        cellIdx++;
                    }
                }
            }
        }

        // 3) 清空槽位
        this.operaArr[slotIdx] = null;
    }

    /** 清除棋盘上指定的行/列（在 BinaryBoard.canClearRowCols 之后调用） */
    clearRowsAndCols(rows: number[], cols: number[]): number {
        let cleared = 0;
        for (const r of rows) {
            for (let c = 0; c < 8; c++) {
                if (this.saveArr[r][c] !== -1) { this.saveArr[r][c] = -1; cleared++; }
            }
        }
        for (const c of cols) {
            for (let r = 0; r < 8; r++) {
                if (this.saveArr[r][c] !== -1) { this.saveArr[r][c] = -1; cleared++; }
            }
        }
        return cleared;
    }

    /** 加分 */
    addScore(amount: number): void {
        this.score += amount;
        if (this.score > this.highScore) this.highScore = this.score;
    }

    private getShape(id: number) {
        return BlockShapeMap.get(id);
    }

    /** 存档到 localStorage */
    save(): void {
        const data: SaveData = {
            saveArr: this.saveArr,
            operaArr: this.operaArr,
            score: this.score,
            highScore: this.highScore,
            level: this.level,
            levelStars: this.levelStars,
        };
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
        catch { /* localStorage 可能不可用 */ }
    }

    /** 从 localStorage 读档，返回是否成功 */
    load(): boolean {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return false;
            const data = JSON.parse(raw) as SaveData;
            this.saveArr = data.saveArr ?? this.makeEmptyBoard();
            this.operaArr = data.operaArr ?? [null, null, null];
            this.score = data.score ?? 0;
            this.highScore = data.highScore ?? 0;
            this.level = data.level ?? 1;
            this.levelStars = data.levelStars ?? {};
            return true;
        } catch { return false; }
    }

    /** 根据得分 vs 目标算星：从 Config.stars.ratios 读三档倍率（默认 1.0/1.5/2.0） */
    calcStars(score: number, target: number): number {
        if (target <= 0 || score < target) return 0;
        const ratios = (() => {
            try { return GameConfig.instance.starRatios(); }
            catch { return [1.0, 1.5, 2.0] as [number, number, number]; }
        })();
        if (score >= target * ratios[2]) return 3;
        if (score >= target * ratios[1]) return 2;
        if (score >= target * ratios[0]) return 1;
        return 0;
    }

    /** 记录某关星数（只取更高的） */
    recordStars(level: number, stars: number): void {
        const prev = this.levelStars[level] ?? 0;
        if (stars > prev) this.levelStars[level] = stars;
    }

    /** 当前已解锁的最大关卡（已通关关 + 1，最低 1） */
    getMaxUnlockedLevel(): number {
        let max = 1;
        for (const key of Object.keys(this.levelStars)) {
            const n = Number(key);
            if ((this.levelStars[n] ?? 0) > 0) max = Math.max(max, n + 1);
        }
        return max;
    }

    // ─── H1 局内进度 session ──────────────────────────────────────
    /** session 存储 key（按 mode + level 分） */
    static sessionKey(mode: GameMode, level: number): string {
        return `bb_session_${mode}_${level}`;
    }

    /** 清掉指定 mode+level 的 session */
    static clearSession(mode: GameMode, level: number): void {
        try { localStorage.removeItem(GameState.sessionKey(mode, level)); } catch { /* ignore */ }
    }

    /** 清掉所有 session(用于 Config 面板 reset) */
    static clearAllSessions(): void {
        try {
            const keys: string[] = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.startsWith('bb_session_')) keys.push(k);
            }
            for (const k of keys) localStorage.removeItem(k);
        } catch { /* ignore */ }
    }
}
