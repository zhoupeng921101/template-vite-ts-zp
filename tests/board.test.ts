// 单元测试：BinaryBoard
import { BinaryBoard } from '../src/game/core/BinaryBoard';

let passed = 0, failed = 0;
function assert(cond: boolean, name: string, extra = '') {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.log(`  ✗ ${name}  ${extra}`); }
}

console.log('\n== 1. 空棋盘 ==');
const b = new BinaryBoard();
assert(b.isEmpty(), '初始空');
assert(b.emptyAt(0, 0), '(0,0) 空');
assert(b.canPut(13), '可以放 3x3 实心');

console.log('\n== 2. 放单格方块 ==');
b.putBlock(1, { x: 0, y: 0 });
assert(!b.emptyAt(0, 0), '(0,0) 被占');
assert(b.emptyAt(1, 0), '(1,0) 仍空');
assert(!b.canPutBlock(1, { x: 0, y: 0 }), '(0,0) 重复放失败');
assert(b.canPutBlock(1, { x: 1, y: 0 }), '(1,0) 可放');

console.log('\n== 3. 边界检查 ==');
const b2 = new BinaryBoard();
assert(!b2.canPutBlock(13, { x: 6, y: 6 }), '3x3 放 (6,6) 越界');
assert(b2.canPutBlock(13, { x: 5, y: 5 }), '3x3 放 (5,5) 边界内');

console.log('\n== 4. 满行消除 ==');
const b3 = new BinaryBoard();
// 填满第 0 行
b3.putBlock(11, { x: 0, y: 0 });  // 5x1
b3.putBlock(5,  { x: 5, y: 0 });  // 3x1
console.log(b3.debugPrint());
const r = b3.canClearRowCols(true);
assert(r.rows.length === 1 && r.rows[0] === 0, '检测到第 0 行满', JSON.stringify(r));
assert(b3.isEmpty(), '消除后棋盘空');

console.log('\n== 5. 满列消除 ==');
const b4 = new BinaryBoard();
// 填满第 0 列（8 个单格）
for (let r = 0; r < 8; r++) b4.putBlock(1, { x: 0, y: r });
console.log(b4.debugPrint());
const r2 = b4.canClearRowCols(true);
assert(r2.cols.length === 1 && r2.cols[0] === 0, '检测到第 0 列满', JSON.stringify(r2));
assert(b4.isEmpty(), '消除后棋盘空');

console.log('\n== 6. 行列同时消除 ==');
const b5 = new BinaryBoard();
for (let c = 0; c < 8; c++) b5.putBlock(1, { x: c, y: 0 });  // 第 0 行
for (let r = 1; r < 8; r++) b5.putBlock(1, { x: 0, y: r });  // 第 0 列(除已占)
const r3 = b5.canClearRowCols(true);
assert(r3.rows.includes(0) && r3.cols.includes(0), '同时检测到行+列', JSON.stringify(r3));

console.log('\n== 7. canPut 没位置时返回 false ==');
const b6 = new BinaryBoard();
// 几乎填满（除右下角 1 格）
for (let r = 0; r < 8; r++) for (let c = 0; c < 7; c++) b6.putBlock(1, { x: c, y: r });
for (let c = 0; c < 7; c++) b6.putBlock(1, { x: c, y: 7 });
assert(b6.canPut(1), '单格还能放');
assert(!b6.canPut(9), '2x2 放不下');

console.log('\n== 8. checkPutAllBlocks ==');
const b7 = new BinaryBoard();
assert(b7.checkPutAllBlocks([1, 1, 1]), '空棋盘可放 3 个单格');
const b8 = new BinaryBoard();
// 填到只剩 1 格
for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    if (!(r === 7 && c === 7)) b8.putBlock(1, { x: c, y: r });
}
assert(b8.checkPutAllBlocks([1, 1, 1]) === false, '只剩 1 格放不下 3 个单格');
assert(b8.checkPutAllBlocks([1]), '只剩 1 格能放 1 个单格');

console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===`);
if (failed > 0) process.exit(1);
