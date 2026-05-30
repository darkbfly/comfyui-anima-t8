// comfyui-anima-t8 入口：注入 ComfyUI 扩展
import { app } from "../../scripts/app.js";
import { loadStyle, showToast } from "./components/tag_chip.js";
import { openPromptPanel } from "./components/prompt_panel.js";
import { openArtistGallery } from "./components/artist_gallery.js";
import { openGelbooruGallery } from "./components/gelbooru_gallery.js";

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

function formatPlainWeightedToken(line) {
    const t = (line || "").trim();
    if (!t) return "";
    const idx = t.lastIndexOf(":");
    if (idx > 0) {
        const name = t.slice(0, idx).trim();
        const weight = t.slice(idx + 1).trim();
        return `(${name}:${weight})`;
    }
    return t;
}

function appendPromptTokens(node, name, lines, isArtist) {
    const w = (node.widgets || []).find(w => w.name === name);
    if (!w) return false;
    const cur = (w.value || "").trim();
    const segs = lines
        .map(l => isArtist ? formatArtistToken(l) : formatPlainWeightedToken(l))
        .filter(Boolean);
    if (!segs.length) return false;
    setWidgetValue(node, name, (cur ? cur + ", " : "") + segs.join(", "));
    return true;
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
    "AnimaGelbooruStyleT8",
    "AnimaPromptCombinerT8",
    "AnimaSavedPromptLoaderT8",
]);

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
            const btn3 = document.createElement("button");
            btn3.className = "comfy-button"; btn3.textContent = "🌐 Gelbooru 标签库";
            btn3.addEventListener("click", () => openGelbooruGallery({ onApply: (lines, meta = {}) => {
                const isArtist = meta.isArtist !== false;
                if (isArtist) {
                    const node = findActiveAnimaGelbooruNode();
                    const artistTokens = lines.map(formatArtistToken).filter(Boolean);
                    if (node) { appendArtistsToWidget(node, "gelbooru_tags", artistTokens); return; }
                    const pn = findActiveAnimaPromptNode();
                    if (pn && appendPromptTokens(pn, "style", lines, true)) return;
                    showToast("请在画布中选中 Anima Gelbooru 或 Anima Prompt 节点");
                } else {
                    const gelNode = findActiveAnimaGelbooruNode();
                    if (gelNode) setLastPickedRaw(gelNode, lines);
                    const pn = findActiveAnimaPromptNode();
                    if (pn && appendPromptTokens(pn, "positive", lines, false)) return;
                    if (gelNode) { showToast("已加入 Gelbooru 预览图列表，运行节点查看"); return; }
                    showToast("请在画布中选中 Anima Prompt T8 节点");
                }
            }}));
            wrap.append(btn1, btn2, btn3);
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
                    addBtn(self, "🌐 Gelbooru 标签库", () => openGelbooruGallery({
                        onApply: (lines, meta = {}) => {
                            const isArtist = meta.isArtist !== false;
                            appendPromptTokens(self, isArtist ? "style" : "positive", lines, isArtist);
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
                } else if (nodeData.name === "AnimaGelbooruStyleT8") {
                    addBtn(self, "🌐 Gelbooru 标签库", () => openGelbooruGallery({
                        onApply: (lines, meta = {}) => {
                            const isArtist = meta.isArtist !== false;
                            if (isArtist) {
                                const artistTokens = lines.map(formatArtistToken).filter(Boolean);
                                appendArtistsToWidget(self, "gelbooru_tags", artistTokens);
                                return;
                            }
                            setLastPickedRaw(self, lines);
                            const pn = findActiveAnimaPromptNode();
                            if (pn) appendPromptTokens(pn, "positive", lines, false);
                            showToast("已加入 Gelbooru 预览图列表，运行节点查看");
                        },
                    }));
                } else if (nodeData.name === "AnimaSavedPromptLoaderT8") {
                    addBtn(self, "📚 风格库", () => openPromptPanel({}));
                }
            } catch (e) {
                console.warn("[anima_t8] init node btn error:", e);
            }
            return r;
        };
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

function findActiveAnimaGelbooruNode() {
    const sel = app.canvas?.selected_nodes;
    if (sel) {
        for (const id in sel) {
            const n = sel[id];
            if (n && (n.comfyClass === "AnimaGelbooruStyleT8" || n.type === "AnimaGelbooruStyleT8")) return n;
        }
    }
    const nodes = app.graph?._nodes || [];
    return nodes.find(n => n.comfyClass === "AnimaGelbooruStyleT8" || n.type === "AnimaGelbooruStyleT8");
}
