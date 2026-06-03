import { Scene } from 'phaser';
import { GameConfig } from '../core/GameConfig';
import { BoardWeightProvider } from '../core/algorithms/BoardWeightProvider';
import { TFLiteInferencer } from '../core/algorithms/TFLiteInferencer';

export class Preloader extends Scene
{
    constructor ()
    {
        super('Preloader');
    }

    init ()
    {
        const cx = this.cameras.main.width / 2;
        const cy = this.cameras.main.height / 2;

        this.add.rectangle(cx, cy, 300, 4, 0x333355);
        const bar = this.add.rectangle(cx - 148, cy, 4, 4, 0x6688ff);

        this.load.on('progress', (p: number) => {
            bar.width = 4 + 296 * p;
            bar.x = cx - 148 + bar.width / 2;
        });
    }

    preload ()
    {
        this.load.setPath('assets');

        // 合图 atlas（PNG + JSON）
        this.load.atlas('blocks',    'images/blocks/blocks_main.png',            'images/blocks/blocks_atlas.json');
        this.load.atlas('digits_y',  'images/numbers/digits_yellow.png',          'images/numbers/digits_yellow_atlas.json');
        this.load.atlas('digits_w',  'images/numbers/digits_white.png',           'images/numbers/digits_white_atlas.json');
        this.load.atlas('stars',     'images/ui/stars_icons.png',                 'images/ui/stars_icons_atlas.json');
        this.load.atlas('score_fx',  'images/effects/score_text.png',             'images/effects/score_text_atlas.json');
        this.load.atlas('diamonds',  'images/effects/block_diamonds.png',         'images/effects/block_diamonds_atlas.json');
        this.load.atlas('btns',      'images/ui/buttons_atlas.png',               'images/ui/buttons_atlas_atlas.json');
        this.load.atlas('board_ui',  'images/ui/board_ui_elements.png',           'images/ui/board_ui_atlas.json');

        // 单图（logo、独立按钮、特效文字直接用整图）
        this.load.image('logo',           'images/ui/logo.png');
        this.load.image('btn_classic',    'images/ui/btn_classic.png');
        this.load.image('btn_adventure',  'images/ui/btn_adventure.png');
        this.load.image('btn_pvp',        'images/ui/btn_pvp.png');
        this.load.image('text_combo',     'images/effects/text_combo.png');
        this.load.image('text_perfect',   'images/effects/text_perfect.png');
        this.load.image('text_bestscore', 'images/effects/text_bestscore.png');
        this.load.image('glow_blue',      'images/effects/glow_blue.png');

        // 关卡数据：default360 才有真实的 RequiredCollections 与变化的 levelTarget
        this.load.json('levels', 'data/default360.json');
        // 动态权重表（136 tier × 8 odds）
        this.load.json('weightcfg', 'data/weightcfg.json');
        // 游戏可调配置（算法采样次数 / factor / 形状权重 / 首发 / 音量 / 道具 / 星级）
        this.load.json('gameconfig', 'data/gameconfig.json');
        // LightGBM 棋盘复杂度模型（390 棵决策树，3MB） —— 原版 complex_model_1111_v1_new
        this.load.json('complex_model', 'data/complex_model.json');

        // 音效
        this.load.audio('sfx_place', 'audio/sfx_place.ogg');
        this.load.audio('sfx_clear', 'audio/sfx_clear.ogg');
        this.load.audio('sfx_combo', 'audio/sfx_combo.ogg');
        this.load.audio('sfx_over',  'audio/sfx_over.ogg');
        this.load.audio('bgm_main',  'audio/bgm_main.ogg');
    }

    create ()
    {
        // 初始化全局可调配置（在任何场景开始前）
        const cfg = this.cache.json.get('gameconfig');
        if (cfg) GameConfig.instance.init(cfg);
        // 初始化 LightGBM 棋盘评分器
        const lgbmForest = this.cache.json.get('complex_model');
        if (lgbmForest) BoardWeightProvider.instance.init(lgbmForest);
        // 异步加载 TFLite 神经网络（FILL/ADD3/DEATH 算法用）
        // 不等加载完就进 MainMenu —— 玩家先看主菜单的时间足够后台跑完，
        // 万一没跑完，算法层会自动回退到 bit-aware 启发式
        TFLiteInferencer.instance.init('/onnx-runtime/').catch((e) => {
            console.warn('[TFLite] init failed, falling back to bit-aware algorithms:', e);
        });
        this.scene.start('MainMenu');
    }
}
