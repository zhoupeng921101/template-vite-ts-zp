// 主分发器：按 weightcfg.json 选 tier，按 tier 内 odds 抽算法，调用算法生成 trio
// 模仿原游戏 main_bundle.js 中的 DynamicWeightDiff 类
import { BinaryBoard } from './BinaryBoard';
import { generateTrioByAlgorithm, generateTrioByAlgorithmAsync } from './algorithms/Algorithms';
import {
    AlgorithmKind, ALGORITHM_NAME,
    WeightConfigEntry, ODDS_FIELDS,
    DEFAULT_WEIGHT_FACTORS, DYNAMIC_ACTIVATION_SCORE,
} from './algorithms/types';
import { GameConfig } from './GameConfig';
import {
    OfferRegistry, TriggerTiming, OfferContext,
    registerDefaultOverrides,
} from './OfferOverrides';

const STORAGE_KEY = 'block_blast_dynamic_v1';

interface DynPersist {
    dynamicWeight: number;
    preDynamicWeight: number;
}

export class DynamicWeightDiff {
    private static _instance: DynamicWeightDiff;
    static get instance(): DynamicWeightDiff {
        if (!this._instance) this._instance = new DynamicWeightDiff();
        return this._instance;
    }

    private weightConfig: WeightConfigEntry[] = [];
    private initialized = false;
    private dynamicWeight = 0;
    private preDynamicWeight = 0;
    /** 最近一次调度日志（调试/UI 用） */
    lastAlgo: AlgorithmKind | null = null;
    lastTierId: number | null = null;
    /** E1 强制算法（HUD 调试用，非 null 时所有 refill 都用这个算法） */
    forceAlgorithm: AlgorithmKind | null = null;

    /** 本局已发过几次 trio（用于 FirstRound 触发判断） */
    private refillIndex = 0;

    /** 用 weightcfg.json 初始化 */
    init(cfg: WeightConfigEntry[]): void {
        this.weightConfig = cfg || [];
        this.initialized = true;
        this.load();
        registerDefaultOverrides();
    }

    /** 一局新开始时调用，清零 refillIndex（用于 FirstRound 时机） */
    beginGame(): void {
        this.refillIndex = 0;
    }

    isInitialized(): boolean { return this.initialized; }

    /**
     * 选当前 tier：dynamicWeight 落在 FactorRange 内 AND 当前分数落在 HighScoreRange 内
     * 找不到精确 tier 时退化到"最接近"的；分数低于激活门槛返回 null
     */
    private getCurrentTier(score: number): WeightConfigEntry | null {
        if (this.weightConfig.length === 0) return null;
        const dw = this.dynamicWeight;
        const matches = this.weightConfig.filter((t) => {
            const fLow = Math.min(t.FactorRange[0], t.FactorRange[1]);
            const fHigh = Math.max(t.FactorRange[0], t.FactorRange[1]);
            if (dw < fLow || dw > fHigh) return false;
            if (score < t.HighScoreRange[0]) return false;
            if (t.HighScoreRange[1] >= 0 && score > t.HighScoreRange[1]) return false;
            return true;
        });
        if (matches.length > 0) return matches[0];

        // 没匹配：取 dynamicWeight 最接近的 tier（同时分数也要满足）
        const scoreOk = this.weightConfig.filter((t) =>
            score >= t.HighScoreRange[0]
            && (t.HighScoreRange[1] < 0 || score <= t.HighScoreRange[1]));
        const pool = scoreOk.length > 0 ? scoreOk : this.weightConfig;
        let best = pool[0];
        let bestDist = Infinity;
        for (const t of pool) {
            const mid = (t.FactorRange[0] + t.FactorRange[1]) / 2;
            const d = Math.abs(mid - dw);
            if (d < bestDist) { bestDist = d; best = t; }
        }
        return best;
    }

    /** 在指定 tier 内按 8 个 odds 加权抽算法 */
    private pickAlgorithmFromTier(tier: WeightConfigEntry): AlgorithmKind {
        const odds = ODDS_FIELDS.map((f) => tier[f] as number);
        const total = odds.reduce((a, b) => a + b, 0);
        if (total <= 0) return AlgorithmKind.RANDOM_NO_DIE;
        let r = Math.random() * total;
        for (let i = 0; i < odds.length; i++) {
            if (odds[i] > 0 && r < odds[i]) return i as AlgorithmKind;
            r -= odds[i];
        }
        return AlgorithmKind.RANDOM_NO_DIE;
    }

    /**
     * 主入口：给定棋盘 + 当前分数，返回 (3 个 shapeId, 实际用的算法)
     * 未激活（score < 1000）或未初始化 → 直接 RANDOM_NO_DIE
     */
    offerTrio(board: BinaryBoard, score: number): { ids: number[]; algo: AlgorithmKind; tierId: number | null } {
        // E1 强制算法优先（HUD 调试通道，跳过所有其他层）
        if (this.forceAlgorithm != null) {
            const algo = this.forceAlgorithm;
            this.lastAlgo = algo;
            this.lastTierId = -1;
            const ids = generateTrioByAlgorithm(algo, board);
            this.refillIndex++;
            return { ids, algo, tierId: -1 };
        }

        // 优先级覆盖层：在 tier+odds 抽签前，先问注册到 FirstRound / EmptyBoard 的 override
        const ctx: OfferContext = {
            trigger: this.refillIndex === 0 ? TriggerTiming.FirstRound : TriggerTiming.EmptyBoard,
            board, score,
            refillIndex: this.refillIndex,
            lastAlgo: this.lastAlgo,
        };
        const reg = OfferRegistry.instance;
        const overrideHit = reg.dispatch(ctx.trigger, ctx);
        if (overrideHit) {
            // override 不属于动态调度算法，记一个伪 algo 让 addWeight 用中性反馈
            const algo = AlgorithmKind.RANDOM_NO_DIE;
            this.lastAlgo = algo;
            this.lastTierId = -2;            // -2 表示"被 override 覆盖"
            this.refillIndex++;
            return { ids: overrideHit.ids, algo, tierId: -2 };
        }

        const activation = this.tryGetConfigActivation() ?? DYNAMIC_ACTIVATION_SCORE;
        if (!this.initialized || score < activation) {
            const algo = AlgorithmKind.RANDOM_NO_DIE;
            this.lastAlgo = algo;
            this.lastTierId = null;
            const ids = generateTrioByAlgorithm(algo, board);
            this.refillIndex++;
            return { ids, algo, tierId: null };
        }
        const tier = this.getCurrentTier(score);
        if (!tier) {
            const algo = AlgorithmKind.RANDOM_NO_DIE;
            this.lastAlgo = algo;
            this.lastTierId = null;
            const ids = generateTrioByAlgorithm(algo, board);
            this.refillIndex++;
            return { ids, algo, tierId: null };
        }
        const algo = this.pickAlgorithmFromTier(tier);
        const ids = generateTrioByAlgorithm(algo, board);
        this.lastAlgo = algo;
        this.lastTierId = tier.id;
        this.refillIndex++;
        return { ids, algo, tierId: tier.id };
    }

    /**
     * 异步主入口：与 offerTrio 同语义，但 FILL/ADD3/STRAIGHT_DEATH_DIFF
     * 算法走 ONNX 神经网络（约 50ms × 3 ≈ 150ms 一次 refill）。
     * 模型未就绪时和 sync 路径一致 fallback。
     */
    async offerTrioAsync(board: BinaryBoard, score: number): Promise<{ ids: number[]; algo: AlgorithmKind; tierId: number | null }> {
        if (this.forceAlgorithm != null) {
            const algo = this.forceAlgorithm;
            this.lastAlgo = algo;
            this.lastTierId = -1;
            const ids = await generateTrioByAlgorithmAsync(algo, board);
            this.refillIndex++;
            return { ids, algo, tierId: -1 };
        }
        const ctx: OfferContext = {
            trigger: this.refillIndex === 0 ? TriggerTiming.FirstRound : TriggerTiming.EmptyBoard,
            board, score,
            refillIndex: this.refillIndex,
            lastAlgo: this.lastAlgo,
        };
        const reg = OfferRegistry.instance;
        const overrideHit = reg.dispatch(ctx.trigger, ctx);
        if (overrideHit) {
            const algo = AlgorithmKind.RANDOM_NO_DIE;
            this.lastAlgo = algo;
            this.lastTierId = -2;
            this.refillIndex++;
            return { ids: overrideHit.ids, algo, tierId: -2 };
        }
        const activation = this.tryGetConfigActivation() ?? DYNAMIC_ACTIVATION_SCORE;
        if (!this.initialized || score < activation) {
            const algo = AlgorithmKind.RANDOM_NO_DIE;
            this.lastAlgo = algo;
            this.lastTierId = null;
            const ids = await generateTrioByAlgorithmAsync(algo, board);
            this.refillIndex++;
            return { ids, algo, tierId: null };
        }
        const tier = this.getCurrentTier(score);
        if (!tier) {
            const algo = AlgorithmKind.RANDOM_NO_DIE;
            this.lastAlgo = algo;
            this.lastTierId = null;
            const ids = await generateTrioByAlgorithmAsync(algo, board);
            this.refillIndex++;
            return { ids, algo, tierId: null };
        }
        const algo = this.pickAlgorithmFromTier(tier);
        const ids = await generateTrioByAlgorithmAsync(algo, board);
        this.lastAlgo = algo;
        this.lastTierId = tier.id;
        this.refillIndex++;
        return { ids, algo, tierId: tier.id };
    }

    /**
     * 调用时机：每次发完 trio 后（或本局结束后）调用，根据本次算法的 BasicFactor/ConsecutiveFactor
     * 增量调整 dynamicWeight。同向连续走 ConsecutiveFactor，换向用 BasicFactor。
     * 模仿原游戏的 addWeight。
     */
    addWeight(algo: AlgorithmKind): void {
        const f = this.tryGetConfigFactor(algo) ?? DEFAULT_WEIGHT_FACTORS[algo];
        if (!f) return;
        // preDynamicWeight * BasicFactor > 0 → 同向连续 → 用 ConsecutiveFactor
        const sameDirection = this.preDynamicWeight * f.basic > 0;
        const delta = sameDirection ? f.consecutive : f.basic;
        this.preDynamicWeight = delta;
        this.dynamicWeight += delta;
        // 截断到 weightcfg 实际覆盖的 FactorRange 范围
        let min = -9999, max = 9999;
        for (const t of this.weightConfig) {
            min = Math.min(min, t.FactorRange[0], t.FactorRange[1]);
            max = Math.max(max, t.FactorRange[0], t.FactorRange[1]);
        }
        if (this.dynamicWeight < min) this.dynamicWeight = min;
        if (this.dynamicWeight > max) this.dynamicWeight = max;
        this.save();
    }

    /** 重置（如玩家点"新游戏"） */
    reset(): void {
        this.dynamicWeight = 0;
        this.preDynamicWeight = 0;
        this.refillIndex = 0;
        this.save();
    }

    save(): void {
        try {
            const data: DynPersist = {
                dynamicWeight: this.dynamicWeight,
                preDynamicWeight: this.preDynamicWeight,
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch { /* ignore */ }
    }

    load(): void {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const d = JSON.parse(raw) as DynPersist;
            this.dynamicWeight = d.dynamicWeight ?? 0;
            this.preDynamicWeight = d.preDynamicWeight ?? 0;
        } catch { /* ignore */ }
    }

    // 调试/读取
    getDynamicWeight(): number { return this.dynamicWeight; }
    getLastAlgorithmName(): string {
        return this.lastAlgo == null ? '(none)' : ALGORITHM_NAME[this.lastAlgo];
    }

    // ─── Config 读取 ─────────────────────
    private tryGetConfigActivation(): number | null {
        try { return GameConfig.instance.activationScore(); } catch { return null; }
    }
    private tryGetConfigFactor(algo: AlgorithmKind) {
        try { return GameConfig.instance.factorFor(ALGORITHM_NAME[algo]); } catch { return null; }
    }
}
