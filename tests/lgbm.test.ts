// LightGBM boardWeight 评分器 —— 单元测试
import * as fs from 'fs';
import * as path from 'path';
import {
    extractFeatures, predictBoardWeight, getOldBoardWeight,
    BLOCK_PUT_COUNT_IDS,
} from '../src/game/core/algorithms/BoardWeightLGBM';

let passed = 0, failed = 0;
function assert(cond: boolean, name: string, extra = '') {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.log(`  ✗ ${name}  ${extra}`); }
}

// 固定 RNG —— countMaxShapes 不再随机，测试可复现
let rngState = 0x12345678;
function seededRng() {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 0x100000000;
}

function emptyBoard(): number[][] {
    return Array.from({ length: 8 }, () => new Array(8).fill(-1));
}
function fullBoard(): number[][] {
    return Array.from({ length: 8 }, () => new Array(8).fill(1));
}

console.log('\n== 1. BLOCK_PUT_COUNT_IDS 39 项（含 26 重复） ==');
{
    assert(BLOCK_PUT_COUNT_IDS.length === 39, `len=39 (实际 ${BLOCK_PUT_COUNT_IDS.length})`);
    const dups = BLOCK_PUT_COUNT_IDS.filter((id, i) => BLOCK_PUT_COUNT_IDS.indexOf(id) !== i);
    assert(dups.length === 1 && dups[0] === 26, `重复项只有 26 (实际 ${JSON.stringify(dups)})`);
}

console.log('\n== 2. 空棋盘特征 ==');
{
    const f = extractFeatures(emptyBoard(), seededRng);
    assert(f.length === 59, `59 个特征 (实际 ${f.length})`);
    assert(f[39] === 1, `emptyRatio = 1.0 (实际 ${f[39]})`);
    assert(f[44] === 0 && f[45] === 0, `空棋盘无 holes (实际 ${f[44]}, ${f[45]})`);
    assert(f[46] === 0 && f[47] === 0, `空棋盘无近完成行/列 (实际 ${f[46]}, ${f[47]})`);
    assert(f[48] === 36, `空棋盘 6×6 个 3×3 全空 = 36 (实际 ${f[48]})`);
    assert(f[51] === 0, `空棋盘 exposed=0 (实际 ${f[51]})`);
}

console.log('\n== 3. 满棋盘特征 ==');
{
    const f = extractFeatures(fullBoard(), seededRng);
    assert(f[39] === 0, `emptyRatio = 0 (实际 ${f[39]})`);
    assert(f[48] === 0, `满棋盘无 3×3 全空 (实际 ${f[48]})`);
    assert(f[51] === 0, `满棋盘 exposed=0 (实际 ${f[51]})`);
    // getBlockMaxPutCount 所有项应该为 0
    let nonZero = 0;
    for (let i = 0; i < 39; i++) if (f[i] !== 0) nonZero++;
    assert(nonZero === 0, `满棋盘所有形状放不下 (实际 ${nonZero} 个非零)`);
}

console.log('\n== 4. getOldBoardWeight 范围合理 ==');
{
    const w1 = getOldBoardWeight(emptyBoard());
    const w2 = getOldBoardWeight(fullBoard());
    // 原版公式空棋盘会出负值（n=0，d=64 → 246 + 0 - 0 + (64-32)²/2 但有外层修正）
    // 满棋盘 d=0, n=0 → 246 + a-r + (-32)²/2 = 246 + 0 + 512 = 758 左右
    assert(typeof w1 === 'number' && !isNaN(w1), `空棋盘返回数字 (实际 ${w1})`);
    assert(typeof w2 === 'number' && !isNaN(w2), `满棋盘返回数字 (实际 ${w2})`);
    assert(w2 > w1, `满棋盘 weight > 空棋盘 weight (${w2} > ${w1})`);
    console.log(`    [info] empty=${w1}, full=${w2}`);
}

console.log('\n== 5. LightGBM 推理（加载真实模型）==');
{
    const modelPath = path.join(__dirname, '..', 'public', 'assets', 'data', 'complex_model.json');
    const exists = fs.existsSync(modelPath);
    assert(exists, `模型文件存在 ${modelPath}`);
    if (exists) {
        const forest = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
        assert(Array.isArray(forest) && forest.length === 390,
            `390 棵树 (实际 ${Array.isArray(forest) ? forest.length : 'not array'})`);

        // 空棋盘 / 半棋盘 / 满棋盘 跑预测
        const w0 = predictBoardWeight(emptyBoard(), forest, seededRng);
        const halfBoard = Array.from({ length: 8 }, (_, r) =>
            new Array(8).fill(0).map((_, c) => (r < 4 ? 1 : -1)));
        const wHalf = predictBoardWeight(halfBoard, forest, seededRng);
        const wFull = predictBoardWeight(fullBoard(), forest, seededRng);

        console.log(`    [info] empty=${w0}, half=${wHalf}, full=${wFull}`);
        assert(w0 >= 0 && w0 <= 650, `empty in [0,650] (实际 ${w0})`);
        assert(wHalf >= 0 && wHalf <= 650, `half in [0,650] (实际 ${wHalf})`);
        assert(wFull >= 0 && wFull <= 650, `full in [0,650] (实际 ${wFull})`);
        // 越满应该越"难"——但 boardWeight 并不严格单调，原版语义是综合复杂度
        assert(wFull > w0, `full (${wFull}) > empty (${w0})`);
    }
}

console.log('\n== 6. 无模型回退到 getOldBoardWeight ==');
{
    const w1 = predictBoardWeight(emptyBoard(), null, seededRng);
    const w2 = getOldBoardWeight(emptyBoard());
    assert(w1 === w2, `null forest 落回 oldBoardWeight (predict=${w1}, old=${w2})`);
}

console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===`);
if (failed > 0) process.exit(1);
