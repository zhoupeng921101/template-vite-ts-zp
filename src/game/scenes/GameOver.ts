import { Scene } from 'phaser';
import { GameState, GameMode } from '../core/GameState';

export class GameOver extends Scene
{
    private previousHigh = 0;
    private mode: GameMode = 'classic';
    private level = 1;

    constructor ()
    {
        super('GameOver');
    }

    init (data: { previousHigh?: number; mode?: GameMode; level?: number })
    {
        this.previousHigh = data?.previousHigh ?? 0;
        this.mode = data?.mode ?? 'classic';
        this.level = data?.level ?? 1;
    }

    create ()
    {
        (window as unknown as { __activeScene: string }).__activeScene = 'GameOver';

        // 6.3 GameOver 音效（缺失文件时跳过）
        if (this.cache.audio.exists('sfx_over')) {
            this.sound.play('sfx_over', { volume: 0.6 });  // 留硬编码，避免 GameOver 也 import Config
        }

        const { width, height } = this.cameras.main;
        const cx = width / 2;
        const state = GameState.instance;
        const finalScore = state.score;
        const high = state.highScore;
        // 真·破纪录：本局得分严格大于本局开始前的历史最高
        const isNewBest = finalScore > this.previousHigh && finalScore > 0;

        // 全屏暗色遮罩
        this.add.rectangle(cx, height / 2, width, height, 0x000018, 0.55);

        // 卡片
        const cardY = height * 0.42;
        const cardW = 340, cardH = 360;
        const card = this.add.graphics();
        card.fillStyle(0x222244, 0.95);
        card.fillRoundedRect(cx - cardW / 2, cardY - cardH / 2, cardW, cardH, 16);
        card.lineStyle(3, 0x556699, 1);
        card.strokeRoundedRect(cx - cardW / 2, cardY - cardH / 2, cardW, cardH, 16);

        // GAME OVER 标题（Adventure 还显示当前关）
        this.add.text(cx, cardY - cardH / 2 + 40, 'GAME OVER', {
            fontSize: '32px', color: '#ff8899', fontStyle: 'bold',
            stroke: '#222244', strokeThickness: 4,
        }).setOrigin(0.5);
        if (this.mode === 'adventure') {
            this.add.text(cx, cardY - cardH / 2 + 75, `LEVEL ${this.level}`, {
                fontSize: '16px', color: '#aabbdd', fontStyle: 'bold',
            }).setOrigin(0.5);
        }

        // SCORE 标签 + 数值
        this.add.text(cx, cardY - 50, 'SCORE', {
            fontSize: '16px', color: '#aabbdd', fontStyle: 'bold',
        }).setOrigin(0.5);
        const scoreLabel = this.add.text(cx, cardY - 10, '0', {
            fontSize: '56px', color: '#ffffff', fontStyle: 'bold',
            stroke: '#222244', strokeThickness: 4,
        }).setOrigin(0.5);

        // BEST 标签 + 数值
        this.add.text(cx, cardY + 60, 'BEST', {
            fontSize: '14px', color: '#aabbdd',
        }).setOrigin(0.5);
        const bestLabel = this.add.text(cx, cardY + 90, String(high), {
            fontSize: '28px', color: isNewBest ? '#ffe066' : '#bbccff', fontStyle: 'bold',
        }).setOrigin(0.5);

        // NEW BEST 徽章
        if (isNewBest) {
            const badge = this.add.text(cx, cardY - 95, '★ NEW BEST ★', {
                fontSize: '18px', color: '#ffe066', fontStyle: 'bold',
                stroke: '#553300', strokeThickness: 3,
            }).setOrigin(0.5);
            this.tweens.add({
                targets: badge,
                scaleX: { from: 0.5, to: 1.1 },
                scaleY: { from: 0.5, to: 1.1 },
                alpha: { from: 0, to: 1 },
                duration: 350,
                ease: 'Back.Out',
            });
            this.tweens.add({
                targets: badge,
                angle: { from: -3, to: 3 },
                duration: 600,
                yoyo: true, repeat: -1,
                ease: 'Sine.InOut',
            });
        }

        // 主按钮：Classic = PLAY AGAIN, Adventure = RETRY LEVEL
        const btnY = cardY + cardH / 2 - 50;
        const btn = this.add.graphics();
        const colorIdle = this.mode === 'adventure' ? 0xff7744 : 0x4477ff;
        const colorHover = this.mode === 'adventure' ? 0xff8855 : 0x5588ff;
        const drawBtn = (c: number) => {
            btn.clear();
            btn.fillStyle(c, 1);
            btn.fillRoundedRect(cx - 110, btnY - 25, 220, 50, 10);
        };
        drawBtn(colorIdle);
        this.add.text(cx, btnY, this.mode === 'adventure' ? `RETRY LEVEL ${this.level}` : 'PLAY AGAIN', {
            fontSize: this.mode === 'adventure' ? '18px' : '22px',
            color: '#ffffff', fontStyle: 'bold',
        }).setOrigin(0.5);
        const hit = this.add.zone(cx, btnY, 220, 50)
            .setOrigin(0.5).setInteractive({ useHandCursor: true });
        hit.on('pointerover', () => drawBtn(colorHover));
        hit.on('pointerout',  () => drawBtn(colorIdle));
        hit.on('pointerdown', () => {
            if (this.mode === 'adventure') {
                this.scene.start('Game', { mode: 'adventure', level: this.level });
            } else {
                this.scene.start('Game', { mode: 'classic' });
            }
        });

        // 副链接（Adventure 显示 Back to Menu）
        if (this.mode === 'adventure') {
            const menuLink = this.add.text(cx, cardY + cardH / 2 + 20, 'Back to Menu', {
                fontSize: '14px', color: '#88aacc',
            }).setOrigin(0.5).setInteractive({ useHandCursor: true });
            menuLink.on('pointerdown', () => this.scene.start('MainMenu'));
        }

        // 副提示
        this.add.text(cx, height - 40,
            this.mode === 'adventure' ? '关卡失败 · 再试一次' : 'Tap PLAY AGAIN to restart', {
            fontSize: '14px', color: '#7788bb',
        }).setOrigin(0.5);

        // 分数滚动
        let shown = 0;
        const totalSteps = 30;
        const stepVal = finalScore / totalSteps;
        const ticker = this.time.addEvent({
            delay: 30, repeat: totalSteps - 1,
            callback: () => {
                shown = Math.min(finalScore, Math.round(shown + stepVal));
                scoreLabel.setText(String(shown));
                if (ticker.getOverallProgress() >= 1) scoreLabel.setText(String(finalScore));
            },
        });

        void bestLabel;
    }
}
