// comfyui-anima-t8 入口：注入 ComfyUI 扩展
import { app } from "../../scripts/app.js";
import { ComfyWidgets } from "../../scripts/widgets.js";
import { loadStyle, showToast } from "./components/tag_chip.js";
import { openPromptPanel } from "./components/prompt_panel.js";
import { openArtistGallery } from "./components/artist_gallery.js";

const STYLE_HREF = "/extensions/comfyui-anima-t8/styles/anima_t8.css";

function setWidgetValue(node, name, value) {
    const w = (node.widgets || []).find(w => w.name === name);
    if (!w) return false;
    w.value = value;
    if (w.callback) {
        try { w.callback(value, app.canvas, node); } catch (_) {}
    }
    node.setDirtyCanvas(true, true);
    return true;
}

// 将单条画师条目（可能为 "name" 或 "name:weight"）格式化为 @name 或 (@name:weight)
function formatArtistToken(line) {
    const t = (line || "").trim();
    if (!t) return "";
    const idx = t.lastIndexOf(":");
    if (idx > 0) {
        const name = t.slice(0, idx).trim();
        const weight = t.slice(idx + 1).trim();
        return weight ? `(@${name}:${weight})` : `@${name}`;
    }
    return `@${t}`;
}

// 把任意 token 形态（@wlop / (@wlop:1.1) / artist:wlop / wlop:1.2）
// 都化为纯 Danbooru tag name（wlop）。后端 _fetch_preview_pil 必须用纯名查图。
function _stripToRawName(s) {
    let t = (s || "").trim();
    if (!t) return "";
    if (t.startsWith("(") && t.endsWith(")")) t = t.slice(1, -1).trim();
    if (t.startsWith("@")) t = t.slice(1);
    if (t.startsWith("artist:")) t = t.slice("artist:".length);
    const ci = t.lastIndexOf(":");
    if (ci > 0) {
        const tail = t.slice(ci + 1).trim();
        if (/^[0-9.]+$/.test(tail)) t = t.slice(0, ci);
    }
    return t.trim();
}

// 累加去重写入 last_picked。已有 a, b 再追加 [b, c] → a, b, c。
function _appendLastPicked(node, lines) {
    const lp = (node.widgets || []).find(w => w.name === "last_picked");
    if (!lp) return false;
    const cur = (lp.value || "").trim();
    const existed = cur ? cur.split(/[\n,]+/).map(s => s.trim()).filter(Boolean) : [];
    (lines || []).forEach(l => {
        const raw = _stripToRawName(l);
        if (raw && !existed.includes(raw)) existed.push(raw);
    });
    lp.value = existed.join(", ");
    if (lp.callback) { try { lp.callback(lp.value, app.canvas, node); } catch (_) {} }
    return true;
}

function appendArtistsToWidget(node, name, artistLines) {
    const w = (node.widgets || []).find(w => w.name === name);
    if (!w) return false;
    // 同时按逗号和换行拆分已有内容，去重后用 ", " 拼接为单行
    const cur = (w.value || "").trim();
    const tokens = cur
        .split(/[\n,]+/)
        .map(s => s.trim())
        .filter(Boolean);
    artistLines.forEach(l => {
        const t = (l || "").trim();
        if (t && !tokens.includes(t)) tokens.push(t);
    });
    w.value = tokens.join(", ");
    if (w.callback) { try { w.callback(w.value, app.canvas, node); } catch (_) {} }
    // 同步累加 last_picked（去重）。
    // ⚠️ 后端 _fetch_preview_pil 会拿这个值去查 Danbooru，必须是纯 tag name。
    _appendLastPicked(node, artistLines);
    node.setDirtyCanvas(true, true);
    return true;
}

// 累加式写 last_picked widget（去重），强制 strip 为纯 tag name。
// 适用于作品 IP / 角色 IP / 风格·meta 这类非画师 token：
//   不写 artist_tags（避免污染 STYLE_PROMPT），仅追加 last_picked 让节点运行时拉预览图。
function setLastPickedRaw(node, lines) {
    const ok = _appendLastPicked(node, lines);
    if (!ok) return false;
    node.setDirtyCanvas(true, true);
    return true;
}

function applyPromptToNode(node, p) {
    if (!node || !p) return;
    setWidgetValue(node, "positive", p.positive_prompt || "");
    setWidgetValue(node, "negative", p.negative_prompt || "");
    setWidgetValue(node, "style", p.artist_prompt || "");
    showToast("已应用：" + (p.title || ""));
}

const ANIMA_NODES = new Set([
    "AnimaPromptT8",
    "AnimaArtistStyleT8",
    "AnimaPromptCombinerT8",
    "AnimaSavedPromptLoaderT8",
]);

const COMBINER_PART_PREFIX = "part_";
const COMBINER_MIN_PARTS = 2;
const COMBINER_MAX_PARTS = 20;
const COMBINER_CONTROL_NAME = "parts";

function getCombinerPartWidgets(node) {
    return (node.widgets || []).filter(w => w.name?.startsWith(COMBINER_PART_PREFIX));
}

function getCombinerPartInputs(node) {
    return (node.inputs || []).filter(input => input.name?.startsWith(COMBINER_PART_PREFIX));
}

function combinerPartIndex(name) {
    const m = /^part_(\d+)$/.exec(name || "");
    return m ? parseInt(m[1], 10) : 0;
}

function getCombinerPartCount(node) {
    let max = 0;
    for (const part of [...getCombinerPartWidgets(node), ...getCombinerPartInputs(node)]) {
        max = Math.max(max, combinerPartIndex(part.name));
    }
    return max;
}

function nextCombinerPartName(node) {
    return `${COMBINER_PART_PREFIX}${getCombinerPartCount(node) + 1}`;
}

function renumberCombinerParts(node) {
    const parts = [...getCombinerPartWidgets(node), ...getCombinerPartInputs(node)].sort(
        (a, b) => combinerPartIndex(a.name) - combinerPartIndex(b.name)
    );
    parts.forEach((part, i) => {
        part.name = `${COMBINER_PART_PREFIX}${i + 1}`;
    });
}

function removeCombinerWidget(node, widget) {
    const idx = (node.widgets || []).indexOf(widget);
    if (idx < 0) return;
    widget.onRemove?.();
    node.widgets.splice(idx, 1);
}

function insertCombinerControlAtStart(node, widget) {
    const widgets = node.widgets || [];
    const currentIdx = widgets.indexOf(widget);
    if (currentIdx >= 0) {
        widgets.splice(currentIdx, 1);
    }

    const firstPartIdx = widgets.findIndex(w => w.name?.startsWith(COMBINER_PART_PREFIX));
    const sepIdx = widgets.findIndex(w => w.name === "separator");
    let targetIdx = 0;
    if (firstPartIdx >= 0) {
        targetIdx = firstPartIdx;
    } else if (sepIdx >= 0) {
        targetIdx = sepIdx + 1;
    }
    widgets.splice(targetIdx, 0, widget);
}

function redrawCombiner(node) {
    node.setDirtyCanvas(true, true);
}

function createCombinerControlWidget(node) {
    return {
        name: COMBINER_CONTROL_NAME,
        type: "custom",
        value: null,
        options: { serialize: false },
        computeSize: () => [0, 26],
        draw(ctx, _node, width, y, height) {
            const margin = 15;
            const gap = 8;
            const buttonWidth = (width - margin * 2 - gap) / 2;
            const buttonHeight = Math.max(20, height - 4);
            const top = y + 2;
            const labels = ["-", "+"];

            ctx.save();
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.font = "14px sans-serif";

            for (let i = 0; i < 2; i += 1) {
                const left = margin + i * (buttonWidth + gap);
                ctx.fillStyle = LiteGraph.WIDGET_BGCOLOR;
                ctx.strokeStyle = LiteGraph.WIDGET_OUTLINE_COLOR;
                ctx.beginPath();
                ctx.roundRect(left, top, buttonWidth, buttonHeight, 6);
                ctx.fill();
                ctx.stroke();
                ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR;
                ctx.fillText(labels[i], left + buttonWidth / 2, top + buttonHeight / 2);
            }

            ctx.restore();
        },
        mouse(event, pos) {
            if (event.type !== "pointerdown" && event.type !== "mousedown") return false;
            const width = node.size?.[0] || 200;
            const isMinus = pos[0] < width / 2;
            if (isMinus) {
                if (removeCombinerPart(node)) {
                    showToast(`已减少为 ${getCombinerPartCount(node)} 段`);
                }
            } else if (addCombinerPartWidget(node)) {
                showToast(`已增加至 ${getCombinerPartCount(node)} 段`);
            } else {
                showToast(`最多 ${COMBINER_MAX_PARTS} 段`);
            }
            redrawCombiner(node);
            return true;
        },
    };
}

function addCombinerPartWidget(node) {
    if (getCombinerPartCount(node) >= COMBINER_MAX_PARTS) return false;
    const name = nextCombinerPartName(node);
    ComfyWidgets.STRING(node, name, ["STRING", { multiline: true, default: "" }], app);
    redrawCombiner(node);
    return true;
}

function removeCombinerPart(node) {
    const parts = [...getCombinerPartWidgets(node), ...getCombinerPartInputs(node)]
        .sort((a, b) => combinerPartIndex(a.name) - combinerPartIndex(b.name));
    if (parts.length <= COMBINER_MIN_PARTS) return false;
    const last = parts[parts.length - 1];
    const inputIdx = (node.inputs || []).indexOf(last);
    if (inputIdx >= 0) {
        node.removeInput(inputIdx);
    } else {
        removeCombinerWidget(node, last);
    }
    renumberCombinerParts(node);
    redrawCombiner(node);
    return true;
}

function setupCombinerDynamicParts(node) {
    for (const widget of [...(node.widgets || [])]) {
        if (
            (widget.type === "button" && (widget.name === "-" || widget.name === "+")) ||
            widget.name === COMBINER_CONTROL_NAME
        ) {
            removeCombinerWidget(node, widget);
        }
    }

    const parts = getCombinerPartWidgets(node).sort(
        (a, b) => combinerPartIndex(a.name) - combinerPartIndex(b.name)
    );
    const valueByIndex = new Map();
    for (const part of parts) {
        const idx = combinerPartIndex(part.name);
        if (idx < 1 || idx > COMBINER_MAX_PARTS) continue;
        valueByIndex.set(idx, part.value ?? "");
    }

    let keepCount = COMBINER_MIN_PARTS;
    for (const [idx, val] of valueByIndex.entries()) {
        if (typeof val === "string" && val.trim()) {
            keepCount = Math.max(keepCount, idx);
        }
    }
    for (const input of getCombinerPartInputs(node)) {
        const idx = combinerPartIndex(input.name);
        if (idx >= 1 && idx <= COMBINER_MAX_PARTS && input.link != null) {
            keepCount = Math.max(keepCount, idx);
        }
    }

    for (const widget of parts) {
        removeCombinerWidget(node, widget);
    }
    for (let i = 1; i <= keepCount; i += 1) {
        const w = ComfyWidgets.STRING(
            node,
            `${COMBINER_PART_PREFIX}${i}`,
            ["STRING", { multiline: true, default: "" }],
            app
        ).widget;
        w.value = valueByIndex.get(i) ?? "";
    }

    for (const input of [...getCombinerPartInputs(node)]) {
        if (combinerPartIndex(input.name) > keepCount && input.link == null) {
            const inputIdx = (node.inputs || []).indexOf(input);
            if (inputIdx >= 0) node.removeInput(inputIdx);
        }
    }
    renumberCombinerParts(node);

    const control = createCombinerControlWidget(node);
    insertCombinerControlAtStart(node, control);
    redrawCombiner(node);
}

app.registerExtension({
    name: "comfyui.anima.t8",
    async setup() {
        loadStyle(STYLE_HREF);

        // 全局菜单按钮
        if (app.menu && app.menu.element) {
            const wrap = document.createElement("div");
            wrap.style.cssText = "display:flex;gap:6px;margin:4px 0;";
            const btn1 = document.createElement("button");
            btn1.className = "comfy-button"; btn1.textContent = "📚 Anima 风格库";
            btn1.addEventListener("click", () => openPromptPanel({ onApply: (p) => {
                const node = findActiveAnimaPromptNode();
                if (node) applyPromptToNode(node, p);
                else showToast("请在画布中选中 Anima Prompt T8 节点");
            }}));
            const btn2 = document.createElement("button");
            btn2.className = "comfy-button"; btn2.textContent = "🎨 Anima 艺术家库";
            btn2.addEventListener("click", () => openArtistGallery({ onApply: (lines, meta = {}) => {
                const isArtist = meta.isArtist !== false;
                if (isArtist) {
                    const node = findActiveAnimaArtistNode();
                    const artistTokens = lines.map(formatArtistToken).filter(Boolean);
                    if (node) { appendArtistsToWidget(node, "artist_tags", artistTokens); return; }
                    const pn = findActiveAnimaPromptNode();
                    if (pn) {
                        const w = (pn.widgets || []).find(w => w.name === "style");
                        if (w) {
                            const cur = (w.value || "").trim();
                            const merged = (cur ? cur + ", " : "") + artistTokens.join(", ");
                            setWidgetValue(pn, "style", merged);
                            return;
                        }
                    }
                    showToast("请在画布中选中 Anima 节点");
                } else {
                    // 作品 IP / 角色 IP：写入 positive widget，不加 artist: 前缀
                    const pn = findActiveAnimaPromptNode();
                    if (pn) {
                        const w = (pn.widgets || []).find(w => w.name === "positive");
                        if (w) {
                            const cur = (w.value || "").trim();
                            const segs = lines.map(l => {
                                const idx = l.lastIndexOf(":");
                                if (idx > 0) {
                                    const name = l.slice(0, idx), wv = l.slice(idx + 1);
                                    return `(${name}:${wv})`;
                                }
                                return l;
                            });
                            const merged = (cur ? cur + ", " : "") + segs.join(", ");
                            setWidgetValue(pn, "positive", merged);
                            return;
                        }
                    }
                    showToast("请在画布中选中 Anima Prompt T8 节点");
                }
            }}));
            wrap.append(btn1, btn2);
            try { app.menu.element.append(wrap); } catch (_) {}
        }
    },

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (!ANIMA_NODES.has(nodeData.name)) return;

        const onCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = onCreated ? onCreated.apply(this, arguments) : undefined;
            const self = this;
            try {
                if (nodeData.name === "AnimaPromptT8") {
                    addBtn(self, "📚 风格库", () => openPromptPanel({
                        onApply: (p) => applyPromptToNode(self, p),
                    }));
                    addBtn(self, "🎨 艺术家 / IP 库", () => openArtistGallery({
                        onApply: (lines, meta = {}) => {
                            const isArtist = meta.isArtist !== false;
                            const targetName = isArtist ? "style" : "positive";
                            const w = (self.widgets || []).find(w => w.name === targetName);
                            if (!w) return;
                            const cur = (w.value || "").trim();
                            const segs = lines.map(l => {
                                const idx = l.lastIndexOf(":");
                                let name = l, weight = "";
                                if (idx > 0) { name = l.slice(0, idx); weight = l.slice(idx + 1); }
                                if (isArtist) {
                                    return formatArtistToken(l);
                                }
                                return weight ? `(${name}:${weight})` : name;
                            });
                            const merged = (cur ? cur + ", " : "") + segs.join(", ");
                            setWidgetValue(self, targetName, merged);
                        }
                    }));
                } else if (nodeData.name === "AnimaArtistStyleT8") {
                    addBtn(self, "🎨 艺术家库", () => openArtistGallery({
                        onApply: (lines, meta = {}) => {
                            const isArtist = meta.isArtist !== false;
                            if (isArtist) {
                                // 画师类：写 artist_tags（带 @）+ last_picked（纯 name）
                                const artistTokens = lines.map(formatArtistToken).filter(Boolean);
                                appendArtistsToWidget(self, "artist_tags", artistTokens);
                                return;
                            }
                            // 非画师类（作品 IP / 角色 / meta）：
                            // 1) 覆盖式写 last_picked→ PREVIEW_IMAGES 拉 Danbooru 预览图
                            // 2) 不写 artist_tags（避免污染 STYLE_PROMPT）
                            // 3) 如画布上有 AnimaPromptT8，顺手写入其 positive widget方便组装提示词
                            setLastPickedRaw(self, lines);
                            const pn = findActiveAnimaPromptNode();
                            if (pn) {
                                const w = (pn.widgets || []).find(w => w.name === "positive");
                                if (w) {
                                    const cur = (w.value || "").trim();
                                    const segs = lines.map(l => {
                                        const idx = l.lastIndexOf(":");
                                        if (idx > 0) {
                                            const name = l.slice(0, idx), wv = l.slice(idx + 1);
                                            return `(${name}:${wv})`;
                                        }
                                        return l;
                                    });
                                    setWidgetValue(pn, "positive", (cur ? cur + ", " : "") + segs.join(", "));
                                }
                            }
                            showToast("已加入预览图列表，运行节点查看");
                        },
                    }));
                } else if (nodeData.name === "AnimaPromptCombinerT8") {
                    setTimeout(() => setupCombinerDynamicParts(self), 0);
                } else if (nodeData.name === "AnimaSavedPromptLoaderT8") {
                    addBtn(self, "📚 风格库", () => openPromptPanel({}));
                }
            } catch (e) {
                console.warn("[anima_t8] init node btn error:", e);
            }
            return r;
        };

        if (nodeData.name === "AnimaPromptCombinerT8") {
            const onConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function () {
                const r = onConfigure ? onConfigure.apply(this, arguments) : undefined;
                setTimeout(() => setupCombinerDynamicParts(this), 0);
                return r;
            };
        }
    },
});

function addBtn(node, text, cb) {
    node.addWidget("button", text, null, cb, { serialize: false });
}

function findActiveAnimaPromptNode() {
    const sel = app.canvas?.selected_nodes;
    if (sel) {
        for (const id in sel) {
            const n = sel[id];
            if (n && (n.comfyClass === "AnimaPromptT8" || n.type === "AnimaPromptT8")) return n;
        }
    }
    const nodes = app.graph?._nodes || [];
    return nodes.find(n => n.comfyClass === "AnimaPromptT8" || n.type === "AnimaPromptT8");
}

function findActiveAnimaArtistNode() {
    const sel = app.canvas?.selected_nodes;
    if (sel) {
        for (const id in sel) {
            const n = sel[id];
            if (n && (n.comfyClass === "AnimaArtistStyleT8" || n.type === "AnimaArtistStyleT8")) return n;
        }
    }
    const nodes = app.graph?._nodes || [];
    return nodes.find(n => n.comfyClass === "AnimaArtistStyleT8" || n.type === "AnimaArtistStyleT8");
}
