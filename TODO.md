# Block Blast 复刻 — TODO

来源:Cocos Creator 2.x `com.block.juggle v7.7.6` 逆向复刻
技术栈:Phaser 4 + Vite + TypeScript
最后更新:2026-06-02

---

## Phase 1 · 工程脚手架 ✅
- [x] Phaser 4 + Vite + TS 初始化
- [x] `npm install`
- [x] 五场景骨架 (Boot/Preloader/MainMenu/Game/GameOver)
- [x] 整体配置 450×800 / FIT scale
- [x] `.gitignore`

## Phase 2 · 资源接入 ✅
- [x] 8 个图集 atlas
- [x] UI 单图(logo / 按钮 / 文字特效)
- [x] 关卡数据 `default2000.json` 接入 Preloader
- [x] 5 个音效文件接入

## Phase 3 · 数据层 ✅
- [x] `BinaryBoard` 8×8 二进制棋盘
- [x] `BlockShapeMap` 73 形状 + 25 常用池
- [x] `GameState` 单例 + `localStorage` 存档
- [x] `LevelLoader` `Map[64]→8×8`
- [x] 单元测试 `board.test.ts` / `level.test.ts` / `state.test.ts`

## Phase 4 · 渲染层 🟡
- [x] `MainMenu`:logo + classic 按钮
- [x] `Game.create()` 关卡数据加载
- [x] 棋盘背景 + 格子背景绘制
- [x] 棋盘方块 sprite 渲染(`renderBoard`)
- [x] 底部 3 个候选槽渲染(`renderSlots`)
- [x] 顶部分数文字 + LEVEL 文字 + 临时退出 ×
- [ ] `MainMenu` 启用 adventure / pvp 按钮
- [ ] `GameOver` 真正的得分汇总界面

## Phase 5 · 核心交互 ✅
- [x] 5.1 候选方块设 interactive + 拖拽(跟手 + 拇指 offset + 放大到棋盘格尺寸)
- [x] 5.2 拖拽中实时显示棋盘"落点高亮"(grid snap + 绿/红配色)
- [x] 5.3 松手时 `canPutBlock` 校验:合法落子 / 非法回弹(Back.Out)
- [x] 5.4 落子后 `placePiece` + `renderBoard` + 清空槽 + 销毁拖拽对象
- [x] 5.5 落子后 `canClearRowCols(true)` + `clearRowsAndCols` + 加分(每格+1,消除+10/格,多行 +30×行列²)
- [x] 5.6 `operaArr` 全空时 `refillPieces` + `renderSlots`
- [x] 5.7 每次落子后 `canPutAnyOf` 判 GameOver → 存档 + 切 `GameOver` 场景

**E2E 测试**:`tests/e2e/smoke.mjs` (puppeteer + system Chrome,17/17 断言通过)
**调试钩子**:`window.__game` 暴露 `state` / `board` / `seedBoard` / `setSlot`,`window.__activeScene` 标记当前场景

## Phase 6 · 反馈与特效 🔴
- [ ] 落子播 `sfx_place`
- [ ] 消除播 `sfx_clear` + 消除动画(fade-out / 缩放)
- [ ] 连击 `combo` 计数 + `text_combo` / `text_perfect` 弹出
- [ ] 加分浮动数字(`score_fx` 图集)
- [ ] 消除粒子(`block_diamonds`)
- [ ] GameOver 播 `sfx_over`
- [ ] BGM `bgm_main` 循环播放
- [ ] 分数滚动动画

## Phase 7 · 关卡推进 🔴
- [ ] `levelTarget` / `RequiredScore` 过关条件判定
- [ ] 过关→ `state.level++` → 下一关 Map
- [ ] 关卡完成弹窗(`stars_icons` 星级)
- [ ] 关卡选择菜单(可选)

## Phase 8 · 模式区分 🟡
- [x] MainMenu 有 classic 入口
- [ ] Classic(无尽/无 Map 障碍) vs Adventure(关卡/有障碍)
- [ ] 模式切换 + 最高分独立保存

## Phase 9 · 体验细节 🔴
- [ ] 拖拽时候选方块放大
- [ ] 触屏 offset(手指拖时方块在上方,避免遮挡)
- [ ] 暂停/重开按钮
- [ ] 音量开关 UI
- [ ] 颜色分布 vs `COMMON_SHAPE_IDS` 是否对齐原游戏

## Phase 10 · 测试与发布 🟡
- [x] 手写 3 个 `*.test.ts`(console.log 风格)
- [ ] 引入 vitest 测试 runner
- [ ] 浏览器端真机/移动端实测
- [ ] `npm run build` 产物验证

---

## 总体进度

| 层 | 进度 |
|---|---|
| 工程脚手架 | 100% |
| 资源接入 | 100% |
| 数据层 | 100% |
| 渲染层 | 70% |
| **核心交互** | **100%** ✅ |
| 反馈/特效 | 0% |
| 关卡推进 | 0% |
| **整体可玩性** | **~70%** — 可完整跑一局了 |
