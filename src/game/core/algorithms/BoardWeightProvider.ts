// BoardWeightProvider —— 单例壳，把 LightGBM 模型加载/调用集中起来
// 对应原版 NewBoardWeightMethodCtr（main_bundle.js:335658+）

import { predictBoardWeight, getOldBoardWeight, LGBMTree } from './BoardWeightLGBM';

export class BoardWeightProvider {
    private static _ins: BoardWeightProvider;
    static get instance(): BoardWeightProvider {
        if (!this._ins) this._ins = new BoardWeightProvider();
        return this._ins;
    }

    private forest: LGBMTree[] | null = null;
    private initialized = false;

    /** Preloader 在 create() 阶段调一次 */
    init(forest: LGBMTree[]): void {
        this.forest = forest;
        this.initialized = true;
    }

    isInitialized(): boolean { return this.initialized && this.forest != null; }

    /**
     * 给定 8×8 saveArr 返回 boardWeight ∈ ~[0, 650]。
     * 模型未加载时回退到原版的启发式 getOldBoardWeight。
     */
    getBoardWeight(saveArr: number[][]): number {
        if (!this.forest) return getOldBoardWeight(saveArr);
        return predictBoardWeight(saveArr, this.forest);
    }

    /** 调试用：强制走老式启发式 */
    getOldOnly(saveArr: number[][]): number {
        return getOldBoardWeight(saveArr);
    }
}
