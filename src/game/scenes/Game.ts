import { Scene, GameObjects, Geom, Input } from 'phaser';
import { GameState, COLOR_NAMES, ELEMENT_GLYPH, ELEMENT_COLOR, COLLECT_KEY_MAP } from '../core/GameState';
import type { ElementType } from '../core/GameState';
import { BinaryBoard } from '../core/BinaryBoard';
import { BlockShapeMap, BlockNumMap } from '../core/BlockShapeMap';
import type { ColorName } from '../core/GameState';
import { LevelLoader } from '../core/LevelLoader';
import { DynamicWeightDiff } from '../core/DynamicWeightDiff';
import { GameConfig } from '../core/GameConfig';
import { DebugHUD } from '../debug/DebugHUD';

// 棋盘渲染常量
const BOARD_X = 25;          // 棋盘左上 X
const BOARD_Y = 180;         // 棋盘左上 Y
const CELL_SIZE = 50;        // 每格像素
const BOARD_SIZE = CELL_SIZE * 8;  // 400

// 底部 3 个候选槽
const SLOT_Y = 660;
const SLOT_CELL = 28;        // 槽位中方块的格尺寸（比棋盘格小）
const SLOT_SPACING = 130;    // 3 个槽水平间距

// 拖拽时
const DRAG_SCALE = CELL_SIZE / SLOT_CELL;   // 拖起后放大到棋盘格尺寸 (≈1.79)
const DRAG_FINGER_OFFSET_Y = 110;           // 方块在手指上方多少像素（避免遮挡）
const GHOST_OK_COLOR  = 0x66ff77;           // 可放置：绿
const GHOST_BAD_COLOR = 0xff5566;           // 不可放：红
const GHOST_ALPHA = 0.45;

export class Game extends Scene
{
    private state!: GameState;
    private board!: BinaryBoard;

    // 渲染层
    private blockLayer!: GameObjects.Container;
    private slotLayer!: GameObjects.Container;

    // 棋盘方块 sprite 缓存：[row][col]
    private cellSprites: (GameObjects.Image | null)[][] = [];
    // 槽位 sprite 缓存：已落下的槽位置为 null
    private slotContainers: (GameObjects.Container | null)[] = [];

    // UI
    private scoreText!: GameObjects.Text;
    private bestText!: GameObjects.Text;
    // 6.7 显示分数（滚动到目标值）
    private displayedScore = 0;
    // A1 NEW BEST 触发：本局开始时的历史最高，只触发一次
    private initialHigh = 0;
    private newBestTriggered = false;
    // B4 Adventure 目标进度
    private progressBar?: GameObjects.Graphics;

    // 拖拽落点 ghost 图层
    private dragGhost!: GameObjects.Graphics;
    // 当前正在拖的形状 ID（dragstart 时记录，便于 ghost 渲染）
    private draggingShapeId = -1;

    // A5/G 道具：刷新/锤子/闪电次数（来自 Config）
    private refreshCount = 3;
    private hammerCount = 3;
    private lightningCount = 2;
    /** G 当前激活的道具：null = 正常拖拽 */
    private activeTool: 'hammer' | 'lightning' | null = null;
    private boardClickZone?: GameObjects.Zone;
    private toolHighlight?: GameObjects.Graphics;

    // B3 init() 接收的模式/关卡
    private initMode: 'classic' | 'adventure' = 'classic';
    private initLevel = 1;
    // B5 防止重复触发 LevelComplete
    private levelCompletedTriggered = false;

    // C-B 调试 HUD
    private hud?: DebugHUD;

    // D1 收集元素 UI
    private elementOverlays: (GameObjects.Text | null)[][] = [];
    private collectCounters: Partial<Record<ElementType, GameObjects.Text>> = {};

    constructor () { super('Game'); }

    init (data: { mode?: 'classic' | 'adventure'; level?: number })
    {
        this.initMode = data?.mode ?? 'classic';
        this.initLevel = data?.level ?? 1;
    }

    create ()
    {
        // 测试钩子：标记当前激活场景
        (window as unknown as { __activeScene: string }).__activeScene = 'Game';

        // 初始化数据层
        this.state = GameState.instance;
        this.board = new BinaryBoard();
        this.state.mode = this.initMode;

        // 加载关卡数据（来自 Preloader 的 cache）
        const raw = this.cache.json.get('levels');
        if (raw) LevelLoader.loadFromCache(raw);

        // 加载动态权重表（首次）
        const dyn = DynamicWeightDiff.instance;
        if (!dyn.isInitialized()) {
            const wcfg = this.cache.json.get('weightcfg');
            if (wcfg) dyn.init(wcfg);
        }

        // 读档以拿到 highScore（Classic 模式无尽，本局仍从 0 开始）
        this.state.load();
        this.initialHigh = this.state.highScore;
        this.newBestTriggered = false;

        // 设定 mode/level 后才能算 sessionKey
        if (this.state.mode === 'adventure') this.state.level = this.initLevel;
        else this.state.level = 1;

        // H1 尝试恢复局内进度
        const resumed = this.loadSession();
        if (resumed) {
            this.displayedScore = this.state.score;
        } else if (this.state.mode === 'adventure') {
            // Adventure 新局
            const level = LevelLoader.get(this.initLevel);
            if (level) {
                this.state.saveArr = LevelLoader.buildBoardFromMap(level);
                this.board.convertFromArr(this.state.saveArr);
                this.state.levelTarget = level.levelTarget;
            } else {
                this.state.saveArr = Array.from({ length: 8 }, () => new Array(8).fill(-1));
                this.board.convertFromArr(this.state.saveArr);
                this.state.levelTarget = 0;
            }
            this.state.resetCollection();
            this.seedCollectionElements(level ?? null);
            this.state.operaArr = [null, null, null];
            this.state.refillPieces(this.board, this.state.score);
            this.state.score = 0;
            this.state.combo = 0;
            this.displayedScore = 0;
            this.refreshCount = GameConfig.instance.refreshCount();
            this.hammerCount = GameConfig.instance.hammerCount();
            this.lightningCount = GameConfig.instance.lightningCount();
        } else {
            // Classic 新局
            this.state.saveArr = Array.from({ length: 8 }, () => new Array(8).fill(-1));
            this.board.convertFromArr(this.state.saveArr);
            this.state.setFirstHand();
            this.state.levelTarget = 0;
            this.state.resetCollection();
            this.state.score = 0;
            this.state.combo = 0;
            this.displayedScore = 0;
            this.refreshCount = GameConfig.instance.refreshCount();
            this.hammerCount = GameConfig.instance.hammerCount();
            this.lightningCount = GameConfig.instance.lightningCount();
        }
        this.activeTool = null;
        this.levelCompletedTriggered = false;

        // ─── 渲染骨架 ──────────────────────────────────────────
        this.drawBoardBackground();

        this.blockLayer = this.add.container(BOARD_X, BOARD_Y);
        this.slotLayer  = this.add.container(0, 0);
        // 5.2 ghost 图层：放在棋盘 sprite 之上、槽位之下
        this.dragGhost = this.add.graphics().setDepth(50);

        this.initCellSprites();
        this.renderBoard();
        this.renderSlots();

        // 顶部 UI
        if (this.state.mode === 'classic') {
            this.add.text(25, 25, 'BEST', {
                fontSize: '12px', color: '#7788cc', fontStyle: 'bold',
            });
            this.bestText = this.add.text(25, 40, String(this.initialHigh), {
                fontSize: '20px', color: '#bbccff', fontStyle: 'bold',
            });
        } else {
            // Adventure
            this.add.text(25, 25, 'LEVEL', {
                fontSize: '12px', color: '#7788cc', fontStyle: 'bold',
            });
            this.add.text(25, 40, String(this.state.level), {
                fontSize: '20px', color: '#ffd966', fontStyle: 'bold',
            });
            // placeholder bestText
            this.bestText = this.add.text(-1000, -1000, '').setVisible(false);

            if (this.state.isCollectionMode()) {
                // Z4 收集模式顶部条：1~5 种动态布局
                const activeTypes = this.state.activeCollectionTypes();
                const n = activeTypes.length;
                const totalW = 380;
                const slotW = totalW / n;
                const baseX = 35 + slotW / 2;
                for (let i = 0; i < n; i++) {
                    const t = activeTypes[i];
                    const x = baseX + i * slotW;
                    this.add.text(x - 18, 130, ELEMENT_GLYPH[t], {
                        fontSize: n <= 3 ? '28px' : '22px',
                        color: ELEMENT_COLOR[t],
                        stroke: '#222244', strokeThickness: 3,
                    }).setOrigin(0.5);
                    const ct = this.add.text(x + 12, 130,
                        `0/${this.state.collectionTargets[t]}`, {
                        fontSize: n <= 3 ? '15px' : '12px',
                        color: '#ffffff', fontStyle: 'bold',
                        stroke: '#222244', strokeThickness: 3,
                    }).setOrigin(0, 0.5);
                    this.collectCounters[t] = ct;
                }
            } else {
                // 目标进度条
                this.add.text(225, 130, `TARGET  ${this.state.levelTarget}`, {
                    fontSize: '13px', color: '#aabbdd', fontStyle: 'bold',
                }).setOrigin(0.5);
                const bg = this.add.graphics();
                bg.fillStyle(0x222244, 0.6);
                bg.fillRoundedRect(75, 145, 300, 8, 4);
                this.progressBar = this.add.graphics();
            }
        }

        this.scoreText = this.add.text(225, 80, '0', {
            fontSize: '52px', color: '#ffffff', fontStyle: 'bold',
            stroke: '#222244', strokeThickness: 4,
        }).setOrigin(0.5);

        // 临时：点击退出
        const exitBtn = this.add.text(420, 30, '×', {
            fontSize: '32px', color: '#ffffff',
        }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
        exitBtn.on('pointerdown', () => this.scene.start('MainMenu'));

        // A4 静音切换：持久化到 localStorage
        const muted = localStorage.getItem('bb_muted') === '1';
        this.sound.mute = muted;
        const muteBtn = this.add.text(380, 33, muted ? '🔇' : '🔊', {
            fontSize: '22px',
        }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
        muteBtn.on('pointerdown', () => {
            const next = !this.sound.mute;
            this.sound.mute = next;
            localStorage.setItem('bb_muted', next ? '1' : '0');
            muteBtn.setText(next ? '🔇' : '🔊');
        });

        // A4 BGM：缺失文件跳过；已在播放就不重启
        if (this.cache.audio.exists('bgm_main')) {
            let bgm = this.sound.get('bgm_main');
            if (!bgm) bgm = this.sound.add('bgm_main', { loop: true, volume: GameConfig.instance.bgmVolume() });
            if (!bgm.isPlaying) bgm.play();
        }

        // A5/G 道具按钮
        this.createRefreshTool();
        this.createHammerTool();
        this.createLightningTool();
        this.createToolClickZone();

        // C-B 调试 HUD（F9 切换）
        this.hud = new DebugHUD(this);

        // 调试钩子（E2E 测试用）
        (window as unknown as { __game: unknown }).__game = {
            state: this.state,
            board: this.board,
            BOARD_X, BOARD_Y, CELL_SIZE, SLOT_Y, SLOT_SPACING,
            DRAG_FINGER_OFFSET_Y,
            getShape: (id: number) => BlockShapeMap.get(id),
            seedBoard: (arr: number[][]) => {
                this.state.saveArr = arr.map((r) => [...r]);
                this.board.convertFromArr(this.state.saveArr);
                this.renderBoard();
            },
            setSlot: (i: number, shapeId: number, color: ColorName) => {
                this.state.operaArr[i] = { shapeId, color };
                this.renderSlots();
            },
        };

        this.input.on('dragstart', (_p: Input.Pointer, obj: GameObjects.Container) => {
            const slotIdx = obj.getData('slotIdx') as number;
            const piece = this.state.operaArr[slotIdx];
            if (!piece) return;
            this.draggingShapeId = piece.shapeId;
            // 放大到棋盘格尺寸 + 提升渲染层级
            obj.setScale(DRAG_SCALE);
            obj.setDepth(100);
        });
        this.input.on('drag', (_p: Input.Pointer, obj: GameObjects.Container, dragX: number, dragY: number) => {
            // 跟手 + 拇指 offset
            obj.x = dragX;
            obj.y = dragY - DRAG_FINGER_OFFSET_Y;
            this.updateGhost(obj);
        });
        this.input.on('dragend', (_p: Input.Pointer, obj: GameObjects.Container) => {
            this.dragGhost.clear();
            const shapeId = this.draggingShapeId;
            this.draggingShapeId = -1;
            obj.setDepth(0);

            const slotIdx = obj.getData('slotIdx') as number;
            const piece = this.state.operaArr[slotIdx];
            const shape = shapeId > 0 ? BlockShapeMap.get(shapeId) : undefined;

            if (piece && shape) {
                const { col, row } = this.computeGridPos(obj, shape);
                const inBounds = col >= 0 && row >= 0
                    && col + shape.width <= 8 && row + shape.height <= 8;
                if (inBounds && this.board.canPutBlock(shapeId, { x: col, y: row })) {
                    // 5.4 合法落子
                    this.state.placePiece(slotIdx, this.board, col, row);
                    this.state.moves++;
                    const placementScore = BlockNumMap.get(shapeId) ?? 0;
                    this.state.addScore(placementScore);
                    this.checkNewBest();
                    this.checkLevelComplete();
                    // 6.1 落子音效
                    this.safePlay('sfx_place', { volume: GameConfig.instance.sfxVolume() });
                    // 6.5 落子加分浮动
                    const pieceCenterX = BOARD_X + (col + shape.width / 2) * CELL_SIZE;
                    const pieceCenterY = BOARD_Y + (row + shape.height / 2) * CELL_SIZE;
                    this.showFloatingText(pieceCenterX, pieceCenterY, `+${placementScore}`, '#bbffbb');

                    // 渲染棋盘（新方块出现）
                    this.renderBoard();
                    obj.destroy();
                    this.slotContainers[slotIdx] = null;

                    // 5.5 检查满行/满列并消除（同时取出待消除 sprite 做动画）
                    const clear = this.board.canClearRowCols(true);
                    const lines = clear.rows.length + clear.cols.length;
                    if (lines > 0) {
                        // 收集待消除位置（去重）
                        const seen = new Set<number>();
                        const positions: { r: number; c: number }[] = [];
                        const addCell = (r: number, c: number) => {
                            const k = r * 8 + c;
                            if (!seen.has(k)) { seen.add(k); positions.push({ r, c }); }
                        };
                        for (const r of clear.rows) for (let c = 0; c < 8; c++) addCell(r, c);
                        for (const c of clear.cols) for (let r = 0; r < 8; r++) addCell(r, c);

                        // 6.2 消除动画：detach sprite 后 scale+fade 销毁
                        const sprites: GameObjects.Image[] = [];
                        const overlaySprites: GameObjects.Text[] = [];
                        for (const { r, c } of positions) {
                            const s = this.cellSprites[r][c];
                            if (s) { sprites.push(s); this.cellSprites[r][c] = null; }
                            // D1 收集：统计被消除的元素 + 拆下 overlay 做飞行动画
                            const elem = this.state.elementArr[r][c];
                            if (elem) {
                                this.state.collected[elem] = (this.state.collected[elem] ?? 0) + 1;
                                this.state.elementArr[r][c] = null;
                                const ov = this.elementOverlays[r][c];
                                if (ov) { overlaySprites.push(ov); this.elementOverlays[r][c] = null; }
                            }
                        }
                        // D1 收集 UI 刷新 + 飞行动画
                        if (overlaySprites.length > 0) {
                            this.refreshCollectCounters();
                            for (const ov of overlaySprites) {
                                this.tweens.add({
                                    targets: ov, y: ov.y - 60, alpha: 0, scale: 1.5,
                                    duration: 480, ease: 'Cubic.Out',
                                    onComplete: () => ov.destroy(),
                                });
                            }
                        }
                        // 同步清 saveArr
                        const clearedCells = this.state.clearRowsAndCols(clear.rows, clear.cols);
                        this.state.combo += 1;
                        const clearScore = clearedCells * 10 + lines * lines * 30;
                        this.state.addScore(clearScore);
                        this.checkNewBest();
                        this.checkLevelComplete();

                        // 音效
                        this.safePlay('sfx_clear', { volume: GameConfig.instance.sfxVolume() * 1.2 });

                        // 动画
                        for (const s of sprites) {
                            this.tweens.add({
                                targets: s,
                                scaleX: s.scaleX * 1.4,
                                scaleY: s.scaleY * 1.4,
                                alpha: 0,
                                duration: 280,
                                ease: 'Sine.Out',
                                onComplete: () => s.destroy(),
                            });
                        }

                        // A3 粒子爆破：在每个消除格中心炸 diamond
                        this.spawnClearParticles(positions);

                        // 6.5 消除加分浮动
                        this.showFloatingText(225, 380, `+${clearScore}`, '#ffd944', 32);

                        // 6.4 combo / perfect 文字
                        if (this.board.isEmpty()) {
                            this.showBurstText(225, 280, 'PERFECT!', '#ffe44a');
                        } else if (this.state.combo >= 2) {
                            this.showBurstText(225, 280, `COMBO ×${this.state.combo}`, '#ff77bb');
                        }
                    } else {
                        this.state.combo = 0;
                    }

                    // 5.6 三个槽全空 → 智能补充（保证 3 个能全放下）
                    if (this.state.operaArr.every((p) => p === null)) {
                        this.state.refillPieces(this.board, this.state.score);
                        this.renderSlots();
                    }

                    // H1 保存局内进度
                    this.saveSession();

                    // 5.7 GameOver 判定：剩余候选无一可放
                    const remainingIds = this.state.operaArr
                        .filter((p): p is NonNullable<typeof p> => p !== null)
                        .map((p) => p.shapeId);
                    if (remainingIds.length > 0 && !this.board.canPutAnyOf(remainingIds)) {
                        this.state.save();
                        // H2 GameOver 清掉 session
                        this.clearSession();
                        const previousHigh = this.initialHigh;
                        const mode = this.state.mode;
                        const level = this.state.level;
                        this.time.delayedCall(lines > 0 ? 600 : 200, () => this.scene.start('GameOver', { previousHigh, mode, level }));
                    }
                    return;
                }
            }

            // 5.3 非法 → 弹回原位（恢复缩放）
            const ox = obj.getData('originX') as number;
            const oy = obj.getData('originY') as number;
            this.tweens.add({
                targets: obj, x: ox, y: oy, scaleX: 1, scaleY: 1,
                duration: 180, ease: 'Back.Out',
            });
        });
    }

    /** 把容器当前位置转成棋盘 grid (col, row)：以容器中心-shape 包围盒左上算 */
    private computeGridPos(container: GameObjects.Container, shape: { width: number; height: number }): { col: number; row: number } {
        const totalW = shape.width * CELL_SIZE;
        const totalH = shape.height * CELL_SIZE;
        const tlX = container.x - totalW / 2;
        const tlY = container.y - totalH / 2;
        const col = Math.round((tlX - BOARD_X) / CELL_SIZE);
        const row = Math.round((tlY - BOARD_Y) / CELL_SIZE);
        return { col, row };
    }

    /** 5.2 渲染落点高亮 */
    private updateGhost(container: GameObjects.Container): void {
        this.dragGhost.clear();
        if (this.draggingShapeId < 0) return;
        const shape = BlockShapeMap.get(this.draggingShapeId);
        if (!shape) return;

        const { col, row } = this.computeGridPos(container, shape);
        // 完全脱离棋盘则不画
        if (col + shape.width <= 0 || row + shape.height <= 0) return;
        if (col >= 8 || row >= 8) return;

        const canPlace = col >= 0 && row >= 0
            && col + shape.width <= 8 && row + shape.height <= 8
            && this.board.canPutBlock(this.draggingShapeId, { x: col, y: row });
        const color = canPlace ? GHOST_OK_COLOR : GHOST_BAD_COLOR;

        this.dragGhost.fillStyle(color, GHOST_ALPHA);
        for (let r = 0; r < shape.height; r++) {
            for (let c = 0; c < shape.width; c++) {
                if (((shape.shape[r] >> (shape.width - c - 1)) & 1) === 0) continue;
                const gc = col + c, gr = row + r;
                if (gc < 0 || gc >= 8 || gr < 0 || gr >= 8) continue;
                this.dragGhost.fillRoundedRect(
                    BOARD_X + gc * CELL_SIZE + 4,
                    BOARD_Y + gr * CELL_SIZE + 4,
                    CELL_SIZE - 8, CELL_SIZE - 8, 4,
                );
            }
        }
    }

    /** 画 8×8 棋盘格子背景 */
    private drawBoardBackground(): void {
        const g = this.add.graphics();
        // 外框
        g.fillStyle(0x2a2a55, 1);
        g.fillRoundedRect(BOARD_X - 5, BOARD_Y - 5, BOARD_SIZE + 10, BOARD_SIZE + 10, 8);
        // 每个格子
        g.fillStyle(0x1a1a40, 1);
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                g.fillRoundedRect(
                    BOARD_X + c * CELL_SIZE + 2,
                    BOARD_Y + r * CELL_SIZE + 2,
                    CELL_SIZE - 4, CELL_SIZE - 4, 4
                );
            }
        }
    }

    /** 初始化 cellSprites 二维数组 */
    private initCellSprites(): void {
        this.cellSprites = [];
        this.elementOverlays = [];
        for (let r = 0; r < 8; r++) {
            this.cellSprites.push(new Array(8).fill(null));
            this.elementOverlays.push(new Array(8).fill(null));
        }
    }

    /**
     * Z3 在棋盘障碍格上播种收集元素，按 level.Condition.RequiredCollections 实施
     * - Key 9999 = 分数,跳过
     * - Key 100-107 / 200 → ElementType
     */
    private seedCollectionElements(level: import('../core/LevelLoader').LevelConfig | null): void {
        if (!level) return;
        const rcs = level.Condition?.RequiredCollections ?? [];
        // 解析目标
        const targets: Partial<Record<ElementType, number>> = {};
        for (const rc of rcs) {
            if (rc.Key === 9999) continue;  // 分数另算
            const t = COLLECT_KEY_MAP[rc.Key];
            if (!t) continue;
            targets[t] = (targets[t] ?? 0) + rc.Value;
        }
        // 没有真实收集目标 → 不进入收集模式
        const activeTypes = Object.keys(targets) as ElementType[];
        if (activeTypes.length === 0) return;
        this.state.collectionTargets = targets;
        for (const t of activeTypes) this.state.collected[t] = 0;

        // 在障碍格上播种：每个 type 占 target 个格子（不够就截）
        const obstacles: { r: number; c: number }[] = [];
        for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
            if (this.state.saveArr[r][c] !== -1) obstacles.push({ r, c });
        }
        // 洗牌
        for (let i = obstacles.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [obstacles[i], obstacles[j]] = [obstacles[j], obstacles[i]];
        }
        let idx = 0;
        for (const t of activeTypes) {
            const target = targets[t] ?? 0;
            // 最多占 50% 障碍格 / 至少 2 个
            const seedCount = Math.min(obstacles.length - idx, Math.max(2, Math.floor(target * 0.6)));
            for (let k = 0; k < seedCount && idx < obstacles.length; k++, idx++) {
                const { r, c } = obstacles[idx];
                this.state.elementArr[r][c] = t;
            }
        }
    }

    /** 根据 state.saveArr 更新棋盘上所有方块 + D1 元素叠加层 */
    private renderBoard(): void {
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const colorIdx = this.state.saveArr[r][c];
                const existing = this.cellSprites[r][c];

                if (colorIdx === -1) {
                    if (existing) { existing.destroy(); this.cellSprites[r][c] = null; }
                } else {
                    const colorName = COLOR_NAMES[colorIdx] ?? COLOR_NAMES[0];
                    if (existing) {
                        existing.setFrame(colorName);
                    } else {
                        const spr = this.add.image(
                            c * CELL_SIZE + CELL_SIZE / 2,
                            r * CELL_SIZE + CELL_SIZE / 2,
                            'blocks', colorName
                        );
                        spr.setDisplaySize(CELL_SIZE - 4, CELL_SIZE - 4);
                        this.blockLayer.add(spr);
                        this.cellSprites[r][c] = spr;
                    }
                }

                // D1 元素叠加层
                const elem = this.state.elementArr[r][c];
                const overlayExisting = this.elementOverlays[r][c];
                if (elem) {
                    if (!overlayExisting) {
                        const t = this.add.text(
                            c * CELL_SIZE + CELL_SIZE / 2,
                            r * CELL_SIZE + CELL_SIZE / 2,
                            ELEMENT_GLYPH[elem],
                            {
                                fontSize: '26px', color: ELEMENT_COLOR[elem],
                                fontStyle: 'bold', stroke: '#222244', strokeThickness: 3,
                            },
                        ).setOrigin(0.5).setDepth(40);
                        this.blockLayer.add(t);
                        this.elementOverlays[r][c] = t;
                    }
                } else {
                    if (overlayExisting) {
                        overlayExisting.destroy();
                        this.elementOverlays[r][c] = null;
                    }
                }
            }
        }
    }

    /** 渲染底部 3 个候选方块槽 */
    private renderSlots(): void {
        // 清掉旧的
        this.slotContainers.forEach(c => c?.destroy());
        this.slotContainers = [];

        const startX = 225 - SLOT_SPACING;
        for (let i = 0; i < 3; i++) {
            const container = this.add.container(startX + i * SLOT_SPACING, SLOT_Y);
            this.slotLayer.add(container);
            this.slotContainers.push(container);

            const piece = this.state.operaArr[i];
            if (!piece) continue;

            const shape = BlockShapeMap.get(piece.shapeId);
            if (!shape) continue;

            // 居中绘制：以 (0,0) 为中心
            const totalW = shape.width * SLOT_CELL;
            const totalH = shape.height * SLOT_CELL;
            const offsetX = -totalW / 2 + SLOT_CELL / 2;
            const offsetY = -totalH / 2 + SLOT_CELL / 2;

            let cellIdx = 0;
            for (let r = 0; r < shape.height; r++) {
                for (let c = 0; c < shape.width; c++) {
                    if ((shape.shape[r] >> (shape.width - c - 1)) & 1) {
                        const cx = offsetX + c * SLOT_CELL;
                        const cy = offsetY + r * SLOT_CELL;
                        const spr = this.add.image(cx, cy, 'blocks', piece.color);
                        spr.setDisplaySize(SLOT_CELL - 2, SLOT_CELL - 2);
                        container.add(spr);
                        // D5 元素叠加（如该格带元素）
                        const elem = piece.elements?.[cellIdx];
                        if (elem) {
                            const t = this.add.text(cx, cy, ELEMENT_GLYPH[elem], {
                                fontSize: '16px', color: ELEMENT_COLOR[elem],
                                fontStyle: 'bold', stroke: '#222244', strokeThickness: 2,
                            }).setOrigin(0.5);
                            container.add(t);
                        }
                        cellIdx++;
                    }
                }
            }

            // 5.1 让该槽位可拖拽
            container.setData('slotIdx', i);
            container.setData('originX', container.x);
            container.setData('originY', container.y);
            // 小方块(1x1/1x2 等)hit 区扩大到最小 75×75,避免难选中
            const HIT_MIN = 75;
            const hitW = Math.max(totalW, HIT_MIN);
            const hitH = Math.max(totalH, HIT_MIN);
            container.setInteractive(
                new Geom.Rectangle(-hitW / 2, -hitH / 2, hitW, hitH),
                Geom.Rectangle.Contains
            );
            this.input.setDraggable(container);
        }
    }

    /** 安全播放音效：缺失文件直接 no-op，避免崩溃 */
    private safePlay(key: string, config?: Phaser.Types.Sound.SoundConfig): void {
        if (this.cache.audio.exists(key)) this.sound.play(key, config);
    }

    // ─── H1 局内进度 save/resume ───────────────────────────────────
    private sessionKey(): string {
        return GameState.sessionKey(this.state.mode, this.state.level);
    }

    private saveSession(): void {
        try {
            const data = {
                mode: this.state.mode,
                level: this.state.level,
                saveArr: this.state.saveArr,
                elementArr: this.state.elementArr,
                operaArr: this.state.operaArr,
                score: this.state.score,
                combo: this.state.combo,
                levelTarget: this.state.levelTarget,
                collected: this.state.collected,
                collectionTargets: this.state.collectionTargets,
                moves: this.state.moves,
                initialHigh: this.initialHigh,
                newBestTriggered: this.newBestTriggered,
                refreshCount: this.refreshCount,
                hammerCount: this.hammerCount,
                lightningCount: this.lightningCount,
            };
            localStorage.setItem(this.sessionKey(), JSON.stringify(data));
        } catch { /* ignore */ }
    }

    private loadSession(): boolean {
        try {
            const raw = localStorage.getItem(this.sessionKey());
            if (!raw) return false;
            const d = JSON.parse(raw);
            if (d.mode !== this.state.mode || d.level !== this.state.level) return false;
            this.state.saveArr = d.saveArr;
            this.state.elementArr = d.elementArr;
            this.state.operaArr = d.operaArr;
            this.state.score = d.score;
            this.state.combo = d.combo;
            this.state.levelTarget = d.levelTarget;
            this.state.collected = d.collected;
            this.state.collectionTargets = d.collectionTargets;
            this.state.moves = d.moves;
            this.initialHigh = d.initialHigh;
            this.newBestTriggered = d.newBestTriggered;
            this.refreshCount = d.refreshCount;
            this.hammerCount = d.hammerCount;
            this.lightningCount = d.lightningCount;
            this.board.convertFromArr(this.state.saveArr);
            return true;
        } catch { return false; }
    }

    private clearSession(): void {
        GameState.clearSession(this.state.mode, this.state.level);
    }

    /** A5 刷新道具：清空 3 个候选 + 智能 refill，限本局 3 次 */
    private createRefreshTool(): void {
        const x = 45, y = 740;
        const bg = this.add.graphics();
        const icon = this.add.text(x, y, '⟲', {
            fontSize: '28px', color: '#ffffff', fontStyle: 'bold',
        }).setOrigin(0.5);
        const countBadge = this.add.text(x + 14, y + 14, '', {
            fontSize: '13px', color: '#ffe066', fontStyle: 'bold',
        }).setOrigin(0.5);

        const redraw = () => {
            bg.clear();
            const active = this.refreshCount > 0;
            bg.fillStyle(active ? 0x4477ff : 0x333355, 0.9);
            bg.fillCircle(x, y, 24);
            bg.lineStyle(2, active ? 0x88aaff : 0x556699, 1);
            bg.strokeCircle(x, y, 24);
            icon.setColor(active ? '#ffffff' : '#888899');
            countBadge.setText(String(this.refreshCount));
            countBadge.setVisible(this.refreshCount > 0);
        };
        redraw();

        const hit = this.add.zone(x, y, 56, 56)
            .setOrigin(0.5)
            .setInteractive({ useHandCursor: true });

        hit.on('pointerdown', () => {
            if (this.refreshCount <= 0) return;
            if (this.draggingShapeId > 0) return;
            this.refreshCount--;
            this.state.operaArr = [null, null, null];
            this.state.refillPieces(this.board);
            this.renderSlots();
            redraw();
            this.safePlay('sfx_place', { volume: GameConfig.instance.sfxVolume() * 0.8 });
            this.tweens.add({
                targets: icon, angle: '+=360', duration: 350, ease: 'Cubic.Out',
            });
            this.saveSession();
        });
    }

    /** G1 锤子：单格删除 */
    private createHammerTool(): void {
        const x = 110, y = 740;
        const bg = this.add.graphics();
        const icon = this.add.text(x, y, '🔨', { fontSize: '24px' }).setOrigin(0.5);
        const countBadge = this.add.text(x + 14, y + 14, '', {
            fontSize: '13px', color: '#ffe066', fontStyle: 'bold',
        }).setOrigin(0.5);
        const redraw = () => {
            bg.clear();
            const active = this.hammerCount > 0;
            const armed = this.activeTool === 'hammer';
            bg.fillStyle(armed ? 0xff9944 : (active ? 0x884422 : 0x333355), 0.9);
            bg.fillCircle(x, y, 24);
            bg.lineStyle(2, armed ? 0xffe066 : (active ? 0xcc8866 : 0x556699), 1);
            bg.strokeCircle(x, y, 24);
            icon.setAlpha(active ? 1 : 0.4);
            countBadge.setText(String(this.hammerCount));
            countBadge.setVisible(this.hammerCount > 0);
        };
        this.hammerRedraw = redraw;
        redraw();
        const hit = this.add.zone(x, y, 56, 56).setOrigin(0.5).setInteractive({ useHandCursor: true });
        hit.on('pointerdown', () => {
            if (this.hammerCount <= 0) return;
            if (this.draggingShapeId > 0) return;
            this.activeTool = this.activeTool === 'hammer' ? null : 'hammer';
            this.refreshToolUI();
        });
    }

    /** G2 闪电：清整行 + 整列（十字消除） */
    private createLightningTool(): void {
        const x = 175, y = 740;
        const bg = this.add.graphics();
        const icon = this.add.text(x, y, '⚡', { fontSize: '24px' }).setOrigin(0.5);
        const countBadge = this.add.text(x + 14, y + 14, '', {
            fontSize: '13px', color: '#ffe066', fontStyle: 'bold',
        }).setOrigin(0.5);
        const redraw = () => {
            bg.clear();
            const active = this.lightningCount > 0;
            const armed = this.activeTool === 'lightning';
            bg.fillStyle(armed ? 0xffcc22 : (active ? 0x886622 : 0x333355), 0.9);
            bg.fillCircle(x, y, 24);
            bg.lineStyle(2, armed ? 0xffee66 : (active ? 0xccaa66 : 0x556699), 1);
            bg.strokeCircle(x, y, 24);
            icon.setAlpha(active ? 1 : 0.4);
            countBadge.setText(String(this.lightningCount));
            countBadge.setVisible(this.lightningCount > 0);
        };
        this.lightningRedraw = redraw;
        redraw();
        const hit = this.add.zone(x, y, 56, 56).setOrigin(0.5).setInteractive({ useHandCursor: true });
        hit.on('pointerdown', () => {
            if (this.lightningCount <= 0) return;
            if (this.draggingShapeId > 0) return;
            this.activeTool = this.activeTool === 'lightning' ? null : 'lightning';
            this.refreshToolUI();
        });
    }

    private hammerRedraw?: () => void;
    private lightningRedraw?: () => void;

    /** 所有工具 UI 重画 + ghost 显示控制 */
    private refreshToolUI(): void {
        this.hammerRedraw?.();
        this.lightningRedraw?.();
        if (this.activeTool && this.boardClickZone) {
            this.boardClickZone.setInteractive();
            this.input.setDefaultCursor('crosshair');
        } else {
            if (this.boardClickZone) this.boardClickZone.disableInteractive();
            this.input.setDefaultCursor('');
            if (this.toolHighlight) this.toolHighlight.clear();
        }
    }

    /** 工具模式下，棋盘上的点击 zone */
    private createToolClickZone(): void {
        this.toolHighlight = this.add.graphics().setDepth(45);
        this.boardClickZone = this.add.zone(
            BOARD_X + BOARD_SIZE / 2, BOARD_Y + BOARD_SIZE / 2,
            BOARD_SIZE, BOARD_SIZE,
        ).setOrigin(0.5).setDepth(60);
        this.boardClickZone.disableInteractive();

        this.boardClickZone.on('pointermove', (p: Input.Pointer) => {
            if (!this.activeTool) return;
            const col = Math.floor((p.x - BOARD_X) / CELL_SIZE);
            const row = Math.floor((p.y - BOARD_Y) / CELL_SIZE);
            if (col < 0 || col >= 8 || row < 0 || row >= 8) return;
            this.drawToolPreview(row, col);
        });
        this.boardClickZone.on('pointerdown', (p: Input.Pointer) => {
            if (!this.activeTool) return;
            const col = Math.floor((p.x - BOARD_X) / CELL_SIZE);
            const row = Math.floor((p.y - BOARD_Y) / CELL_SIZE);
            if (col < 0 || col >= 8 || row < 0 || row >= 8) return;
            if (this.activeTool === 'hammer') this.applyHammer(row, col);
            else this.applyLightning(row, col);
        });
    }

    private drawToolPreview(row: number, col: number): void {
        if (!this.toolHighlight) return;
        this.toolHighlight.clear();
        this.toolHighlight.fillStyle(this.activeTool === 'hammer' ? 0xff9944 : 0xffcc22, 0.35);
        if (this.activeTool === 'hammer') {
            this.toolHighlight.fillRoundedRect(
                BOARD_X + col * CELL_SIZE + 2,
                BOARD_Y + row * CELL_SIZE + 2,
                CELL_SIZE - 4, CELL_SIZE - 4, 4,
            );
        } else {
            // 整行
            this.toolHighlight.fillRoundedRect(
                BOARD_X + 2, BOARD_Y + row * CELL_SIZE + 2,
                BOARD_SIZE - 4, CELL_SIZE - 4, 4,
            );
            // 整列
            this.toolHighlight.fillRoundedRect(
                BOARD_X + col * CELL_SIZE + 2, BOARD_Y + 2,
                CELL_SIZE - 4, BOARD_SIZE - 4, 4,
            );
        }
    }

    private applyHammer(row: number, col: number): void {
        if (this.state.saveArr[row][col] === -1) return;  // 空格不消耗
        // 收集元素
        const elem = this.state.elementArr[row][col];
        if (elem) {
            this.state.collected[elem] = (this.state.collected[elem] ?? 0) + 1;
            this.state.elementArr[row][col] = null;
        }
        this.state.saveArr[row][col] = -1;
        // 同步二进制板
        this.board.rowBinary[row] &= ~(1 << (8 - col - 1));
        // 销毁 sprite + 动画
        const spr = this.cellSprites[row][col];
        if (spr) {
            this.cellSprites[row][col] = null;
            this.tweens.add({
                targets: spr, scale: 1.5, alpha: 0, duration: 250,
                onComplete: () => spr.destroy(),
            });
        }
        const ov = this.elementOverlays[row][col];
        if (ov) {
            this.elementOverlays[row][col] = null;
            this.tweens.add({
                targets: ov, y: ov.y - 40, alpha: 0, scale: 1.5, duration: 350,
                onComplete: () => ov.destroy(),
            });
        }
        this.hammerCount--;
        this.activeTool = null;
        this.refreshToolUI();
        this.refreshCollectCounters();
        this.safePlay('sfx_place', { volume: GameConfig.instance.sfxVolume() });
        this.saveSession();
        this.afterToolUse();
    }

    private applyLightning(row: number, col: number): void {
        const positions: { r: number; c: number }[] = [];
        for (let c = 0; c < 8; c++) positions.push({ r: row, c });
        for (let r = 0; r < 8; r++) if (r !== row) positions.push({ r, c: col });
        // 收集元素
        const sprites: GameObjects.Image[] = [];
        const overlays: GameObjects.Text[] = [];
        for (const { r, c } of positions) {
            const e = this.state.elementArr[r][c];
            if (e) {
                this.state.collected[e] = (this.state.collected[e] ?? 0) + 1;
                this.state.elementArr[r][c] = null;
            }
            if (this.state.saveArr[r][c] !== -1) {
                this.state.saveArr[r][c] = -1;
                this.board.rowBinary[r] &= ~(1 << (8 - c - 1));
                const s = this.cellSprites[r][c];
                if (s) { sprites.push(s); this.cellSprites[r][c] = null; }
            }
            const ov = this.elementOverlays[r][c];
            if (ov) { overlays.push(ov); this.elementOverlays[r][c] = null; }
        }
        // 动画
        for (const s of sprites) {
            this.tweens.add({
                targets: s, scale: 1.4, alpha: 0, duration: 300,
                onComplete: () => s.destroy(),
            });
        }
        for (const o of overlays) {
            this.tweens.add({
                targets: o, y: o.y - 60, alpha: 0, scale: 1.5, duration: 400,
                onComplete: () => o.destroy(),
            });
        }
        this.spawnClearParticles(positions);
        this.lightningCount--;
        this.activeTool = null;
        this.refreshToolUI();
        this.refreshCollectCounters();
        this.safePlay('sfx_clear', { volume: GameConfig.instance.sfxVolume() * 1.2 });
        this.saveSession();
        this.afterToolUse();
    }

    private afterToolUse(): void {
        this.checkLevelComplete();
        // 工具后 GameOver 判定：剩余候选无一可放
        const remainingIds = this.state.operaArr
            .filter((p): p is NonNullable<typeof p> => p !== null)
            .map((p) => p.shapeId);
        if (remainingIds.length > 0 && !this.board.canPutAnyOf(remainingIds)) {
            this.state.save();
            this.clearSession();
            const previousHigh = this.initialHigh;
            const mode = this.state.mode;
            const level = this.state.level;
            this.time.delayedCall(500, () => this.scene.start('GameOver', { previousHigh, mode, level }));
        }
    }

    /** A3 粒子爆破：每个消除格中心炸 5 颗 diamond */
    private spawnClearParticles(positions: { r: number; c: number }[]): void {
        if (!this.textures.exists('diamonds')) return;
        const emitter = this.add.particles(0, 0, 'diamonds', {
            frame: ['diamond_1', 'diamond_2', 'diamond_3', 'blue_diamond'],
            speed: { min: 100, max: 240 },
            angle: { min: 0, max: 360 },
            scale: { start: 0.22, end: 0 },
            alpha: { start: 1, end: 0 },
            lifespan: { min: 400, max: 700 },
            rotate: { min: -180, max: 180 },
            emitting: false,
        });
        emitter.setDepth(180);
        for (const { r, c } of positions) {
            const x = BOARD_X + c * CELL_SIZE + CELL_SIZE / 2;
            const y = BOARD_Y + r * CELL_SIZE + CELL_SIZE / 2;
            emitter.explode(5, x, y);
        }
        this.time.delayedCall(900, () => emitter.destroy());
    }

    update() {
        // 6.7 分数滚动：往目标值 lerp
        if (this.displayedScore !== this.state.score) {
            const diff = this.state.score - this.displayedScore;
            const step = Math.max(1, Math.ceil(Math.abs(diff) / 8));
            this.displayedScore += diff > 0 ? step : -step;
            if ((diff > 0 && this.displayedScore > this.state.score)
                || (diff < 0 && this.displayedScore < this.state.score)) {
                this.displayedScore = this.state.score;
            }
            this.scoreText.setText(String(this.displayedScore));
        }
        // A1 实时刷新 BEST（如本局已超过历史最高）
        if (this.state.mode === 'classic'
            && this.state.score > this.initialHigh
            && this.bestText.text !== String(this.state.score)) {
            this.bestText.setText(String(this.state.score));
            this.bestText.setColor('#ffe066');
        }
        // C-B HUD 刷新
        if (this.hud) this.hud.update();

        // B4 Adventure 目标进度条
        if (this.progressBar && this.state.levelTarget > 0) {
            const p = Math.min(1, this.state.score / this.state.levelTarget);
            this.progressBar.clear();
            this.progressBar.fillStyle(p >= 1 ? 0xffe066 : 0x55cc66, 1);
            this.progressBar.fillRoundedRect(75, 145, 300 * p, 8, 4);
        }
    }

    /** A1 本局首次破纪录时弹"NEW BEST!" */
    private checkNewBest(): void {
        if (this.newBestTriggered) return;
        if (this.initialHigh <= 0) return;  // 第一次玩，不弹
        if (this.state.score <= this.initialHigh) return;
        this.newBestTriggered = true;
        this.showBurstText(225, 180, 'NEW BEST!', '#ffe44a');
    }

    /** B5 / D1 / D7 Adventure 胜利检测 */
    private checkLevelComplete(): void {
        if (this.state.mode !== 'adventure') return;
        if (this.levelCompletedTriggered) return;
        let stars = 0;
        let extra: { moves?: number } = {};
        if (this.state.isCollectionMode()) {
            if (!this.state.isCollectionComplete()) return;
            stars = this.state.calcCollectionStars();
            extra = { moves: this.state.moves };
        } else {
            if (this.state.levelTarget <= 0) return;
            if (this.state.score < this.state.levelTarget) return;
            stars = this.state.calcStars(this.state.score, this.state.levelTarget);
        }
        this.levelCompletedTriggered = true;
        const finalScore = this.state.score;
        const target = this.state.levelTarget;
        const level = this.state.level;
        // H2 通关清掉本关 session
        this.clearSession();
        this.time.delayedCall(700, () => {
            this.scene.start('LevelComplete', { level, stars, score: finalScore, target, ...extra });
        });
    }

    /** Z4 刷新顶部收集计数（动态元素列表） */
    private refreshCollectCounters(): void {
        const types = this.state.activeCollectionTypes();
        for (const t of types) {
            const ct = this.collectCounters[t];
            if (!ct) continue;
            const got = this.state.collected[t] ?? 0;
            const tgt = this.state.collectionTargets[t] ?? 0;
            ct.setText(`${got}/${tgt}`);
            if (got >= tgt) ct.setColor('#88ff88');
        }
    }

    /** 6.5 浮动加分文字 */
    private showFloatingText(x: number, y: number, text: string, color = '#ffffff', fontSize = 22): void {
        const t = this.add.text(x, y, text, {
            fontSize: `${fontSize}px`, color, fontStyle: 'bold',
            stroke: '#222244', strokeThickness: 3,
        }).setOrigin(0.5).setDepth(200);
        this.tweens.add({
            targets: t,
            y: y - 60,
            alpha: { from: 1, to: 0 },
            scaleX: { from: 0.6, to: 1.1 },
            scaleY: { from: 0.6, to: 1.1 },
            duration: 750,
            ease: 'Cubic.Out',
            onComplete: () => t.destroy(),
        });
    }

    /** 6.4 弹出大字（combo / perfect） */
    private showBurstText(x: number, y: number, text: string, color: string): void {
        const t = this.add.text(x, y, text, {
            fontSize: '42px', color, fontStyle: 'bold',
            stroke: '#222244', strokeThickness: 6,
        }).setOrigin(0.5).setDepth(250).setScale(0.3).setAlpha(0);
        this.tweens.chain({
            targets: t,
            tweens: [
                { scaleX: 1.1, scaleY: 1.1, alpha: 1, duration: 220, ease: 'Back.Out' },
                { y: y - 50, alpha: 0, duration: 700, delay: 250, ease: 'Cubic.Out' },
            ],
            onComplete: () => t.destroy(),
        });
    }
}
