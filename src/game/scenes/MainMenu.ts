import { Scene, GameObjects } from 'phaser';
import { GameState } from '../core/GameState';

export class MainMenu extends Scene
{
    constructor ()
    {
        super('MainMenu');
    }

    create ()
    {
        (window as unknown as { __activeScene: string }).__activeScene = 'MainMenu';

        const state = GameState.instance;
        state.load();

        const cx = this.cameras.main.width / 2;

        // logo
        this.add.image(cx, 200, 'logo').setScale(0.55);

        // Classic 按钮
        const classicY = 400;
        this.makeButton(cx, classicY, 'CLASSIC', '无尽模式 · 挑战最高分', 0x4477ff, () => {
            this.scene.start('Game', { mode: 'classic' });
        });
        this.add.text(cx, classicY + 60, `BEST  ${state.highScore}`, {
            fontSize: '16px', color: '#aabbdd', fontStyle: 'bold',
        }).setOrigin(0.5);

        // Adventure 按钮
        const advY = 550;
        const unlocked = state.getMaxUnlockedLevel();
        this.makeButton(cx, advY, 'ADVENTURE', `已解锁 ${unlocked} / 2000 关`, 0xff7744, () => {
            this.scene.start('LevelMap');
        });

        // 底部提示
        this.add.text(cx, 740, 'Block Blast — 复刻 v0.1', {
            fontSize: '12px', color: '#556699',
        }).setOrigin(0.5);
    }

    private makeButton(x: number, y: number, title: string, subtitle: string, color: number, onClick: () => void): GameObjects.Container {
        const w = 280, h = 80;
        const c = this.add.container(x, y);

        const bg = this.add.graphics();
        const drawBg = (fill: number) => {
            bg.clear();
            bg.fillStyle(fill, 1);
            bg.fillRoundedRect(-w / 2, -h / 2, w, h, 14);
            bg.lineStyle(2, 0xffffff, 0.25);
            bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 14);
        };
        drawBg(color);
        c.add(bg);

        c.add(this.add.text(0, -16, title, {
            fontSize: '28px', color: '#ffffff', fontStyle: 'bold',
            stroke: '#222244', strokeThickness: 3,
        }).setOrigin(0.5));
        c.add(this.add.text(0, 16, subtitle, {
            fontSize: '13px', color: '#ddeeff',
        }).setOrigin(0.5));

        const hit = this.add.zone(0, 0, w, h)
            .setOrigin(0.5)
            .setInteractive({ useHandCursor: true });
        c.add(hit);

        hit.on('pointerover', () => { drawBg((color & 0xfefefe) + 0x111111); c.setScale(1.03); });
        hit.on('pointerout', () => { drawBg(color); c.setScale(1); });
        hit.on('pointerdown', onClick);

        return c;
    }
}
