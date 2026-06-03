// 神经网络推理包装 —— 5 个原版 TFLite 模型已离线转换为 ONNX
// （tfjs-tflite 0.0.1-alpha.10 太老带不动这些模型，会 Aborted）。
//
// 5 个 ONNX 文件来源：tf2onnx 从 .tflite 直接转，opset=15。
// 形状/行为与原版 1:1 一致：input [1,8,8,3] float32，output [1,43] float32。
//
// 用途映射：
//   FILL  → model_tkxc_v1  (填空消除主模型；v2/tiehe 是 A/B 变体)
//   ADD3  → model_sang     (熵增)
//   DEATH → model_death    (死亡难题/直觉难题)
//
// 接口名继续叫 TFLiteInferencer / TFLiteModelKey 是历史命名，
// 不想再把上下文里所有引用都改一遍。底层换成了 onnxruntime-web。

import { BinaryBoard } from '../BinaryBoard';
import { BlockShapeMap } from '../BlockShapeMap';

export enum TFLiteModelKey {
    FILL  = 'fill',
    ADD3  = 'add3',
    DEATH = 'death',
}

const MODEL_URLS: Record<TFLiteModelKey, string> = {
    [TFLiteModelKey.FILL]:  'assets/models/model_tkxc_v1.onnx',
    [TFLiteModelKey.ADD3]:  'assets/models/model_sang.onnx',
    [TFLiteModelKey.DEATH]: 'assets/models/model_death.onnx',
};

interface LoadedModel {
    session: any;        // ort.InferenceSession
    inputName: string;   // 'inputs_0'
    outputName: string;  // 'Identity'
    inputBuf: Float32Array;
    outputBuf: Float32Array;
}

export class TFLiteInferencer {
    private static _ins: TFLiteInferencer;
    static get instance(): TFLiteInferencer {
        if (!this._ins) this._ins = new TFLiteInferencer();
        return this._ins;
    }

    private ort: any = null;
    private models: Partial<Record<TFLiteModelKey, LoadedModel>> = {};
    private initialized = false;
    private initPromise: Promise<void> | null = null;

    isReady(key: TFLiteModelKey): boolean {
        return this.initialized && this.models[key] != null;
    }

    init(wasmPath = '/onnx-runtime/'): Promise<void> {
        if (this.initPromise) return this.initPromise;
        this.initPromise = this._doInit(wasmPath);
        return this.initPromise;
    }

    private async _doInit(wasmPath: string): Promise<void> {
        // 通过 <script> 加载 ort.wasm.min.js —— 仅 WASM 后端的精简 bundle
        // （ort.min.js 默认会拉 jsep/jspi/asyncify 多套 WASM 几十 MB）
        await this._loadScript(`${wasmPath}ort.wasm.min.js`);
        this.ort = (globalThis as any).ort;
        if (!this.ort) throw new Error('ONNX Runtime global not present after script load');

        // 告诉 ORT 去哪儿找它的 .wasm 文件
        this.ort.env.wasm.wasmPaths = wasmPath;
        // 限制为单线程，避免 SharedArrayBuffer / CORS 复杂度
        this.ort.env.wasm.numThreads = 1;

        const keys = [TFLiteModelKey.FILL, TFLiteModelKey.ADD3, TFLiteModelKey.DEATH];
        await Promise.all(keys.map((k) => this._loadModel(k)));
        this.initialized = true;
    }

    private _loadScript(src: string): Promise<void> {
        return new Promise((resolve, reject) => {
            if (document.querySelector(`script[data-onnx-vendor="${src}"]`)) { resolve(); return; }
            const s = document.createElement('script');
            s.src = src;
            s.async = true;
            s.dataset.onnxVendor = src;
            s.onload = () => resolve();
            s.onerror = () => reject(new Error(`Failed to load ${src}`));
            document.head.appendChild(s);
        });
    }

    private async _loadModel(key: TFLiteModelKey): Promise<void> {
        const url = MODEL_URLS[key];
        const session = await this.ort.InferenceSession.create(url, { executionProviders: ['wasm'] });
        this.models[key] = {
            session,
            inputName: session.inputNames[0],
            outputName: session.outputNames[0],
            inputBuf: new Float32Array(192),
            outputBuf: new Float32Array(43),
        };
    }

    /**
     * 主入口（异步）：给定模型 key + 棋盘 saveArr，返回 3 个 shape ID。
     * onnxruntime-web 的 session.run 是 async 的，无法做成 sync。
     *
     * 上层算法（FILL/ADD3/DEATH）若需要同步路径，会回退到 bit-aware；
     * 异步路径走这个方法。
     */
    async offerTrioAsync(key: TFLiteModelKey, saveArr: number[][], filterIds: number[] = [0]): Promise<number[]> {
        const m = this.models[key];
        if (!m) throw new Error(`Model ${key} not loaded`);

        const board = new BinaryBoard();
        board.convertFromArr(saveArr);

        m.inputBuf.fill(0);
        fillBuffer(m.inputBuf, 0, board);
        await this._runInference(m);
        applyFilter(m.outputBuf, filterIds);
        const f1 = argmax(m.outputBuf);

        board.rowBinary.fill(0);
        safePutTopLeft(board, f1);
        fillBuffer(m.inputBuf, 1, board);
        await this._runInference(m);
        applyFilter(m.outputBuf, filterIds);
        const f2 = argmax(m.outputBuf);

        board.rowBinary.fill(0);
        safePutTopLeft(board, f2);
        fillBuffer(m.inputBuf, 2, board);
        await this._runInference(m);
        applyFilter(m.outputBuf, filterIds);
        const f3 = argmax(m.outputBuf);

        return [f1, f2, f3];
    }

    /**
     * 同步入口 —— 实际上 ONNX 是异步，这里立即返回 null 让上层走 bit-aware。
     * 保留是因为现有调用点签名是 sync；想要 ML 输出请改调 offerTrioAsync。
     */
    offerTrio(_key: TFLiteModelKey, _saveArr: number[][]): number[] {
        throw new Error('offerTrio is sync-only stub; use offerTrioAsync for actual inference');
    }

    private async _runInference(m: LoadedModel): Promise<void> {
        // ort 的 Tensor 接受 Float32Array + 形状元组
        const inputTensor = new this.ort.Tensor('float32', m.inputBuf, [1, 8, 8, 3]);
        const feeds = { [m.inputName]: inputTensor };
        const results = await m.session.run(feeds);
        const out = results[m.outputName];
        m.outputBuf.set(out.data as Float32Array);
    }
}

// ─────────────────────────────────────────────────────────────────────────
// 工具函数（独立导出，供测试用）
// ─────────────────────────────────────────────────────────────────────────

export function fillBuffer(buf: Float32Array, channel: number, board: BinaryBoard): void {
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            buf[3 * (8 * r + c) + channel] = board.emptyAt(c, r) ? 0 : 1;
        }
    }
}

export function argmax(logits: Float32Array): number {
    let best = 0, bestVal = logits[0];
    for (let i = 1; i < logits.length; i++) {
        if (logits[i] > bestVal) { bestVal = logits[i]; best = i; }
    }
    return best;
}

export function applyFilter(logits: Float32Array, filterIds: number[]): void {
    for (const id of filterIds) {
        if (id >= 0 && id < logits.length) logits[id] = Number.NEGATIVE_INFINITY;
    }
}

function safePutTopLeft(board: BinaryBoard, shapeId: number): void {
    const s = BlockShapeMap.get(shapeId);
    if (!s) return;
    board.putBlock(shapeId, { x: 0, y: 0 });
}
