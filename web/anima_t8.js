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
    // 重要：last_picked 必须是纯 name（无 @ / 无括号 / 无 artist: / 无 :weight），
    // 否则后端 _fetch_preview_pil 会用 "@xxx" 去 Danbooru 查询导致 0 结果（黑图）。
    const lp = (node.widgets || []).find(w => w.name === "last_picked");
    if (lp) {
        const cleanNames = (artistLines || []).map(l => {
            let t = (l || "").trim();
            if (!t) return "";
            if (t.startsWith("(") && t.endsWith(")")) t = t.slice(1, -1).trim();
            if (t.startsWith("artist:")) t = t.slice("artist:".length).trim();
            if (t.startsWith("@")) t = t.slice(1).trim();
            const idx = t.lastIndexOf(":");
            if (idx > 0) {
                const wv = t.slice(idx + 1).trim();
                if (/^\d+(\.\d+)?$/.test(wv)) t = t.slice(0, idx).trim();
            }
            return t;
        }).filter(Boolean);
        lp.value = cleanNames.join(", ");
        if (lp.callback) { try { lp.callback(lp.value, app.canvas, node); } catch (_) {} }
    }
    node.setDirtyCanvas(true, true);
    return true;
}

// 追加 token 列表到节点的 style widget（去重、保留原有内容）
function appendTokensToStyle(node, newTokens) {
    const w = (node.widgets || []).find(w => w.name === "style");
    if (!w) { showToast("该节点未找到 style widget"); return false; }
    const cur = (w.value || "").trim();
    const tokens = cur ? cur.split(/[,\n]+/).map(s => s.trim()).filter(Boolean) : [];
    const seen = new Set(tokens.map(t => t.toLowerCase()));
    let added = 0;
    for (const t of (newTokens || [])) {
        const v = (t || "").trim();
        if (!v) continue;
        const key = v.toLowerCase();
        if (!seen.has(key)) { tokens.push(v); seen.add(key); added++; }
    }
    if (added === 0) {
        showToast("都已存在，未重复追加");
        return true;
    }
    setWidgetValue(node, "style", tokens.join(", "));
    showToast(`已追加到 STYLE：新增 ${added} 项`);
    return true;
}

function applyPromptToNode(node, p) {
    if (!node) { showToast("未找到 Anima Prompt T8 节点"); return false; }
    if (!p) return false;
    // 语义：模板某字段为空则不覆盖该 widget（保护用户已选画师/已调节词）。
    // 想强制清空某字段，可在模板里填一个空格。
    const fields = [
        ["positive", p.positive_prompt],
        ["negative", p.negative_prompt],
        ["style",    p.artist_prompt],
    ];
    const written = [];
    const skipped = [];
    let touched = false;
    for (const [name, val] of fields) {
        if (val === undefined || val === null || val === "") { skipped.push(name); continue; }
        if (setWidgetValue(node, name, val)) {
            written.push(name);
            touched = true;
        }
    }
    if (!touched) {
        showToast("该节点未找到 positive/negative/style widget\u3002\u8BF7\u4F7F\u7528 AnimaPromptT8 \u8282\u70B9\u3002");
        return false;
    }
    const skipMsg = skipped.length ? `（保留 ${skipped.join("/")}）` : "";
    showToast(`已应用：${p.title || ""} → ${written.join(", ")}${skipMsg}`);
    return true;
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
                if (!node) {
                    showToast("请在画布中选中 Anima Prompt T8 节点");
                    return false;
                }
                return applyPromptToNode(node, p);
            }}));
            const btn2 = document.createElement("button");
            btn2.className = "comfy-button"; btn2.textContent = "🎨 Anima 艺术家库";
            btn2.addEventListener("click", () => openArtistGallery({ onApply: (lines, meta = {}) => {
                const isArtist = meta.isArtist !== false;
                if (isArtist) {
                    // 画师：优先选中的 AnimaArtistStyleT8 专用节点的 artist_tags widget
                    const node = findActiveAnimaArtistNode();
                    const artistTokens = lines.map(formatArtistToken).filter(Boolean);
                    if (node) { appendArtistsToWidget(node, "artist_tags", artistTokens); return; }
                    // fallback：写到 AnimaPromptT8 节点的 style widget
                    const pn = findActiveAnimaPromptNode();
                    if (pn) { appendTokensToStyle(pn, artistTokens); return; }
                    showToast("请在画布中选中 Anima 节点");
                } else {
                    // 作品 IP / 角色 IP / 风格·meta：写入 STYLE widget（不再写 positive）
                    const pn = findActiveAnimaPromptNode();
                    if (!pn) { showToast("请在画布中选中 Anima Prompt T8 节点"); return; }
                    const segs = lines.map(l => {
                        const idx = l.lastIndexOf(":");
                        if (idx > 0) {
                            const name = l.slice(0, idx), wv = l.slice(idx + 1);
                            return `(${name}:${wv})`;
                        }
                        return l;
                    }).filter(Boolean);
                    appendTokensToStyle(pn, segs);
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
                            // 所有选项（画师 / 作品 IP / 角色 IP / 风格·meta）全部追加到 style widget
                            const isArtist = meta.isArtist !== false;
                            const segs = lines.map(l => {
                                if (isArtist) return formatArtistToken(l);
                                const idx = l.lastIndexOf(":");
                                if (idx > 0) {
                                    const name = l.slice(0, idx), wv = l.slice(idx + 1);
                                    return `(${name}:${wv})`;
                                }
                                return l;
                            }).filter(Boolean);
                            appendTokensToStyle(self, segs);
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
                    // 该节点本身仅 preset_id widget，没有 positive/negative/style，
                    // “应用”时自动 fallback 到画布上的 AnimaPromptT8 节点
                    addBtn(self, "📚 风格库", () => openPromptPanel({
                        onApply: (p) => {
                            const target = findActiveAnimaPromptNode();
                            if (!target) {
                                showToast("请在画布中放置一个 Anima Prompt T8 节点以接收提示词");
                                return false;
                            }
                            return applyPromptToNode(target, p);
                        },
                    }));
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

function _iterSelected(sel) {
    // 兼容新版 ComfyUI Frontend：sel 可能是 Object、Array 或 Map
    if (!sel) return [];
    if (Array.isArray(sel)) return sel;
    if (typeof sel.values === "function" && typeof sel.size === "number") {
        return Array.from(sel.values());
    }
    return Object.values(sel);
}

function findActiveAnimaPromptNode() {
    for (const n of _iterSelected(app.canvas?.selected_nodes)) {
        if (n && (n.comfyClass === "AnimaPromptT8" || n.type === "AnimaPromptT8")) return n;
    }
    const nodes = app.graph?._nodes || [];
    return nodes.find(n => n.comfyClass === "AnimaPromptT8" || n.type === "AnimaPromptT8");
}

function findActiveAnimaArtistNode() {
    for (const n of _iterSelected(app.canvas?.selected_nodes)) {
        if (n && (n.comfyClass === "AnimaArtistStyleT8" || n.type === "AnimaArtistStyleT8")) return n;
    }
    const nodes = app.graph?._nodes || [];
    return nodes.find(n => n.comfyClass === "AnimaArtistStyleT8" || n.type === "AnimaArtistStyleT8");
}
