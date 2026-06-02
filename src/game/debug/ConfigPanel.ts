// 浏览器内实时编辑配置面板：右侧抽屉 + 按字段滑块/输入框 + 导出 JSON
// 与 Phaser 解耦：纯 DOM 注入，写 GameConfig.instance
import { GameConfig, FactorEntry } from '../core/GameConfig';
import { ALGORITHM_NAME } from '../core/algorithms/types';
import { GameState } from '../core/GameState';
import { DynamicWeightDiff } from '../core/DynamicWeightDiff';

const ALGO_NAMES = Object.values(ALGORITHM_NAME).filter((v) => typeof v === 'string') as string[];

/** 8 种算法的中文解释 */
const ALGO_DESC: Record<string, string> = {
    FILL:                '填空消除 · 找能触发最大消除的 trio',
    RANDOM_NO_DIE:       '随机无死亡 · 加权随机 + 保证至少 1 块能放',
    ADD3:                '熵增算法 · 选使棋盘乱度最大的 trio (隐性逼死)',
    EASY_DIFF:           '简单难题 · 解多 (≥5) 的 trio,需思考但不难',
    DIFF:                '困难难题 · 解很少 (1-3) 的 trio,需小心选序',
    STRAIGHT_DEATH_DIFF: '直觉死亡难题 · 恰好 1 个合法解,错一步必死',
    CLEAR_ALL:           '清盘 Plus · 给你能清空整个棋盘的 trio',
    ALL_COMBINATION:     '全组合填空消除 · FILL 升级,深度搜索最大消除',
};

let mounted = false;

export function mountConfigPanel(): void {
    if (mounted) return;
    mounted = true;

    // 等 GameConfig 初始化（Preloader 完成之后）
    const tryInit = () => {
        const cfg = GameConfig.instance;
        if (!cfg.isInitialized()) {
            setTimeout(tryInit, 100);
            return;
        }
        buildPanel(cfg);
    };
    tryInit();
}

function buildPanel(cfg: GameConfig): void {
    // ─── 样式注入 ────────────────────────────────────────────────
    const style = document.createElement('style');
    style.textContent = `
.cfg-toggle {
    position: fixed; top: 12px; right: 12px; z-index: 99999;
    width: 44px; height: 44px; border: none; cursor: pointer;
    background: #2a2a55; color: #eef; font-size: 20px; border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4); font-weight: bold;
    transition: background 0.15s, transform 0.15s;
}
.cfg-toggle:hover { background: #3a3a77; transform: scale(1.05); }

.cfg-drawer {
    position: fixed; top: 0; right: -480px; width: 460px; height: 100vh;
    background: #1a1a2e; color: #cce; z-index: 99998;
    overflow-y: auto; box-shadow: -4px 0 16px rgba(0,0,0,0.5);
    transition: right 0.25s ease-out;
    font-family: 'Segoe UI', system-ui, sans-serif; font-size: 13px;
    padding: 50px 16px 24px;
}
.cfg-drawer.open { right: 0; }

.cfg-drawer h2 { margin: 0 0 8px; color: #aaccff; font-size: 16px; }
.cfg-drawer h3 {
    margin: 16px 0 6px; padding: 6px 8px; color: #ffd966; font-size: 13px;
    background: #232347; border-radius: 4px; cursor: pointer;
    display: flex; justify-content: space-between; align-items: center;
}
.cfg-drawer h3::after { content: '▼'; font-size: 10px; color: #889; }
.cfg-drawer h3.collapsed::after { content: '▶'; }
.cfg-section { padding: 4px 8px; }
.cfg-section.collapsed { display: none; }

.cfg-section-desc {
    color: #88aacc; font-size: 11px; line-height: 1.5;
    margin: 4px 0 10px; padding: 6px 8px;
    background: rgba(40, 60, 100, 0.25); border-left: 2px solid #4477aa;
    border-radius: 2px; font-style: italic;
}
.cfg-row-desc {
    color: #889; font-size: 10px; margin: 6px 0 0; padding-left: 4px; font-style: italic;
}

.cfg-row {
    display: flex; align-items: center; gap: 6px; margin: 4px 0;
    font-size: 12px;
}
.cfg-row label { flex: 0 0 130px; color: #aab; }
.cfg-row-algo { display: block; padding: 8px 0 6px; border-bottom: 1px dashed #333; }
.cfg-algo-name { color: #ffd966; font-weight: bold; font-size: 12px; margin-bottom: 2px; }
.cfg-algo-desc { color: #88a; font-size: 10px; font-style: italic; line-height: 1.4; margin-bottom: 6px; }
.cfg-algo-inputs { display: flex; gap: 6px; align-items: center; }
.cfg-algo-inputs label { flex: 0 0 70px; color: #aab; font-size: 11px; }
.cfg-row input[type="number"], .cfg-row input[type="text"] {
    flex: 1; padding: 3px 6px; background: #0e0e22; color: #cce;
    border: 1px solid #334; border-radius: 3px; font-size: 12px;
    font-family: monospace;
}
.cfg-row input:focus { outline: none; border-color: #66aaff; }

.cfg-actions {
    position: sticky; bottom: 0; background: #1a1a2e;
    padding: 12px 0 8px; margin-top: 16px;
    border-top: 1px solid #334;
    display: flex; gap: 8px;
}
.cfg-btn {
    flex: 1; padding: 8px; border: none; border-radius: 4px;
    cursor: pointer; font-weight: bold; font-size: 12px;
}
.cfg-btn-reset  { background: #aa3344; color: white; }
.cfg-btn-export { background: #4477ff; color: white; }
.cfg-btn-close  { background: #444466; color: #ccc; }

.cfg-row-note { color: #678; font-size: 11px; margin-left: 6px; }
.cfg-tabular { font-family: monospace; }
`;
    document.head.appendChild(style);

    // ─── 切换按钮 ──────────────────────────────────────────────
    const toggle = document.createElement('button');
    toggle.className = 'cfg-toggle';
    toggle.title = 'Open Config Panel';
    toggle.textContent = '⚙';
    document.body.appendChild(toggle);

    // ─── 抽屉 ──────────────────────────────────────────────────
    const drawer = document.createElement('div');
    drawer.className = 'cfg-drawer';
    document.body.appendChild(drawer);

    toggle.onclick = () => drawer.classList.toggle('open');

    // ─── 内容 ──────────────────────────────────────────────────
    function render(): void {
        const c = cfg.get();
        drawer.innerHTML = '<h2>⚙ Game Config (Live)</h2>'
            + '<p style="font-size:11px;color:#789;margin:0 0 12px">改完即时生效。已保存到 localStorage，刷新仍在。</p>';

        // Dynamic
        appendSection(drawer, 'Dynamic system', (sec) => {
            appendNumber(sec, 'activationScore', '激活分数门槛', c.dynamic.activationScore, (v) => {
                cfg.set({ dynamic: { ...c.dynamic, activationScore: v } });
            }, 0, 100000, 100);
        }, '分数 <strong>≥</strong> 这个值才会启用 8 算法 tier 调度;低于阈值都用 RANDOM_NO_DIE。<br>原游戏值为 <strong>1000</strong>。');

        // Factor list
        appendSection(drawer, 'Algorithm dynW factors (basic / consecutive)', (sec) => {
            for (const name of ALGO_NAMES) {
                const f = (c.dynamic.factorList[name] || { basic: 0, consecutive: 0 }) as FactorEntry;
                const wrapper = document.createElement('div');
                wrapper.className = 'cfg-row-algo';
                const nameEl = document.createElement('div');
                nameEl.className = 'cfg-algo-name';
                nameEl.textContent = name;
                const descEl = document.createElement('div');
                descEl.className = 'cfg-algo-desc';
                descEl.textContent = ALGO_DESC[name] ?? '';
                const inputs = document.createElement('div');
                inputs.className = 'cfg-algo-inputs';
                const lab1 = document.createElement('label'); lab1.textContent = 'basic';
                const lab2 = document.createElement('label'); lab2.textContent = 'consec';
                const b = makeNumberInput(f.basic, (v) => patchFactor(name, { basic: v, consecutive: f.consecutive }));
                const cInput = makeNumberInput(f.consecutive, (v) => patchFactor(name, { basic: f.basic, consecutive: v }));
                inputs.append(lab1, b, lab2, cInput);
                wrapper.append(nameEl, descEl, inputs);
                sec.appendChild(wrapper);
            }
        }, '每次某算法被选中后,会把对应的<strong>增量</strong>加到 dynamicWeight 累积值。'
         + '<br>· <strong>basic</strong>: 首次或换向时用<br>· <strong>consecutive</strong>: 同向连续时用(较小)<br>'
         + '正值=变难方向(向"困难"档迁移),负值=变易方向。<br>'
         + 'FILL/CLEAR_ALL/EASY 是奖励算法→正值;DIFF/DEATH/ADD3 是惩罚算法→负值。');

        // Samples
        appendSection(drawer, 'Algorithm sample counts', (sec) => {
            for (const name of ALGO_NAMES) {
                const v = c.dynamic.algorithmSamples[name] ?? 50;
                const wrapper = document.createElement('div');
                wrapper.className = 'cfg-row-algo';
                const nameEl = document.createElement('div');
                nameEl.className = 'cfg-algo-name';
                nameEl.textContent = name;
                const descEl = document.createElement('div');
                descEl.className = 'cfg-algo-desc';
                descEl.textContent = ALGO_DESC[name] ?? '';
                const inputs = document.createElement('div');
                inputs.className = 'cfg-algo-inputs';
                const lab = document.createElement('label'); lab.textContent = 'samples';
                const inp = makeNumberInput(v, (nv) => {
                    cfg.set({ dynamic: { ...c.dynamic, algorithmSamples: { ...c.dynamic.algorithmSamples, [name]: nv } } });
                }, 1, 1000, 10);
                inputs.append(lab, inp);
                wrapper.append(nameEl, descEl, inputs);
                sec.appendChild(wrapper);
            }
        }, '每种算法生成 trio 时<strong>采样多少候选 trio</strong> 来评分挑最优。'
         + '<br>越高越接近目标但越慢;通常 50-200 已足够。'
         + '<br>需要"准"的(如 STRAIGHT_DEATH 找恰好 1 解)给高值,简单的给低值。');

        // Shape weights
        appendSection(drawer, 'Shape pool weights (by cell count)', (sec) => {
            for (const k of ['1', '2', '3', '4', '5', '6+']) {
                const v = c.shapeWeights[k] ?? 1;
                appendNumber(sec, k, `${k} 格权重`, v, (nv) => {
                    cfg.set({ shapeWeights: { ...c.shapeWeights, [k]: nv } });
                }, 0, 50, 1);
            }
        }, '每个候选方块按这个权重随机抽形状。<br>权重越高出现频率越高。'
         + '<br>默认 1 格→12, 2 格→9, 3 格→7, 4 格→5, 5 格→3, 6 格以上→2;小块占主导。'
         + '<br>想让大块更频繁?把 5/6+ 调到 8+。');

        // First hand
        appendSection(drawer, 'First hand shape IDs', (sec) => {
            appendText(sec, 'firstHand', '首发 (逗号分隔)', c.firstHand.join(','), (s) => {
                const ids = s.split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n));
                if (ids.length === 3) cfg.set({ firstHand: ids });
            }, '需 3 个整数');
        }, '新玩家进 Classic 时第一波 3 个方块的 shape ID 数组。<br>'
         + '原游戏值 <strong>[9, 39, 24]</strong>(2×2 实 / 3×3 对角 / 3×3 L)。'
         + '<br>shape ID 见 <code>BlockShapeMap.ts</code>(1=1×1, 11=5×1, 13=3×3 实心 …)。');

        // Tools
        appendSection(drawer, 'Tools', (sec) => {
            appendNumber(sec, 'refreshCount', '刷新道具次数', c.tools.refreshCount, (v) => {
                cfg.set({ tools: { ...c.tools, refreshCount: v } });
            }, 0, 99, 1);
            appendNumber(sec, 'hammerCount', '锤子道具次数', c.tools.hammerCount, (v) => {
                cfg.set({ tools: { ...c.tools, hammerCount: v } });
            }, 0, 99, 1);
            appendNumber(sec, 'lightningCount', '闪电道具次数', c.tools.lightningCount, (v) => {
                cfg.set({ tools: { ...c.tools, lightningCount: v } });
            }, 0, 99, 1);
        }, '每局开局给玩家的<strong>道具初始数量</strong>。'
         + '<br>· 🔄 刷新 — 倒空 3 槽重抽<br>· 🔨 锤子 — 删单格<br>· ⚡ 闪电 — 清整行+整列十字');

        // Stars
        appendSection(drawer, 'Star thresholds (target × ratio)', (sec) => {
            const labels = ['1★', '2★', '3★'];
            for (let i = 0; i < 3; i++) {
                appendNumberFloat(sec, `ratio${i}`, `${labels[i]} 倍率`, c.stars.ratios[i], (v) => {
                    const newRatios = [...c.stars.ratios] as [number, number, number];
                    newRatios[i] = v;
                    cfg.set({ stars: { ratios: newRatios } });
                }, 0.1, 10, 0.1);
            }
        }, '分数模式关卡星级阈值 = <strong>levelTarget × 倍率</strong>。'
         + '<br>例:target=100,倍率 [1.0, 1.5, 2.0] → 1★ 需 100,2★ 需 150,3★ 需 200。'
         + '<br>收集模式星级按"步数效率"另算,不受这里影响。');

        // Audio
        appendSection(drawer, 'Audio volumes (0~1)', (sec) => {
            appendNumberFloat(sec, 'sfx', '音效音量', c.audio.sfxVolume, (v) => {
                cfg.set({ audio: { ...c.audio, sfxVolume: v } });
            }, 0, 1, 0.05);
            appendNumberFloat(sec, 'bgm', 'BGM 音量', c.audio.bgmVolume, (v) => {
                cfg.set({ audio: { ...c.audio, bgmVolume: v } });
            }, 0, 1, 0.05);
        }, '音量基数。<br>· 落子 = sfx × 1.0<br>· 消除 = sfx × 1.2<br>· 刷新道具 = sfx × 0.8<br>· BGM 单独。'
         + '<br>当前所有 sfx/bgm 文件本地缺失,实际无声;接入文件后才生效。');

        // H3 Save management
        appendSection(drawer, 'Saved state', (sec) => {
            const row1 = document.createElement('div');
            row1.style.padding = '6px 0';
            const clearSessions = document.createElement('button');
            clearSessions.className = 'cfg-btn cfg-btn-reset';
            clearSessions.textContent = 'Clear all in-progress saves';
            clearSessions.onclick = () => {
                if (confirm('清掉所有"局内进度"存档？下一局重新开始。\n（不影响章节进度和最高分）')) {
                    GameState.clearAllSessions();
                    alert('已清。');
                }
            };
            row1.appendChild(clearSessions);
            sec.appendChild(row1);

            const row2 = document.createElement('div');
            row2.style.padding = '6px 0';
            const resetDyn = document.createElement('button');
            resetDyn.className = 'cfg-btn cfg-btn-reset';
            resetDyn.textContent = 'Reset dynamicWeight';
            resetDyn.onclick = () => {
                DynamicWeightDiff.instance.reset();
                alert('dynamicWeight 已清零。');
            };
            row2.appendChild(resetDyn);
            sec.appendChild(row2);

            const row3 = document.createElement('div');
            row3.style.padding = '6px 0';
            const resetAll = document.createElement('button');
            resetAll.className = 'cfg-btn cfg-btn-reset';
            resetAll.textContent = 'Reset ALL save data ⚠️';
            resetAll.onclick = () => {
                if (confirm('⚠️ 清掉一切：章节进度 / 最高分 / 星级 / 局内进度 / dynamicWeight\n确认？')) {
                    GameState.clearAllSessions();
                    DynamicWeightDiff.instance.reset();
                    try {
                        localStorage.removeItem('block_blast_save_v1');
                        localStorage.removeItem('block_blast_dynamic_v1');
                    } catch { /* ignore */ }
                    alert('全部清空，刷新页面生效。');
                }
            };
            row3.appendChild(resetAll);
            sec.appendChild(row3);
        }, '⚠️ 危险区:三个按钮分别清不同档存档,不能撤销。'
         + '<br>· <strong>Clear all in-progress saves</strong> = 局内进度(玩到一半的关卡状态)<br>'
         + '· <strong>Reset dynamicWeight</strong> = 动态算法累积值<br>'
         + '· <strong>Reset ALL</strong> = 全清,刷新即重新开始');

        // Actions
        const actions = document.createElement('div');
        actions.className = 'cfg-actions';
        const resetBtn = document.createElement('button');
        resetBtn.className = 'cfg-btn cfg-btn-reset';
        resetBtn.textContent = 'Reset to JSON';
        resetBtn.onclick = () => {
            if (confirm('放弃所有改动，恢复到 gameconfig.json 默认值？')) {
                cfg.reset();
            }
        };
        const exportBtn = document.createElement('button');
        exportBtn.className = 'cfg-btn cfg-btn-export';
        exportBtn.textContent = 'Export JSON';
        exportBtn.onclick = () => {
            const blob = new Blob([cfg.export()], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'gameconfig.json';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        };
        const closeBtn = document.createElement('button');
        closeBtn.className = 'cfg-btn cfg-btn-close';
        closeBtn.textContent = 'Close';
        closeBtn.onclick = () => drawer.classList.remove('open');
        actions.append(resetBtn, exportBtn, closeBtn);
        drawer.appendChild(actions);
    }

    function patchFactor(name: string, value: FactorEntry): void {
        const c = cfg.get();
        cfg.set({ dynamic: { ...c.dynamic, factorList: { ...c.dynamic.factorList, [name]: value } } });
    }

    // 任何 GameConfig.set 都重渲染面板
    cfg.onChange(() => render());
    render();
}

// ─── 工具函数 ────────────────────────────────────────────────
function appendSection(parent: HTMLElement, title: string, body: (sec: HTMLElement) => void, description?: string): void {
    const h = document.createElement('h3');
    h.textContent = title;
    parent.appendChild(h);
    const sec = document.createElement('div');
    sec.className = 'cfg-section';
    if (description) {
        const desc = document.createElement('div');
        desc.className = 'cfg-section-desc';
        desc.innerHTML = description;
        sec.appendChild(desc);
    }
    body(sec);
    parent.appendChild(sec);
    h.onclick = () => {
        h.classList.toggle('collapsed');
        sec.classList.toggle('collapsed');
    };
}

function makeNumberInput(value: number, onCommit: (v: number) => void, min = -99999, max = 99999, step = 1): HTMLInputElement {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.value = String(value);
    inp.min = String(min); inp.max = String(max); inp.step = String(step);
    inp.style.flex = '1';
    inp.onchange = () => {
        const v = parseFloat(inp.value);
        if (!isNaN(v)) onCommit(v);
    };
    return inp;
}

function appendNumber(parent: HTMLElement, _id: string, label: string, value: number,
                     onCommit: (v: number) => void, min = -99999, max = 99999, step = 1): void {
    const row = document.createElement('div');
    row.className = 'cfg-row';
    const lab = document.createElement('label'); lab.textContent = label;
    const inp = makeNumberInput(value, onCommit, min, max, step);
    row.append(lab, inp);
    parent.appendChild(row);
}

function appendNumberFloat(parent: HTMLElement, id: string, label: string, value: number,
                          onCommit: (v: number) => void, min = 0, max = 10, step = 0.1): void {
    appendNumber(parent, id, label, value, onCommit, min, max, step);
}

function appendText(parent: HTMLElement, _id: string, label: string, value: string,
                    onCommit: (v: string) => void, note?: string): void {
    const row = document.createElement('div');
    row.className = 'cfg-row';
    const lab = document.createElement('label'); lab.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = value;
    inp.onchange = () => onCommit(inp.value);
    row.append(lab, inp);
    if (note) {
        const n = document.createElement('span');
        n.className = 'cfg-row-note';
        n.textContent = note;
        row.appendChild(n);
    }
    parent.appendChild(row);
}

