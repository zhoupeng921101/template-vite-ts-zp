// Adventure 关卡选择 - 爬塔界面（D6 分页版，覆盖全 2000 关）
import { Scene, GameObjects } from 'phaser';
import { GameState } from '../core/GameState';
import { LevelLoader } from '../core/LevelLoader';

const LAYOUT = [10, 9, 8, 7, 6, 5, 4, 1];  // 每页金字塔每行格数（底→顶），共 50
const PER_PAGE = LAYOUT.reduce((a, b) => a + b, 0);  // 50

// E2 章节主题（每章 = 1 页 = 50 关）
const CHAPTERS = [
    'Beginnings',  'Foothills',   'Highlands',   'Cliffside',
    'Skybridge',   'Cloudtop',    'Aurora',      'Stardust',
    'Nebula',      'Comet Trail', 'Lunar Plain', 'Solar Flare',
    'Galaxy Edge', 'Hyperspace',  'Quantum',     'Eternity',
];

export class LevelMap extends Scene
{
    private page = 0;
    private totalPages = 1;
    private pyramidLayer!: GameObjects.Container;
    private pageIndicator!: GameObjects.Text;
    private chapterText!: GameObjects.Text;
    // E3 翻页动画方向（1=下一页，-1=上一页）
    private lastDir = 0;

    constructor() { super('LevelMap'); }

    create() {
        (window as unknown as { __activeScene: string }).__activeScene = 'LevelMap';

        const { width, height } = this.cameras.main;
        const cx = width / 2;
        const state = GameState.instance;
        state.load();
        const maxUnlocked = state.getMaxUnlockedLevel();
        const totalLevels = LevelLoader.count > 0 ? LevelLoader.count : 2000;
        this.totalPages = Math.ceil(totalLevels / PER_PAGE);
        this.page = Math.min(this.totalPages - 1, Math.floor((maxUnlocked - 1) / PER_PAGE));

        // Back 箭头
        const back = this.add.text(28, 32, '‹', {
            fontSize: '40px', color: '#ffffff', fontStyle: 'bold',
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });
        back.on('pointerdown', () => this.scene.start('MainMenu'));

        // 标题
        this.add.text(cx, 36, 'Adventure', {
            fontSize: '22px', color: '#ffffff', fontStyle: 'bold',
            stroke: '#222244', strokeThickness: 4,
        }).setOrigin(0.5);

        // 奖杯
        this.add.text(cx, 78, '🏆', { fontSize: '28px' }).setOrigin(0.5);

        // E2 章节标题
        this.chapterText = this.add.text(cx, 110, '', {
            fontSize: '18px', color: '#ffd966', fontStyle: 'bold',
            stroke: '#222244', strokeThickness: 3,
        }).setOrigin(0.5);

        // 页指示器
        this.pageIndicator = this.add.text(cx, 132, '', {
            fontSize: '12px', color: '#aabbdd',
        }).setOrigin(0.5);

        // 翻页按钮
        const prevBtn = this.add.text(35, 360, '‹', {
            fontSize: '48px', color: '#88aaff', fontStyle: 'bold',
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });
        prevBtn.on('pointerdown', () => this.goPage(this.page - 1));
        const nextBtn = this.add.text(415, 360, '›', {
            fontSize: '48px', color: '#88aaff', fontStyle: 'bold',
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });
        nextBtn.on('pointerdown', () => this.goPage(this.page + 1));

        // 金字塔容器
        this.pyramidLayer = this.add.container(0, 0);

        // 首次渲染
        this.renderPyramid();

        // 底部 "Level N" 主按钮 - 始终跳到当前 maxUnlocked
        const btnY = height - 60;
        const btn = this.add.graphics();
        const drawBtn = (color: number) => {
            btn.clear();
            btn.fillStyle(color, 1);
            btn.fillRoundedRect(cx - 130, btnY - 28, 260, 56, 12);
        };
        drawBtn(0x44aa55);
        this.add.text(cx, btnY, `Level ${maxUnlocked}`, {
            fontSize: '24px', color: '#ffffff', fontStyle: 'bold',
            stroke: '#1a4a22', strokeThickness: 3,
        }).setOrigin(0.5);
        const btnHit = this.add.zone(cx, btnY, 260, 56)
            .setOrigin(0.5).setInteractive({ useHandCursor: true });
        btnHit.on('pointerover', () => drawBtn(0x55cc66));
        btnHit.on('pointerout',  () => drawBtn(0x44aa55));
        btnHit.on('pointerdown', () => {
            this.scene.start('Game', { mode: 'adventure', level: maxUnlocked });
        });

        // 鼠标滚轮翻页
        this.input.on('wheel', (_p: unknown, _go: unknown, _dx: number, dy: number) => {
            if (dy > 0) this.goPage(this.page - 1);
            else if (dy < 0) this.goPage(this.page + 1);
        });
    }

    private goPage(p: number): void {
        const next = Math.max(0, Math.min(this.totalPages - 1, p));
        if (next === this.page) return;
        this.lastDir = next > this.page ? 1 : -1;
        this.page = next;
        this.renderPyramid();
    }

    private renderPyramid(): void {
        this.pyramidLayer.removeAll(true);
        const cx = this.cameras.main.width / 2;
        const state = GameState.instance;
        const maxUnlocked = state.getMaxUnlockedLevel();
        const cellSize = 32, gap = 4;
        const startY = 540;
        let lvl = this.page * PER_PAGE + 1;

        for (let row = 0; row < LAYOUT.length; row++) {
            const count = LAYOUT[row];
            const rowWidth = count * cellSize + (count - 1) * gap;
            const xStart = cx - rowWidth / 2 + cellSize / 2;
            const y = startY - row * (cellSize + gap);
            for (let i = 0; i < count; i++) {
                const x = xStart + i * (cellSize + gap);
                const unlocked = lvl <= maxUnlocked;
                const current = lvl === maxUnlocked;
                const stars = state.levelStars[lvl] ?? 0;
                this.drawCell(x, y, lvl, unlocked, current, stars, cellSize);
                lvl++;
            }
        }

        // E2 章节
        const chapterName = CHAPTERS[this.page] ?? `Chapter ${this.page + 1}`;
        this.chapterText.setText(`Chapter ${this.page + 1}: ${chapterName}`);
        this.pageIndicator.setText(
            `Page ${this.page + 1} / ${this.totalPages}  ·  Levels ${this.page * PER_PAGE + 1}-${(this.page + 1) * PER_PAGE}`,
        );

        // E3 滑入动画：从 ±60px 偏移 + 透明渐入
        if (this.lastDir !== 0) {
            this.pyramidLayer.x = this.lastDir * 60;
            this.pyramidLayer.alpha = 0;
            this.tweens.add({
                targets: this.pyramidLayer,
                x: 0, alpha: 1,
                duration: 240, ease: 'Cubic.Out',
            });
            this.lastDir = 0;
        }
    }

    private drawCell(x: number, y: number, level: number, unlocked: boolean, current: boolean, stars: number, size: number): void {
        const g = this.add.graphics();
        const fillColor = current ? 0xffd966 : (stars > 0 ? 0x4488ff : (unlocked ? 0x336699 : 0x333355));
        const strokeColor = current ? 0xffe899 : 0x556699;
        g.fillStyle(fillColor, current ? 1 : 0.85);
        g.fillRoundedRect(x - size / 2, y - size / 2, size, size, 6);
        g.lineStyle(2, strokeColor, 0.9);
        g.strokeRoundedRect(x - size / 2, y - size / 2, size, size, 6);
        this.pyramidLayer.add(g);

        const textColor = current ? '#222244' : (unlocked ? '#ffffff' : '#666688');
        const numText = this.add.text(x, y - 2, String(level), {
            fontSize: '12px', color: textColor, fontStyle: 'bold',
        }).setOrigin(0.5);
        this.pyramidLayer.add(numText);

        if (stars > 0 && !current) {
            const starStr = '★'.repeat(stars);
            const starText = this.add.text(x, y + size / 2 - 4, starStr, {
                fontSize: '8px', color: '#ffe066',
            }).setOrigin(0.5, 1);
            this.pyramidLayer.add(starText);
        }

        if (unlocked) {
            const hit = this.add.zone(x, y, size + 2, size + 2)
                .setOrigin(0.5).setInteractive({ useHandCursor: true });
            hit.on('pointerdown', () => {
                this.scene.start('Game', { mode: 'adventure', level });
            });
            this.pyramidLayer.add(hit);
        }
    }
}
