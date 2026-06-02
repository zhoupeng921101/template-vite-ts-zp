import { Scene } from 'phaser';
import { GameState } from '../core/GameState';
import { LevelLoader } from '../core/LevelLoader';

export class LevelComplete extends Scene
{
    private completedLevel = 1;
    private earnedStars = 1;
    private earnedScore = 0;
    private earnedTarget = 0;
    private usedMoves = -1;  // D7：>=0 表示收集模式

    constructor ()
    {
        super('LevelComplete');
    }

    init (data: { level?: number; stars?: number; score?: number; target?: number; moves?: number })
    {
        this.completedLevel = data?.level ?? 1;
        this.earnedStars = data?.stars ?? 1;
        this.earnedScore = data?.score ?? 0;
        this.earnedTarget = data?.target ?? 0;
        this.usedMoves = data?.moves ?? -1;
    }

    create ()
    {
        (window as unknown as { __activeScene: string }).__activeScene = 'LevelComplete';

        const { width, height } = this.cameras.main;
        const cx = width / 2;

        // 暗色遮罩
        this.add.rectangle(cx, height / 2, width, height, 0x000018, 0.6);

        // 卡片
        const cardY = height * 0.45;
        const cardW = 360, cardH = 380;
        const card = this.add.graphics();
        card.fillStyle(0x223344, 0.95);
        card.fillRoundedRect(cx - cardW / 2, cardY - cardH / 2, cardW, cardH, 18);
        card.lineStyle(3, 0x66bb66, 1);
        card.strokeRoundedRect(cx - cardW / 2, cardY - cardH / 2, cardW, cardH, 18);

        // LEVEL N COMPLETE
        this.add.text(cx, cardY - cardH / 2 + 38, `LEVEL ${this.completedLevel}`, {
            fontSize: '18px', color: '#aabbdd', fontStyle: 'bold',
        }).setOrigin(0.5);
        this.add.text(cx, cardY - cardH / 2 + 75, 'COMPLETE!', {
            fontSize: '36px', color: '#88ff99', fontStyle: 'bold',
            stroke: '#222244', strokeThickness: 4,
        }).setOrigin(0.5);

        // 星星：3 个，渐次 popup（earned 弹大再回落 1.0 停住）
        const starY = cardY - 30;
        const starSize = 50;
        const gap = 70;
        for (let i = 0; i < 3; i++) {
            const sx = cx - gap + i * gap;
            const earned = i < this.earnedStars;
            const star = this.add.text(sx, starY, '★', {
                fontSize: `${starSize}px`,
                color: earned ? '#ffe066' : '#444466',
                stroke: '#222244', strokeThickness: 4,
            }).setOrigin(0.5).setScale(0);
            const delay = 200 + i * 200;
            if (earned) {
                this.tweens.chain({
                    targets: star,
                    tweens: [
                        { scale: 1.3, duration: 260, ease: 'Back.Out', delay },
                        { scale: 1.0, duration: 160, ease: 'Sine.InOut' },
                    ],
                });
            } else {
                this.tweens.add({
                    targets: star, scale: 1, duration: 260,
                    ease: 'Back.Out', delay,
                });
            }
        }

        // SCORE & TARGET（收集模式显示步数与分数；否则分数/目标）
        if (this.usedMoves >= 0) {
            this.add.text(cx, cardY + 55, 'MOVES', {
                fontSize: '13px', color: '#88aacc',
            }).setOrigin(0.5);
            this.add.text(cx, cardY + 80, `${this.usedMoves} steps · score ${this.earnedScore}`, {
                fontSize: '18px', color: '#ffffff', fontStyle: 'bold',
            }).setOrigin(0.5);
        } else {
            this.add.text(cx, cardY + 55, 'SCORE', {
                fontSize: '13px', color: '#88aacc',
            }).setOrigin(0.5);
            this.add.text(cx, cardY + 80, `${this.earnedScore} / ${this.earnedTarget}`, {
                fontSize: '22px', color: '#ffffff', fontStyle: 'bold',
            }).setOrigin(0.5);
        }

        // NEXT 按钮
        const hasNext = this.completedLevel < LevelLoader.count;
        const btnY = cardY + cardH / 2 - 50;
        const drawBtn = (color: number) => {
            btn.clear();
            btn.fillStyle(color, 1);
            btn.fillRoundedRect(cx - 110, btnY - 25, 220, 50, 10);
        };
        const btn = this.add.graphics();
        drawBtn(hasNext ? 0x44aa55 : 0x4477ff);
        this.add.text(cx, btnY, hasNext ? `NEXT LEVEL ${this.completedLevel + 1}` : 'BACK TO MENU', {
            fontSize: '18px', color: '#ffffff', fontStyle: 'bold',
        }).setOrigin(0.5);
        const hit = this.add.zone(cx, btnY, 220, 50)
            .setOrigin(0.5).setInteractive({ useHandCursor: true });
        hit.on('pointerover', () => drawBtn(hasNext ? 0x55cc66 : 0x5588ff));
        hit.on('pointerout',  () => drawBtn(hasNext ? 0x44aa55 : 0x4477ff));
        hit.on('pointerdown', () => {
            if (hasNext) {
                this.scene.start('Game', { mode: 'adventure', level: this.completedLevel + 1 });
            } else {
                this.scene.start('MainMenu');
            }
        });

        // 次要：返回菜单链接
        const menuLink = this.add.text(cx, cardY + cardH / 2 + 20, 'Back to Menu', {
            fontSize: '14px', color: '#88aacc',
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });
        menuLink.on('pointerdown', () => this.scene.start('MainMenu'));

        // 持久化进度
        const state = GameState.instance;
        state.recordStars(this.completedLevel, this.earnedStars);
        // 推进 level（让 MainMenu 显示已解锁数）
        if (this.completedLevel >= state.level) state.level = this.completedLevel + 1;
        state.save();
    }
}
