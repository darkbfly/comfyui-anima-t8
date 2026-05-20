// 提示词管理面板：列表 / 搜索 / 收藏 / 置顶 / 标签 / 导入导出
import { AnimaApi } from "../api.js";
import { el, showToast, tagChip, confirmDialog } from "./tag_chip.js";
import { openPromptEditor } from "./prompt_editor.js";

export function openPromptPanel({ onApply } = {}) {
    let allTags = [];
    let activeTagId = null;
    let kw = "";
    let favoriteOnly = false;
    let pinnedOnly = false;

    const mask = el("div", { class: "anima-t8-mask" });
    const listBox = el("div", { class: "anima-t8-flex1", style: { overflow: "auto" } });
    const sideTagList = el("div", {});

    const searchInput = el("input", {
        class: "anima-t8-input", placeholder: "🔍 搜索标题 / 内容 / 描述",
    });
    searchInput.addEventListener("input", () => {
        kw = searchInput.value;
        clearTimeout(searchInput._t);
        searchInput._t = setTimeout(refresh, 250);
    });

    async function refresh() {
        listBox.innerHTML = "";
        try {
            const items = await AnimaApi.listPrompts({
                q: kw, tag: activeTagId, favorite: favoriteOnly, pinned: pinnedOnly,
            });
            if (!items || items.length === 0) {
                listBox.append(el("div", { class: "anima-t8-empty" }, "暂无提示词，点击右上角 ➕ 新建"));
                return;
            }
            const tagMap = {};
            allTags.forEach(t => tagMap[t.id] = t);
            items.forEach(p => listBox.append(renderCard(p, tagMap)));
        } catch (e) {
            listBox.append(el("div", { class: "anima-t8-empty" }, "加载失败：" + e.message));
        }
    }

    function renderCard(p, tagMap) {
        const card = el("div", { class: "anima-t8-card" + (p.is_pinned ? " pinned" : "") });
        card.append(
            el("div", { class: "anima-t8-card-title" },
                (p.is_pinned ? "📌 " : "") + (p.is_favorite ? "⭐ " : "") + (p.title || "(无标题)")
            ),
            p.description ? el("div", { class: "anima-t8-card-desc" }, p.description) : null,
            el("div", { class: "anima-t8-card-desc" }, (p.positive_prompt || "").slice(0, 120) + ((p.positive_prompt || "").length > 120 ? "…" : "")),
        );
        const tagsRow = el("div", { style: { marginTop: "6px" } });
        (p.tag_ids || []).forEach(tid => {
            const t = tagMap[tid];
            if (t) tagsRow.append(tagChip(t.name, t.color));
        });
        if ((p.tag_ids || []).length) card.append(tagsRow);

        const actions = el("div", { class: "anima-t8-card-actions" },
            el("button", {
                class: "anima-t8-btn primary",
                onclick: () => {
                    if (typeof onApply !== "function") {
                        showToast("当前面板未绑定节点。请在画布节点的 📚 风格库 按钮打开。");
                        return;
                    }
                    let ok = false;
                    try {
                        const r = onApply(p);
                        // onApply 可以返回 false 表示未生效（例如未找到节点），
                        // 返回 undefined / true / Promise 都当作已试图应用
                        ok = r !== false;
                    } catch (e) {
                        console.error("[anima_t8] onApply error:", e);
                        showToast("应用失败：" + (e && e.message ? e.message : e));
                        return;
                    }
                    if (ok) mask.remove();
                },
            }, "➜ 应用"),
            el("button", {
                class: "anima-t8-btn",
                onclick: async () => { await AnimaApi.favoritePrompt(p.id); refresh(); },
            }, p.is_favorite ? "★ 取消收藏" : "☆ 收藏"),
            el("button", {
                class: "anima-t8-btn",
                onclick: async () => { await AnimaApi.pinPrompt(p.id); refresh(); },
            }, p.is_pinned ? "📌 取消置顶" : "📌 置顶"),
            el("button", {
                class: "anima-t8-btn",
                onclick: () => openPromptEditor(p, { onSaved: refresh }),
            }, "✏ 编辑"),
            el("button", {
                class: "anima-t8-btn danger",
                onclick: async () => {
                    if (await confirmDialog(`确认删除 "${p.title}" ?`)) {
                        await AnimaApi.deletePrompt(p.id); refresh();
                    }
                },
            }, "🗑 删除"),
        );
        card.append(actions);
        return card;
    }

    async function refreshTags() {
        sideTagList.innerHTML = "";
        try {
            allTags = await AnimaApi.listTags();
        } catch (e) {
            allTags = [];
        }
        const all = el("div", {
            class: "anima-t8-side-item" + (activeTagId === null ? " active" : ""),
            onclick: () => { activeTagId = null; refreshTags(); refresh(); },
        }, "🌐 全部");
        sideTagList.append(all);
        allTags.forEach(t => {
            const item = el("div", {
                class: "anima-t8-side-item" + (activeTagId === t.id ? " active" : ""),
            },
                el("span", { class: "anima-t8-tag-chip", style: { background: t.color, marginRight: "6px" } }, " "),
                t.name,
            );
            item.addEventListener("click", () => {
                activeTagId = t.id; refreshTags(); refresh();
            });
            sideTagList.append(item);
        });
    }

    async function addNewTag() {
        const name = window.prompt("标签名");
        if (!name) return;
        const color = window.prompt("颜色 (HEX)", "#FF6B9D") || "#FF6B9D";
        await AnimaApi.upsertTag({ name, color });
        refreshTags();
    }

    async function exportData() {
        try {
            const data = await AnimaApi.exportAll();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
            const a = el("a", {
                href: URL.createObjectURL(blob),
                download: `anima_t8_export_${Date.now()}.json`,
            });
            document.body.append(a); a.click(); a.remove();
        } catch (e) { showToast("导出失败：" + e.message); }
    }

    function importData() {
        const inp = el("input", { type: "file", accept: ".json" });
        inp.addEventListener("change", async () => {
            const f = inp.files[0]; if (!f) return;
            try {
                const text = await f.text();
                const data = JSON.parse(text);
                const replace = await confirmDialog("是否覆盖现有数据？(取消=合并)");
                const cnt = await AnimaApi.importAll(data, replace);
                showToast(`已导入 prompts:${cnt.prompts} tags:${cnt.tags}`);
                refresh(); refreshTags();
            } catch (e) { showToast("导入失败：" + e.message); }
        });
        inp.click();
    }

    async function fetchFromCivitai() {
        const idStr = window.prompt(
            "🌐 从 Civitai 拉取高赞图的 prompt 模板\n\n" +
            "请输入 Civitai 模型 ID（模型页网址里的数字）\n" +
            "例： https://civitai.com/models/257749  ->  257749\n\n" +
            "可选：仅输入数字默认拉 Most Reactions / 近一个月 / 前 30 张",
            ""
        );
        if (!idStr) return;
        const modelId = parseInt(idStr.trim(), 10);
        if (!modelId) { showToast("模型 ID 需为数字"); return; }
        showToast("正在拉取 Civitai…这可能需 5–20 秒");
        try {
            const r = await AnimaApi.refreshFromCivitai({
                model_id: modelId,
                sort: "Most Reactions",
                period: "Month",
                nsfw: "None",
                limit: 100,
                max_pages: 1,
                top_n: 30,
                tag_names: ["风格"],
            });
            showToast(`Civitai 完成：拉取 ${r.fetched} 条，新增 ${r.added} 条`);
            refresh();
        } catch (e) {
            showToast("Civitai 拉取失败：" + (e && e.message ? e.message : e));
        }
    }

    const panel = el("div", { class: "anima-t8-panel" },
        el("div", { class: "anima-t8-header" },
            el("h2", {}, "📚 Anima 风格库"),
            el("button", { class: "anima-t8-btn", onclick: fetchFromCivitai }, "🌐 Civitai"),
            el("button", { class: "anima-t8-btn", onclick: importData }, "📥 导入"),
            el("button", { class: "anima-t8-btn", onclick: exportData }, "📤 导出"),
            el("button", {
                class: "anima-t8-btn primary",
                onclick: () => openPromptEditor(null, { onSaved: refresh }),
            }, "➕ 新建"),
            el("button", { class: "anima-t8-close", onclick: () => mask.remove() }, "×"),
        ),
        el("div", { class: "anima-t8-body" },
            el("div", { class: "anima-t8-side" },
                el("h4", {}, "筛选"),
                el("div", {
                    class: "anima-t8-side-item",
                    onclick: (e) => {
                        favoriteOnly = !favoriteOnly;
                        e.currentTarget.classList.toggle("active", favoriteOnly);
                        refresh();
                    },
                }, "⭐ 仅看收藏"),
                el("div", {
                    class: "anima-t8-side-item",
                    onclick: (e) => {
                        pinnedOnly = !pinnedOnly;
                        e.currentTarget.classList.toggle("active", pinnedOnly);
                        refresh();
                    },
                }, "📌 仅看置顶"),
                el("h4", {}, "标签"),
                sideTagList,
                el("button", { class: "anima-t8-btn", style: { marginTop: "8px", width: "100%" }, onclick: addNewTag }, "➕ 新增标签"),
            ),
            el("div", { class: "anima-t8-main" },
                el("div", { class: "anima-t8-toolbar" }, searchInput),
                listBox,
            ),
        ),
    );

    mask.append(panel);
    mask.addEventListener("click", (e) => { if (e.target === mask) mask.remove(); });
    document.body.appendChild(mask);

    refreshTags();
    refresh();
}
