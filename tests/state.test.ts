// 单元测试：GameState
import { GameState } from '../src/game/core/GameState';
import { BinaryBoard } from '../src/game/core/BinaryBoard';

// localStorage polyfill for Node
(globalThis as any).localStorage = {
    _data: {} as Record<string, string>,
    getItem(k: string) { return this._data[k] ?? null; },
    setItem(k: string, v: string) { this._data[k] = v; },
    removeItem(k: string) { delete this._data[k]; },
};

let passed = 0, failed = 0;
function assert(cond: boolean, name: string, extra = '') {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.log(`  ✗ ${name}  ${extra}`); }
}

console.log('\n== 1. 初始化 ==');
const s = new GameState();
assert(s.score === 0, 'score=0');
assert(s.saveArr.length === 8 && s.saveArr[0].length === 8, '棋盘 8x8');
assert(s.saveArr.every(r => r.every(c => c === -1)), '全 -1');
assert(s.operaArr.length === 3, '3 个槽');

console.log('\n== 2. 补充方块 ==');
s.refillPieces();
assert(s.operaArr.every(p => p !== null), '全部补满');
assert(s.operaArr.every(p => p!.shapeId > 0), '形状 ID 有效');

console.log('\n== 3. 放块 ==');
const board = new BinaryBoard();
// 用确定的单格方块 (shape 1)，避免随机方块左上角为空导致 flaky
s.operaArr[0] = { shapeId: 1, color: 'block_blue' };
s.placePiece(0, board, 0, 0);
assert(s.operaArr[0] === null, '槽位 0 清空');
assert(s.saveArr[0][0] !== -1, '(0,0) 有色块');
assert(!board.emptyAt(0, 0), 'BinaryBoard (0,0) 占用');

// 额外：3x2 横块 (shape 35 = [7,7]) 放 (2,3)，验证多格落子
const s_b = new GameState();
const board2 = new BinaryBoard();
s_b.operaArr[0] = { shapeId: 35, color: 'block_red' };
s_b.placePiece(0, board2, 2, 3);
let all6 = true;
for (let r = 3; r < 5; r++) for (let c = 2; c < 5; c++) {
    if (s_b.saveArr[r][c] === -1 || board2.emptyAt(c, r)) all6 = false;
}
assert(all6, '3x2 块覆盖 6 格');

console.log('\n== 4. 加分 ==');
s.addScore(100);
assert(s.score === 100, 'score=100');
assert(s.highScore === 100, '同时更新 highScore');
s.addScore(50);
assert(s.score === 150 && s.highScore === 150, '继续加分');

console.log('\n== 5. 消除行/列 ==');
const s2 = new GameState();
// 填满第 3 行
for (let c = 0; c < 8; c++) s2.saveArr[3][c] = 0;
const cleared = s2.clearRowsAndCols([3], []);
assert(cleared === 8, `消除 8 格 (实际 ${cleared})`);
assert(s2.saveArr[3].every(c => c === -1), '第 3 行已清空');

console.log('\n== 6. 存档/读档 ==');
const s3 = new GameState();
s3.score = 1234;
s3.highScore = 9999;
s3.level = 42;
s3.saveArr[0][0] = 5;
s3.save();
const s4 = new GameState();
const ok = s4.load();
assert(ok, '读档成功');
assert(s4.score === 1234, 'score 持久化');
assert(s4.level === 42, 'level 持久化');
assert(s4.saveArr[0][0] === 5, 'saveArr 持久化');

console.log('\n== 7. resetForLevel ==');
const s5 = new GameState();
s5.score = 500;
s5.saveArr[2][2] = 3;
s5.resetForLevel();
assert(s5.score === 0, 'score 重置');
assert(s5.saveArr.every(r => r.every(c => c === -1)), '棋盘清空');
assert(s5.operaArr.every(p => p !== null), '方块补满');

console.log('\n== 8. 智能 refill：随机无死亡 ==');
{
    // 100 次空棋盘 refill 都能 checkPutAllBlocks
    let allPass = true;
    for (let i = 0; i < 100; i++) {
        const s = new GameState();
        const b = new BinaryBoard();
        s.operaArr = [null, null, null];
        s.refillPieces(b);
        const ids = s.operaArr.filter(p => p !== null).map(p => p!.shapeId);
        if (!b.checkPutAllBlocks(ids)) { allPass = false; break; }
    }
    assert(allPass, '100 次空棋盘 refill 全部能放下');
}
{
    // 近满棋盘（只留最底行）：refill 后至少有方块能放
    const s = new GameState();
    const b = new BinaryBoard();
    for (let r = 0; r < 7; r++) for (let c = 0; c < 8; c++) s.saveArr[r][c] = 0;
    b.convertFromArr(s.saveArr);
    s.operaArr = [null, null, null];
    s.refillPieces(b);
    const ids = s.operaArr.filter(p => p !== null).map(p => p!.shapeId);
    assert(b.canPutAnyOf(ids), '近满棋盘 refill 后至少有一种能放');
}
{
    // 首发 = 原游戏 firstIds [9, 39, 24]
    const s = new GameState();
    s.setFirstHand();
    const ids = s.operaArr.map(p => p!.shapeId);
    assert(JSON.stringify(ids) === '[9,39,24]', `首发 = [9,39,24] (实际 ${JSON.stringify(ids)})`);
}
{
    // 原版 39-shape 均匀池：跑 1000 次（3000 个 piece）
    //  - 池中无 id=1（原版 useBlocks 刻意排除），出现次数应为 0
    //  - 大块 id=13（3×3 实心）应正常出现，期望频率 ≈ 3000/39 ≈ 77
    const s = new GameState();
    const counts = new Map<number, number>();
    for (let i = 0; i < 1000; i++) {
        s.operaArr = [null, null, null];
        s.refillPieces(); // 不传 board → 纯随机
        for (const p of s.operaArr) {
            counts.set(p!.shapeId, (counts.get(p!.shapeId) ?? 0) + 1);
        }
    }
    const noOne = counts.get(1) ?? 0;
    const big = counts.get(13) ?? 0;
    assert(noOne === 0, `1×1 已从池中排除 (实际出现 ${noOne} 次)`);
    assert(big > 30 && big < 150, `3×3 实心 (id=13) 出现频率合理 (实际 ${big}, 期望 ≈77)`);
}

console.log('\n== 9. D7 收集模式星级评定 ==');
{
    const s = new GameState();
    s.resetCollection();
    s.collectionTargets = { diamond: 5, pentagon: 3, star: 2 };  // total 10
    s.collected = { diamond: 5, pentagon: 3, star: 2 };

    s.moves = 5;  // ≤ 6 (60% of 10)
    assert(s.calcCollectionStars() === 3, `5 步 / 10 目标 → 3★ (实际 ${s.calcCollectionStars()})`);

    s.moves = 9;  // ≤ 10
    assert(s.calcCollectionStars() === 2, `9 步 → 2★ (实际 ${s.calcCollectionStars()})`);

    s.moves = 15;
    assert(s.calcCollectionStars() === 1, `15 步 → 1★ (实际 ${s.calcCollectionStars()})`);

    // 没有收集目标返回 0
    s.resetCollection();
    assert(s.calcCollectionStars() === 0, '无收集目标 → 0★');
}

console.log('\n== 10. 动态调度 mode 守卫：仅 classic 走 DynamicWeightDiff ==');
{
    // 准备：用一份 weightcfg 初始化 DynamicWeightDiff，并设置高分让 tier 命中
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const cfg = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', 'public', 'assets', 'data', 'weightcfg.json'),
        'utf8',
    ));
    const { DynamicWeightDiff } = require('../src/game/core/DynamicWeightDiff');
    DynamicWeightDiff.instance.init(cfg);
    DynamicWeightDiff.instance.reset();

    // Classic 模式 + 高分 → piece 应带 algo 标签
    const classicState = new GameState();
    classicState.mode = 'classic';
    classicState.operaArr = [null, null, null];
    const b1 = new BinaryBoard();
    classicState.refillPieces(b1, 5000);
    const classicAlgos = classicState.operaArr.map((p) => p!.algo);
    assert(classicAlgos.every((a) => a != null),
        `classic 高分 piece 全带 algo 标签 (实际 ${JSON.stringify(classicAlgos)})`);

    // Adventure 模式 + 高分 → piece 不应带 algo（走纯随机无死局）
    const advState = new GameState();
    advState.mode = 'adventure';
    advState.operaArr = [null, null, null];
    const b2 = new BinaryBoard();
    advState.refillPieces(b2, 5000);
    const advAlgos = advState.operaArr.map((p) => p!.algo);
    assert(advAlgos.every((a) => a == null),
        `adventure 即使高分也不挂 algo (实际 ${JSON.stringify(advAlgos)})`);
}

console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===`);
if (failed > 0) process.exit(1);
