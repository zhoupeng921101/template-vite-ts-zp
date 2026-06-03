// 全局可调配置：从 gameconfig.json 加载，运行时可修改并触发监听
// 所有可调参数都集中到这里，UI 编辑面板也读写这里

const STORAGE_KEY = 'block_blast_config_override_v1';

export interface FactorEntry { basic: number; consecutive: number; }

export interface ConfigSchema {
    dynamic: {
        activationScore: number;
        factorList: Record<string, FactorEntry>;
        algorithmSamples: Record<string, number>;
    };
    firstHand: number[];
    stars: { ratios: [number, number, number] };
    audio: { sfxVolume: number; bgmVolume: number };
}

type ChangeListener = (cfg: ConfigSchema) => void;

export class GameConfig {
    private static _instance: GameConfig;
    static get instance(): GameConfig {
        if (!this._instance) this._instance = new GameConfig();
        return this._instance;
    }

    private current: ConfigSchema = GameConfig.makeDefault();
    private initial: ConfigSchema = GameConfig.makeDefault();
    private listeners: ChangeListener[] = [];
    private initialized = false;

    private static makeDefault(): ConfigSchema {
        return {
            dynamic: {
                activationScore: 1000,
                factorList: {
                    FILL:                { basic: -10, consecutive: -20 },
                    RANDOM_NO_DIE:       { basic:  -5, consecutive: -10 },
                    ADD3:                { basic:   5, consecutive:  10 },
                    EASY_DIFF:           { basic:   5, consecutive:  10 },
                    DIFF:                { basic:  10, consecutive:  20 },
                    STRAIGHT_DEATH_DIFF: { basic:  20, consecutive:  40 },
                    CLEAR_ALL:           { basic: -20, consecutive: -40 },
                    ALL_COMBINATION:     { basic: -10, consecutive: -20 },
                },
                algorithmSamples: {
                    FILL: 80, RANDOM_NO_DIE: 50, ADD3: 60,
                    EASY_DIFF: 80, DIFF: 160, STRAIGHT_DEATH_DIFF: 320,
                    CLEAR_ALL: 120, ALL_COMBINATION: 150,
                },
            },
            firstHand: [9, 39, 24],
            stars: { ratios: [1.0, 1.5, 2.0] },
            audio: { sfxVolume: 0.5, bgmVolume: 0.3 },
        };
    }

    isInitialized(): boolean { return this.initialized; }

    /** 初始化：从 Preloader 拿到的 JSON 灌入 */
    init(json: ConfigSchema): void {
        this.initial = GameConfig.deepClone(json);
        // 读 localStorage 覆盖（如果用户调过）
        let runtime = GameConfig.deepClone(json);
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const overrides = JSON.parse(raw) as Partial<ConfigSchema>;
                runtime = GameConfig.deepMerge(runtime as unknown as Record<string, unknown>, overrides as Record<string, unknown>) as unknown as ConfigSchema;
            }
        } catch { /* ignore */ }
        this.current = runtime;
        this.initialized = true;
    }

    /** 拿原始/默认配置（用于"Reset to defaults"按钮） */
    getDefaults(): ConfigSchema { return GameConfig.deepClone(this.initial); }

    /** 拿当前生效配置（编辑器面板会读写这个） */
    get(): ConfigSchema { return this.current; }

    /** 修改并通知监听者，自动持久化到 localStorage */
    set(patch: Partial<ConfigSchema>): void {
        this.current = GameConfig.deepMerge(
            this.current as unknown as Record<string, unknown>,
            patch as Record<string, unknown>,
        ) as unknown as ConfigSchema;
        this.persist();
        for (const l of this.listeners) l(this.current);
    }

    /** 重置回 JSON 默认值 */
    reset(): void {
        this.current = GameConfig.deepClone(this.initial);
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
        for (const l of this.listeners) l(this.current);
    }

    /** 导出当前配置为 JSON 字符串 */
    export(): string { return JSON.stringify(this.current, null, 2); }

    /** 监听配置变化 */
    onChange(fn: ChangeListener): () => void {
        this.listeners.push(fn);
        return () => { this.listeners = this.listeners.filter((l) => l !== fn); };
    }

    private persist(): void {
        try {
            // 只存与 initial 不同的字段（简化为整存）
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.current));
        } catch { /* ignore */ }
    }

    // ─── 便利访问器 ────────────────────────────────────────────────────
    activationScore(): number { return this.current.dynamic.activationScore; }
    factorFor(algoName: string): FactorEntry {
        return this.current.dynamic.factorList[algoName]
            ?? { basic: 0, consecutive: 0 };
    }
    samplesFor(algoName: string): number {
        return this.current.dynamic.algorithmSamples[algoName] ?? 50;
    }
    firstHand(): number[] { return [...this.current.firstHand]; }
    starRatios(): [number, number, number] {
        const r = this.current.stars.ratios;
        return [r[0], r[1], r[2]];
    }
    sfxVolume(): number { return this.current.audio.sfxVolume; }
    bgmVolume(): number { return this.current.audio.bgmVolume; }

    // ─── 工具 ─────────────────────────────────────────────────────────
    private static deepClone<T>(o: T): T { return JSON.parse(JSON.stringify(o)); }
    private static deepMerge<T extends Record<string, unknown>>(a: T, b: Partial<T>): T {
        const out: any = { ...a };
        for (const k of Object.keys(b)) {
            const av = (a as any)[k];
            const bv = (b as any)[k];
            if (av && typeof av === 'object' && !Array.isArray(av)
                && bv && typeof bv === 'object' && !Array.isArray(bv)) {
                out[k] = GameConfig.deepMerge(av, bv);
            } else {
                out[k] = bv;
            }
        }
        return out as T;
    }
}
