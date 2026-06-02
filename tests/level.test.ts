// 单元测试：LevelLoader
import { LevelLoader } from '../src/game/core/LevelLoader';
import * as fs from 'fs';
import * as path from 'path';

let passed = 0, failed = 0;
function assert(cond: boolean, name: string, extra = '') {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.log(`  ✗ ${name}  ${extra}`); }
}

const raw = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../public/assets/data/default2000.json'), 'utf-8')
);

console.log('\n== 1. 加载 ==');
LevelLoader.loadFromCache(raw);
assert(LevelLoader.count === 2000, `共 2000 关 (实际 ${LevelLoader.count})`);

console.log('\n== 2. 取关卡 ==');
const lv1 = LevelLoader.get(1);
assert(lv1 !== null, '第 1 关存在');
assert(lv1!.Num === 1, 'Num=1');
assert(lv1!.Map.length === 64, 'Map 长度 64');

const lv2000 = LevelLoader.get(2000);
assert(lv2000 !== null && lv2000.Num === 2000, '第 2000 关');

const lvNull = LevelLoader.get(2001);
assert(lvNull === null, '越界返回 null');

console.log('\n== 3. Map -> board 转换 ==');
const board = LevelLoader.buildBoardFromMap(lv1!);
assert(board.length === 8, '8 行');
assert(board[0].length === 8, '8 列');

// 第1关 Map[0..7] = [0,0,1,1,0,1,1,0]
const expectedRow0 = [-1, -1, 0, 0, -1, 0, 0, -1];
assert(JSON.stringify(board[0]) === JSON.stringify(expectedRow0),
    `第 0 行匹配 [${board[0].join(',')}]`);

console.log('\n== 4. 不同关卡难度递增 ==');
const lv1Score = lv1!.Condition.RequiredScore;
const lv500 = LevelLoader.get(500);
const lv1500 = LevelLoader.get(1500);
console.log(`  关 1 目标分: ${lv1Score}`);
console.log(`  关 500 目标分: ${lv500!.Condition.RequiredScore}`);
console.log(`  关 1500 目标分: ${lv1500!.Condition.RequiredScore}`);
assert(lv1Score > 0, '目标分>0');

console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===`);
