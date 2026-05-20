// comfyui-anima-t8 入口：注入 ComfyUI 扩展
import { app } from "../../scripts/app.js";
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
    // 同时记录本次选中的画师到 last_picked widget（覆盖式），
    // 让节点 build() 仅对本次选中拉预览图。
    // ⚠️ 后端 _fetch_preview_pil 会拿这个值去查 Danbooru，必须是纯 tag name——
    //   必须 strip 掉 @ 前缀 / artist: 前缀 / 括号 / :weight，否则拉不出图变黑图。
    const lp = (node.widgets || []).find(w => w.name === "last_picked");
    if (lp) {
        const rawNames = (artistLines || []).map(l => {
            let s = (l || "").trim();
            // 拆括号：(@wlop:1.1) → @wlop:1.1
            if (s.startsWith("(") && s.endsWith(")")) s = s.slice(1, -1).trim();
            // 去 @ / artist: 前缀
            if (s.startsWith("@")) s = s.slice(1);
            if (s.startsWith("artist:")) s = s.slice("artist:".length);
            // 去尾部 :weight
            const ci = s.lastIndexOf(":");
            if (ci > 0) {
                const tail = s.slice(ci + 1).trim();
                if (/^[0-9.]+$/.test(tail)) s = s.slice(0, ci);
            }
            return s.trim();
        }).filter(Boolean);
        lp.value = rawNames.join(", ");
        if (lp.callback) { try { lp.callback(lp.value, app.canvas, node); } catch (_) {} }
    }
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
                            // 该节点只接收画师类 token；IP 类提示用户
                            if (meta.isArtist === false) {
                                showToast("作品/角色 IP 请在 AnimaPromptT8 节点上打开该库");
                                return;
                            }
                            const artistTokens = lines.map(formatArtistToken).filter(Boolean);
                            appendArtistsToWidget(self, "artist_tags", artistTokens);
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
