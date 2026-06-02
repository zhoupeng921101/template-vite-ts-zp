import { Boot } from './scenes/Boot';
import { GameOver } from './scenes/GameOver';
import { Game as MainGame } from './scenes/Game';
import { LevelComplete } from './scenes/LevelComplete';
import { LevelMap } from './scenes/LevelMap';
import { MainMenu } from './scenes/MainMenu';
import { AUTO, Game, Scale } from 'phaser';
import { Preloader } from './scenes/Preloader';
import { mountConfigPanel } from './debug/ConfigPanel';

const config: Phaser.Types.Core.GameConfig = {
    type: AUTO,
    width: 450,
    height: 800,
    parent: 'game-container',
    backgroundColor: '#1a1a2e',
    scale: {
        mode: Scale.FIT,
        autoCenter: Scale.CENTER_BOTH,
    },
    scene: [
        Boot,
        Preloader,
        MainMenu,
        MainGame,
        GameOver,
        LevelComplete,
        LevelMap,
    ]
};

const StartGame = (parent: string) => {
    const game = new Game({ ...config, parent });
    // 浏览器内可调配置面板（DOM overlay）
    mountConfigPanel();
    return game;
}

export default StartGame;
