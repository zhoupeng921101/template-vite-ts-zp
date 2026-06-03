// 优先级覆盖层 —— 对应原游戏 OfferUtilManager.offerBlocksBaseList
//
// 原版架构：每个 TriggerTiming（FirstRound / ByExpectation / AfterQuanZuhe 等）
// 维护一个按优先级 desc 排序的 override 列表；调度时依次问 checkIsCanWork，
// 第一个返回 true 的负责出 3 个块；否则 fall-through 回到 DynamicWeightDiff 的
// tier+odds 抽签路径。
//
// 复刻这里只实现框架 + 两条 FirstRound 覆盖，作为可扩展骨架；其他 TriggerTiming
// (Condition / BeforeBottom / AfterRevive 等) 暂时只占位。

import { BinaryBoard } from './BinaryBoard';
import { AlgorithmKind } from './algorithms/types';
import { generateTrioByAlgorithm } from './algorithms/Algorithms';

/** 原版 OfferTriggerTimingEnum 子集 —— 只列出复刻当前用到 / 计划用到的 */
export enum TriggerTiming {
    FirstRound = 0,        // 一局开始的首次 refill
    ByExpectation = 8,     // 根据"期望"重新出块（原版用于困难/直觉难题校正）
    AfterQuanZuhe = 11,    // 全组合填空后
    AfterRevive = 12,      // 复活后
    BeforeBottom = 9,      // 棋盘见底前
    EmptyBoard = 100,      // [复刻扩展] 棋盘清空后第一次 refill
}

/** 调度时的上下文 —— OfferBase.checkIsCanWork(ctx) 用 */
export interface OfferContext {
    trigger: TriggerTiming;
    board: BinaryBoard;
    score: number;
    /** 本局已发过几次 trio（首次 refill 时 = 0） */
    refillIndex: number;
    /** 上一次 offer 用的算法（如果有） */
    lastAlgo?: AlgorithmKind | null;
}

/** 一条优先级覆盖 —— 对应原版 OfferBase 子类 */
export interface OfferOverride {
    /** 调试名，用于日志/HUD */
    name: string;
    /** 注册到哪个时机 */
    trigger: TriggerTiming;
    /** 同一 trigger 桶内的优先级（高优先级先问），对应 OfferPriority*Enum 数值 */
    priority: number;
    /** 是否能接管这次 offer */
    checkIsCanWork(ctx: OfferContext): boolean;
    /** 接管后产出 3 个 shapeId；返回 null 表示"我撤了，让下一个 override 或 base 路径来" */
    offerNewBlocks(ctx: OfferContext): number[] | null;
}

/**
 * 全局注册表，单例。register 后会按 priority desc 排序。
 * dispatch(timing, ctx) 返回首个能干活的 override 的输出，没有就返回 null。
 */
export class OfferRegistry {
    private static _ins: OfferRegistry;
    static get instance(): OfferRegistry {
        if (!this._ins) this._ins = new OfferRegistry();
        return this._ins;
    }

    private buckets = new Map<TriggerTiming, OfferOverride[]>();
    /** 上一次 dispatch 命中的 override 名（调试用） */
    lastHitName: string | null = null;

    register(ov: OfferOverride): void {
        const list = this.buckets.get(ov.trigger) ?? [];
        list.push(ov);
        list.sort((a, b) => b.priority - a.priority);
        this.buckets.set(ov.trigger, list);
    }

    /** 主调度：按时机找 override 桶，按优先级问，第一个返回非 null 的胜出 */
    dispatch(timing: TriggerTiming, ctx: OfferContext): { ids: number[]; name: string } | null {
        const list = this.buckets.get(timing);
        if (!list || list.length === 0) return null;
        for (const ov of list) {
            if (!ov.checkIsCanWork(ctx)) continue;
            const ids = ov.offerNewBlocks(ctx);
            if (ids && ids.length === 3) {
                this.lastHitName = ov.name;
                return { ids, name: ov.name };
            }
        }
        return null;
    }

    /** 测试/重启时清空注册 */
    clear(): void { this.buckets.clear(); this.lastHitName = null; }

    /** 查 bucket 长度（调试用） */
    sizeOf(timing: TriggerTiming): number {
        return this.buckets.get(timing)?.length ?? 0;
    }
}

// ─────────────────────────────────────────────────────────────────────────
// 默认 override 集合 —— 对应原版 FirstRound_PromoteCombo / RandomRunEmpty
// ─────────────────────────────────────────────────────────────────────────

/**
 * FirstRound_PromoteCombo（原版 OfferPriorityFirstRoundEnum=2）
 * 一局的第一次 refill 直接走 FILL 算法，确保玩家开局就能消除，建立"会消行"的预期。
 */
export const firstRoundPromoteCombo: OfferOverride = {
    name: 'FirstRound_PromoteCombo',
    trigger: TriggerTiming.FirstRound,
    priority: 2,
    checkIsCanWork: (ctx) => ctx.refillIndex === 0,
    offerNewBlocks: (ctx) => generateTrioByAlgorithm(AlgorithmKind.FILL, ctx.board),
};

/**
 * RandomRunEmpty（原版 OfferPriorityFirstRoundEnum=3）
 * 当棋盘是空的时（如刚清盘）出纯随机无死局，避免连续输出"死亡难题"——
 * 空棋盘上死亡难题没有意义，玩家会觉得被欺负。
 */
export const emptyBoardRandomRun: OfferOverride = {
    name: 'RandomRunEmpty',
    trigger: TriggerTiming.EmptyBoard,
    priority: 3,
    checkIsCanWork: (ctx) => isBoardEmpty(ctx.board),
    offerNewBlocks: (ctx) => generateTrioByAlgorithm(AlgorithmKind.RANDOM_NO_DIE, ctx.board),
};

function isBoardEmpty(board: BinaryBoard): boolean {
    for (const r of board.rowBinary) if (r !== 0) return false;
    return true;
}

/** 默认注册（在 DynamicWeightDiff.init 时调用一次） */
export function registerDefaultOverrides(): void {
    const reg = OfferRegistry.instance;
    reg.clear();
    reg.register(firstRoundPromoteCombo);
    reg.register(emptyBoardRandomRun);
}
