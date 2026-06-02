// 调试 HUD：F9 切换显示，实时显示动态权重系统的状态
// 点击 FORCE 行可循环切换强制算法（用于现场演示 8 种算法效果）
import { Scene, GameObjects } from 'phaser';
import { GameState } from '../core/GameState';
import { DynamicWeightDiff } from '../core/DynamicWeightDiff';
import { ALGORITHM_NAME, AlgorithmKind } from '../core/algorithms/types';

const STORAGE_KEY = 'bb_debug_hud';
const ALGO_CYCLE: (AlgorithmKind | null)[] = [
    null,
    AlgorithmKind.FILL,
    AlgorithmKind.RANDOM_NO_DIE,
    AlgorithmKind.ADD3,
    AlgorithmKind.EASY_DIFF,
    AlgorithmKind.DIFF,
    AlgorithmKind.STRAIGHT_DEATH_DIFF,
    AlgorithmKind.CLEAR_ALL,
    AlgorithmKind.ALL_COMBINATION,
];

export class DebugHUD {
    private scene: Scene;
    private container!: GameObjects.Container;
    private bg!: GameObjects.Graphics;
    private lines: GameObjects.Text[] = [];
    private hint!: GameObjects.Text;
    private visible: boolean;

    constructor(scene: Scene) {
        this.scene = scene;
        this.visible = localStorage.getItem(STORAGE_KEY) === '1';
        this.build();
        scene.input.keyboard?.on('keydown-F9', () => this.toggle());
    }

    private build(): void {
        const W = 200, H = 100;
        const X = 245, Y = 75;
        this.container = this.scene.add.container(X, Y).setDepth(500);

        this.bg = this.scene.add.graphics();
        this.container.add(this.bg);
        this.bg.fillStyle(0x000022, 0.85);
        this.bg.fillRoundedRect(0, 0, W, H, 6);
        this.bg.lineStyle(1, 0x44ff88, 0.6);
        this.bg.strokeRoundedRect(0, 0, W, H, 6);

        // 5 行文字
        const labels = ['ALGO', 'TIER', 'dynW', 'TRIO', 'FORCE'];
        for (let i = 0; i < labels.length; i++) {
            const t = this.scene.add.text(6, 4 + i * 18, '', {
                fontSize: '11px', color: '#aaffcc', fontFamily: 'monospace',
            });
            this.container.add(t);
            this.lines.push(t);
        }
        // E1 FORCE 行点击循环切换
        const forceLine = this.lines[4];
        forceLine.setInteractive({ useHandCursor: true });
        forceLine.on('pointerdown', () => this.cycleForce());

        this.hint = this.scene.add.text(W / 2, H - 8, '[F9 toggle · click FORCE]', {
            fontSize: '9px', color: '#557799',
        }).setOrigin(0.5);
        this.container.add(this.hint);

        this.container.setVisible(this.visible);
    }

    private cycleForce(): void {
        const dyn = DynamicWeightDiff.instance;
        const cur = dyn.forceAlgorithm;
        const idx = ALGO_CYCLE.indexOf(cur);
        const next = ALGO_CYCLE[(idx + 1) % ALGO_CYCLE.length];
        dyn.forceAlgorithm = next;
    }

    toggle(): void {
        this.visible = !this.visible;
        this.container.setVisible(this.visible);
        try { localStorage.setItem(STORAGE_KEY, this.visible ? '1' : '0'); } catch { /* ignore */ }
    }

    update(): void {
        if (!this.visible) return;
        const dyn = DynamicWeightDiff.instance;
        const state = GameState.instance;
        const algoText = dyn.lastAlgo == null ? '(none)' : ALGORITHM_NAME[dyn.lastAlgo];
        const tierText = dyn.lastTierId == null ? '(none)'
            : (dyn.lastTierId === -1 ? 'FORCED' : String(dyn.lastTierId));
        const dwText = String(dyn.getDynamicWeight());
        const trioText = state.operaArr.map((p) => p ? p.shapeId : '_').join(',');
        const forceText = dyn.forceAlgorithm == null
            ? '(none) click→' : ALGORITHM_NAME[dyn.forceAlgorithm];
        this.lines[0].setText(`ALGO: ${algoText}`);
        this.lines[1].setText(`TIER: ${tierText}  s=${state.score}`);
        this.lines[2].setText(`dynW: ${dwText}`);
        this.lines[3].setText(`TRIO: ${trioText}`);
        this.lines[4].setText(`FORCE: ${forceText}`);
        this.lines[4].setColor(dyn.forceAlgorithm == null ? '#aaffcc' : '#ffe066');
    }
}
