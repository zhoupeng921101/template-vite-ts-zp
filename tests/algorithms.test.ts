// 单元测试：8 种动态权重算法 + DynamicWeightDiff 调度器
import { BinaryBoard } from '../src/game/core/BinaryBoard';
import { BoardEvaluator } from '../src/game/core/algorithms/BoardEvaluator';
import { generateTrioByAlgorithm } from '../src/game/core/algorithms/Algorithms';
import { AlgorithmKind } from '../src/game/core/algorithms/types';
import { DynamicWeightDiff } from '../src/game/core/DynamicWeightDiff';

// localStorage polyfill
(globalThis as any).localStorage = {
    _d: {} as Record<string, string>,
    getItem(k: string) { return this._d[k] ?? null; },
    setItem(k: string, v: string) { this._d[k] = v; },
    removeItem(k: string) { delete this._d[k]; },
};

let passed = 0, failed = 0;
function assert(cond: boolean, name: string, extra = '') {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.log(`  ✗ ${name}  ${extra}`); }
}

// 构造测试棋盘工具
function emptyBoard(): BinaryBoard { return new BinaryBoard(); }
function boardFromRows(rows: number[]): BinaryBoard {
    const b = new BinaryBoard();
    b.rowBinary = [...rows];
    return b;
}

console.log('\n== 1. BoardEvaluator 基础 ==');
{
    const b = emptyBoard();
    // 空棋盘 + [1,1,1] 应有大量解
    const c = BoardEvaluator.countSolutions(b, [1, 1, 1], 100);
    assert(c >= 50, `空棋盘 [1,1,1] 解数 ≥50 (实际 ${c})`);

    // 熵：空棋盘熵=0
    assert(BoardEvaluator.entropy(b.rowBinary) === 0, '空棋盘熵=0');

    // 单格放 (0,0)
    b.putBlock(1, { x: 0, y: 0 });
    const e1 = BoardEvaluator.entropy(b.rowBinary);
    assert(e1 === 2, `单格放置熵=2 (实际 ${e1})`);

    // 模拟：放 5x1 + 3x1 填满第 0 行 → cleared=8
    const b2 = emptyBoard();
    const sim = BoardEvaluator.simulate(b2, [
        { id: 11, pos: { x: 0, y: 0 } }, // 5x1
        { id: 5,  pos: { x: 5, y: 0 } }, // 3x1
    ]);
    assert(sim.cleared === 8, `第 0 行消除 8 格 (实际 ${sim.cleared})`);
    assert(sim.clearedAll, '消除后棋盘清空');
}

console.log('\n== 2. RANDOM_NO_DIE：保证 trio 有解 ==');
{
    let allOk = true;
    for (let i = 0; i < 30; i++) {
        const b = emptyBoard();
        // 填到只剩底行
        for (let r = 0; r < 7; r++) b.rowBinary[r] = 0xff;
        const t = generateTrioByAlgorithm(AlgorithmKind.RANDOM_NO_DIE, b);
        if (!b.canPutAnyOf(t)) { allOk = false; break; }
    }
    assert(allOk, '近满棋盘 30 次 RANDOM_NO_DIE 全部至少有 1 块能放');
}

console.log('\n== 3. FILL：trio 应能触发消除 ==');
{
    // 棋盘第 7 行除最右 1 格全满 → 任何 1x1 放 (7,7) 都能清一行
    let hits = 0;
    for (let i = 0; i < 10; i++) {
        const b = boardFromRows([0, 0, 0, 0, 0, 0, 0, 0xfe]); // 第 7 行 7 格占用
        const t = generateTrioByAlgorithm(AlgorithmKind.FILL, b);
        const best = BoardEvaluator.findBest(b, t, (_r, c) => c, 30);
        if (best && best.cleared > 0) hits++;
    }
    assert(hits >= 8, `FILL 10 次至少 8 次触发消除 (实际 ${hits})`);
}

console.log('\n== 4. CLEAR_ALL：返回可玩 trio + 倾向消除 ==');
{
    // 棋盘有一些填充，比较 CLEAR_ALL 与 RANDOM_NO_DIE 的消除偏好
    const rows = [0, 0, 0, 0, 0, 0xff, 0xff, 0xfe]; // 后 3 行接近满
    let cleared = 0, total = 0;
    for (let i = 0; i < 10; i++) {
        const b = boardFromRows([...rows]);
        const t = generateTrioByAlgorithm(AlgorithmKind.CLEAR_ALL, b);
        if (!b.canPutAnyOf(t)) continue;
        total++;
        const best = BoardEvaluator.findBest(b, t, (_r, c) => c, 24);
        if (best && best.cleared > 0) cleared++;
    }
    assert(total === 10, `10 次都返回可放置 trio (实际 ${total})`);
    // CLEAR_ALL 找不到清盘解时退化到 fillTrio，倾向消除
    assert(cleared >= 6, `CLEAR_ALL 10 次中 ≥6 次能触发消除 (实际 ${cleared})`);
}

console.log('\n== 5. STRAIGHT_DEATH_DIFF vs EASY_DIFF：解数差异 ==');
{
    // 用一个适度填充的棋盘
    const rows = [0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0]; // 上半满，下半空
    let deathSols = 0, easySols = 0;
    for (let i = 0; i < 10; i++) {
        const b1 = boardFromRows([...rows]);
        const t1 = generateTrioByAlgorithm(AlgorithmKind.STRAIGHT_DEATH_DIFF, b1);
        deathSols += BoardEvaluator.countSolutions(b1, t1, 20);
        const b2 = boardFromRows([...rows]);
        const t2 = generateTrioByAlgorithm(AlgorithmKind.EASY_DIFF, b2);
        easySols += BoardEvaluator.countSolutions(b2, t2, 50);
    }
    assert(deathSols < easySols, `DEATH 解数 (${deathSols}) < EASY 解数 (${easySols})`);
    // 改造后 DEATH 应有显著更低的解数（难块倾向采样 + 历史最优追踪）
    assert(deathSols * 2 <= easySols, `DEATH 显著低于 EASY (DEATH*2=${deathSols*2} ≤ EASY=${easySols})`);
}

console.log('\n== 6. EASY_DIFF：解数应多 ==');
{
    let highSol = 0;
    for (let i = 0; i < 15; i++) {
        const b = emptyBoard();
        const t = generateTrioByAlgorithm(AlgorithmKind.EASY_DIFF, b);
        const c = BoardEvaluator.countSolutions(b, t, 50);
        if (c >= 5) highSol++;
    }
    assert(highSol >= 10, `EASY_DIFF 15 次中 ≥10 次解数 ≥5 (实际 ${highSol})`);
}

console.log('\n== 7. ADD3 vs RANDOM_NO_DIE：熵增应更高 ==');
{
    let add3Sum = 0, rndSum = 0;
    for (let i = 0; i < 10; i++) {
        const b1 = boardFromRows([0x80, 0x80, 0x80, 0x80, 0, 0, 0, 0]);
        const t1 = generateTrioByAlgorithm(AlgorithmKind.ADD3, b1);
        const r1 = BoardEvaluator.findBest(b1, t1, (rows) => BoardEvaluator.entropy(rows), 16);
        if (r1) add3Sum += r1.score;
        const b2 = boardFromRows([0x80, 0x80, 0x80, 0x80, 0, 0, 0, 0]);
        const t2 = generateTrioByAlgorithm(AlgorithmKind.RANDOM_NO_DIE, b2);
        const r2 = BoardEvaluator.findBest(b2, t2, (rows) => BoardEvaluator.entropy(rows), 16);
        if (r2) rndSum += r2.score;
    }
    assert(add3Sum > rndSum, `ADD3 熵平均 (${add3Sum}) > RANDOM (${rndSum})`);
}

console.log('\n== 8. DynamicWeightDiff：低分走 RANDOM_NO_DIE ==');
{
    const { OfferRegistry } = require('../src/game/core/OfferOverrides');
    const dyn = DynamicWeightDiff.instance;
    dyn.init([
        { id: 1, FillBlankOdds: 100, RandomOdds: 0, EntropyOdds: 0, EasyOdds: 0,
          HardOdds: 100, IntuitionOdds: 0, Clearboard: 0, Allunite: 0,
          HighScoreRange: [1000, -1], FactorRange: [-9999, 9999] },
    ]);
    dyn.reset();
    OfferRegistry.instance.clear(); // 关掉 override，测纯 base 路径
    const b = emptyBoard();
    const r = dyn.offerTrio(b, 500); // 低于 1000 阈值
    assert(r.algo === AlgorithmKind.RANDOM_NO_DIE, `score<1000 用 RANDOM_NO_DIE (实际 ${r.algo})`);
    assert(r.tierId === null, 'tier 应为 null（未激活）');
}

console.log('\n== 9. DynamicWeightDiff：高分使用 tier 调度 ==');
{
    const { OfferRegistry } = require('../src/game/core/OfferOverrides');
    const dyn = DynamicWeightDiff.instance;
    dyn.init([
        // 只有 FILL 概率非零，必选 FILL
        { id: 1, FillBlankOdds: 100, RandomOdds: 0, EntropyOdds: 0, EasyOdds: 0,
          HardOdds: 0, IntuitionOdds: 0, Clearboard: 0, Allunite: 0,
          HighScoreRange: [1000, -1], FactorRange: [-9999, 9999] },
    ]);
    dyn.reset();
    OfferRegistry.instance.clear(); // 关掉 override，测纯 base 路径
    const b = boardFromRows([0, 0, 0, 0, 0, 0, 0, 0xfe]); // 第 7 行 7 格 → FILL 应该有戏
    const r = dyn.offerTrio(b, 5000);
    assert(r.algo === AlgorithmKind.FILL, `score>=1000 + tier 抽样 → FILL (实际 ${r.algo})`);
    assert(r.tierId === 1, 'tier id = 1');
}

console.log('\n== 10. addWeight：正向算法推 dynamicWeight 上升 ==');
{
    const dyn = DynamicWeightDiff.instance;
    dyn.init([
        { id: 1, FillBlankOdds: 100, RandomOdds: 0, EntropyOdds: 0, EasyOdds: 0,
          HardOdds: 0, IntuitionOdds: 0, Clearboard: 0, Allunite: 0,
          HighScoreRange: [1000, -1], FactorRange: [-9999, 9999] },
    ]);
    dyn.reset();
    const before = dyn.getDynamicWeight();
    // 真实 weightList: CLEAR_ALL = [-20, -40]
    dyn.addWeight(AlgorithmKind.CLEAR_ALL);   // 首次：basic = -20
    dyn.addWeight(AlgorithmKind.CLEAR_ALL);   // 同向：consecutive = -40
    const after = dyn.getDynamicWeight();
    assert(after - before === -60, `2 次 CLEAR_ALL 累计 -60 (实际 ${after - before})`);

    // DIFF = [+10, +20]，与 preDynamicWeight=-40 反号 → 用 basic=+10
    dyn.addWeight(AlgorithmKind.DIFF);
    const afterDiff = dyn.getDynamicWeight();
    assert(afterDiff - after === 10, `换向 DIFF basic +10 (实际 ${afterDiff - after})`);
}

console.log('\n== 11. 持久化 ==');
{
    const dyn = DynamicWeightDiff.instance;
    dyn.init([
        { id: 1, FillBlankOdds: 0, RandomOdds: 100, EntropyOdds: 0, EasyOdds: 0,
          HardOdds: 0, IntuitionOdds: 0, Clearboard: 0, Allunite: 0,
          HighScoreRange: [1000, -1], FactorRange: [-9999, 9999] },
    ]);
    dyn.reset();
    dyn.addWeight(AlgorithmKind.FILL);
    const w = dyn.getDynamicWeight();
    // 直接看 localStorage
    const raw = (globalThis as any).localStorage.getItem('block_blast_dynamic_v1');
    assert(raw !== null, 'localStorage 已写入');
    const parsed = JSON.parse(raw!);
    assert(parsed.dynamicWeight === w, `持久化值 (${parsed.dynamicWeight}) == 内存值 (${w})`);
}

console.log('\n== 12. E1 forceAlgorithm 覆盖 tier ==');
{
    const { OfferRegistry } = require('../src/game/core/OfferOverrides');
    const dyn = DynamicWeightDiff.instance;
    dyn.init([
        { id: 1, FillBlankOdds: 100, RandomOdds: 0, EntropyOdds: 0, EasyOdds: 0,
          HardOdds: 0, IntuitionOdds: 0, Clearboard: 0, Allunite: 0,
          HighScoreRange: [1000, -1], FactorRange: [-9999, 9999] },
    ]);
    dyn.reset();
    OfferRegistry.instance.clear(); // 关掉 override 隔离 base 路径
    dyn.forceAlgorithm = AlgorithmKind.STRAIGHT_DEATH_DIFF;
    const r = dyn.offerTrio(emptyBoard(), 5000);
    assert(r.algo === AlgorithmKind.STRAIGHT_DEATH_DIFF, `forceAlgorithm 覆盖 tier (实际 ${r.algo})`);
    assert(r.tierId === -1, `tierId 标记 -1 (FORCED)`);

    // 即使分数远低于激活门槛，强制依然有效
    const r2 = dyn.offerTrio(emptyBoard(), 100);
    assert(r2.algo === AlgorithmKind.STRAIGHT_DEATH_DIFF, `score<1000 时 force 也生效`);

    dyn.forceAlgorithm = null;
    const r3 = dyn.offerTrio(emptyBoard(), 5000);
    assert(r3.algo === AlgorithmKind.FILL, `清 force 后 tier 抽样恢复`);
}

console.log('\n== 13a. bit-aware FILL：近完成行应被高效填满 ==');
{
    // 棋盘：每行都缺最右边 1 格 → bit-aware 应该挑 1×1 / 1×n 之类塞进去
    const rows = [0xfe, 0xfe, 0xfe, 0xfe, 0xfe, 0, 0, 0]; // 5 行各缺 1 格
    let cleared3orMore = 0;
    for (let i = 0; i < 12; i++) {
        const b = boardFromRows([...rows]);
        const t = generateTrioByAlgorithm(AlgorithmKind.FILL, b);
        const sim = BoardEvaluator.findBest(b, t, (_r, c) => c, 24);
        if (sim && sim.cleared >= 24) cleared3orMore++; // 24 格 = 3 整行
    }
    assert(cleared3orMore >= 8,
        `bit-aware FILL 12 次中 ≥8 次能清 ≥3 行 (实际 ${cleared3orMore})`);
}

console.log('\n== 13b. bit-aware DIFF：vs RANDOM_NO_DIE 在受限棋盘上 ==');
{
    // 高度受限棋盘：6 行已满，只剩底 2 行 + 上半角落零碎洞
    // 最大空矩形 = 2×8，bit-aware 应该挑大块（5×1、4×1、3×2 实心）锁定
    const rows = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x80, 0x80];
    let diffTotal = 0, randomTotal = 0;
    for (let i = 0; i < 10; i++) {
        const b1 = boardFromRows([...rows]);
        const tDiff = generateTrioByAlgorithm(AlgorithmKind.DIFF, b1);
        diffTotal += BoardEvaluator.countSolutions(b1, tDiff, 50);
        const b2 = boardFromRows([...rows]);
        const tRnd = generateTrioByAlgorithm(AlgorithmKind.RANDOM_NO_DIE, b2);
        randomTotal += BoardEvaluator.countSolutions(b2, tRnd, 50);
    }
    assert(diffTotal < randomTotal,
        `DIFF 总解数 (${diffTotal}) < RANDOM 总解数 (${randomTotal})`);
}

console.log('\n== 13. OfferOverride：FirstRound 优先级覆盖 ==');
{
    const { OfferRegistry, TriggerTiming, registerDefaultOverrides } = require('../src/game/core/OfferOverrides');
    const dyn = DynamicWeightDiff.instance;
    dyn.init([
        // Hard-only tier，没有 override 时应该出 DIFF
        { id: 1, FillBlankOdds: 0, RandomOdds: 0, EntropyOdds: 0, EasyOdds: 0,
          HardOdds: 100, IntuitionOdds: 0, Clearboard: 0, Allunite: 0,
          HighScoreRange: [1000, -1], FactorRange: [-9999, 9999] },
    ]);
    dyn.reset();
    registerDefaultOverrides();
    dyn.beginGame(); // refillIndex = 0 → FirstRound override 命中

    // 棋盘非空，避免 EmptyBoard override 抢先（FirstRound 优先级是 2，EmptyBoard 是 3）
    // 实际上 FirstRound 与 EmptyBoard 是不同 trigger 桶，但 trigger 由 refillIndex 决定，
    // refillIndex=0 → trigger = FirstRound，所以只会问 FirstRound 桶
    const b = boardFromRows([0xff, 0, 0, 0, 0, 0, 0, 0]);
    const r = dyn.offerTrio(b, 5000);
    assert(r.tierId === -2, `首次 refill 被 override 接管，tierId 应为 -2 (实际 ${r.tierId})`);

    // 第二次 refill：refillIndex=1 → trigger=EmptyBoard，board 非空 → 不命中 → 回 base 路径
    const r2 = dyn.offerTrio(b, 5000);
    assert(r2.tierId === 1, `第二次 refill 回到 base tier (实际 ${r2.tierId})`);
    assert(r2.algo === AlgorithmKind.DIFF, `第二次 refill 出 DIFF (实际 ${r2.algo})`);

    // EmptyBoard 覆盖：棋盘空 + refillIndex>0
    const r3 = dyn.offerTrio(emptyBoard(), 5000);
    assert(r3.tierId === -2, `空棋盘被 EmptyBoard override 接管 (实际 ${r3.tierId})`);
}

console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===`);
if (failed > 0) process.exit(1);
