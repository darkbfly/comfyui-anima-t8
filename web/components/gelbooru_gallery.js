// Gelbooru 标签库：画师 / 作品 IP / 角色 IP / 通用标签
import { AnimaApi } from "../api.js";
import { el, showToast } from "./tag_chip.js";

const PLACEHOLDER_SVG = "data:image/svg+xml;utf8," + encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 3 4'>" +
    "<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>" +
    "<stop offset='0' stop-color='#eef6ff'/><stop offset='1' stop-color='#fff2e2'/>" +
    "</linearGradient></defs><rect width='3' height='4' fill=\"url(%23g)\"/></svg>"
);

const TABS = [
    { key: "gba", label: "👤 Gelbooru 画师", source: "gel", isArtist: true, category: "artist" },
    { key: "gbc", label: "📚 Gelbooru 作品 IP", source: "gel", isArtist: false, category: "copyright" },
    { key: "gbk", label: "🧑‍🎤 Gelbooru 角色 IP", source: "gel", isArtist: false, category: "character" },
    { key: "gbg", label: "🏷 Gelbooru 通用", source: "gel", isArtist: false, category: "general" },
];

export function openGelbooruGallery({ onApply } = {}) {
    let currentTab = "gba";
    let kw = "";
    let page = 1;
    const pageSize = 60;
    let pinnedOnly = false;
    let letter = "";
    let total = 0;
    let weight = 1.0;
    const selectedByTab = new Map();
    const previewCache = new Map();
    const previewQueue = [];
    let previewActive = 0;
    const MAX_CONCURRENT_PREVIEW = 4;
    let previewGen = 0;

    function getSelected() {
        if (!selectedByTab.has(currentTab)) selectedByTab.set(currentTab, new Map());
        return selectedByTab.get(currentTab);
    }
    function getTab() { return TABS.find(t => t.key === currentTab); }
    function itemId(it) { return it.tag || it.slug || ""; }

    function schedulePreview(name, img, gen) {
        const job = () => {
            previewActive++;
            const timeout = new Promise((_, rej) =>
                setTimeout(() => rej(new Error("timeout 8s")), 8000));
            return Promise.race([AnimaApi.previewGtag(name), timeout]).then(d => {
                const url = (d && d.image_url) || "";
                previewCache.set(name, url);
                if (gen !== previewGen) return;
                if (url && img.isConnected) {
                    img.onerror = () => {
                        img.onerror = null;
                        img.src = PLACEHOLDER_SVG;
                        img.classList.add("placeholder", "err");
                    };
                    img.src = url;
                    img.classList.remove("placeholder");
                } else if (!url && img.isConnected) {
                    img.classList.add("err");
                    const card = img.closest(".anima-t8-artist-card");
                    if (card) card.classList.add("err");
                    img.title = "Gelbooru 未返回预览图";
                }
            }).catch((e) => {
                console.warn("[anima_t8] gelbooru preview FAIL", name, e && e.message);
                previewCache.set(name, "");
                if (gen === previewGen && img.isConnected) {
                    img.classList.add("err");
                    const card = img.closest(".anima-t8-artist-card");
                    if (card) card.classList.add("err");
                    img.title = "Gelbooru 预览接口错误：" + (e && e.message ? e.message : e);
                }
            }).finally(() => {
                previewActive--;
                while (previewActive < MAX_CONCURRENT_PREVIEW && previewQueue.length) {
                    previewQueue.shift()();
                }
            });
        };
        if (previewActive < MAX_CONCURRENT_PREVIEW) job();
        else previewQueue.push(job);
    }

    const mask = el("div", { class: "anima-t8-mask" });
    const grid = el("div", { class: "anima-t8-grid", style: { padding: "4px" } });
    const totalLabel = el("span", { style: { fontSize: "12px", color: "#5a6b80" } }, "");

    const pageInput = el("input", {
        type: "number", class: "anima-t8-input",
        style: { width: "60px", flex: "0 0 auto", textAlign: "center" },
        min: 1, step: 1,
    });
    pageInput.value = "1";
    const pageInfo = el("span", { style: { fontSize: "12px", color: "#5a6b80" } }, "/ 1");

    const searchInput = el("input", {
        class: "anima-t8-input", placeholder: "🔍 搜索 Gelbooru tag",
    });
    searchInput.addEventListener("input", () => {
        clearTimeout(searchInput._t);
        searchInput._t = setTimeout(() => {
            kw = searchInput.value; page = 1; refresh();
        }, 250);
    });

    const weightInput = el("input", {
        type: "number", class: "anima-t8-input",
        style: { width: "90px", flex: "0 0 auto" },
        min: 0.1, max: 2.0, step: 0.05,
    });
    weightInput.value = "1.00";
    weightInput.addEventListener("change", () => { weight = parseFloat(weightInput.value) || 1.0; });

    async function fetchData() {
        const t = getTab();
        return AnimaApi.listGtags({
            category: t.category,
            q: kw,
            page,
            page_size: pageSize,
            pinned: pinnedOnly,
            letter,
        });
    }

    let backfillingTimer = null;

    async function refresh() {
        previewQueue.length = 0;
        previewGen++;
        if (backfillingTimer) { clearTimeout(backfillingTimer); backfillingTimer = null; }

        grid.innerHTML = "";
        grid.append(el("div", { class: "anima-t8-empty", style: { gridColumn: "1 / -1" } }, "加载中…"));
        try {
            const data = await fetchData();
            total = data.total || 0;
            const totalPages = Math.max(1, Math.ceil(total / pageSize));
            if (page > totalPages) page = totalPages;
            totalLabel.textContent = ` 共 ${total} 个` + (data.backfilling ? " · 后台补全中…" : "");
            pageInput.value = String(page);
            pageInput.max = String(totalPages);
            pageInfo.textContent = `/ ${totalPages}`;
            if (data.backfilling) {
                const tabAtFire = currentTab;
                backfillingTimer = setTimeout(() => {
                    if (currentTab === tabAtFire) refresh();
                }, 8000);
            }
            grid.innerHTML = "";
            if (!data.items || data.items.length === 0) {
                grid.append(el("div", { class: "anima-t8-empty", style: { gridColumn: "1 / -1" } },
                    "未找到数据；尝试点击右上角 🔄 刷新。"));
                return;
            }
            data.items.forEach(a => grid.append(renderItem(a)));
        } catch (e) {
            grid.innerHTML = "";
            grid.append(el("div", { class: "anima-t8-empty", style: { gridColumn: "1 / -1" } },
                "加载失败：" + e.message));
        }
    }

    function gotoPage(p) {
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const np = Math.min(totalPages, Math.max(1, parseInt(p, 10) || 1));
        if (np === page) return;
        page = np; refresh();
    }

    function renderItem(a) {
        const t = getTab();
        const id = itemId(a);
        const sel = getSelected();
        const isPinned = a.pinned || a.is_pinned;
        const card = el("div", {
            class: "anima-t8-artist-card" + (isPinned || sel.has(id) ? " pinned" : ""),
        });

        const img = el("img", {
            class: "anima-t8-art-img",
            loading: "lazy",
            referrerpolicy: "no-referrer",
        });
        const cached = previewCache.get(a.tag);
        if (cached) {
            img.src = cached;
        } else {
            img.src = PLACEHOLDER_SVG;
            img.classList.add("placeholder");
            schedulePreview(a.tag, img, previewGen);
        }

        const pinBtn = el("button", {
            class: "anima-t8-pin-btn" + (isPinned ? " on" : ""),
            title: isPinned ? "取消固定" : "固定",
            onclick: async (e) => {
                e.stopPropagation();
                try {
                    await AnimaApi.pinGtag(a.tag, t.category, !isPinned);
                    a.pinned = !isPinned;
                    const np = a.pinned || a.is_pinned;
                    pinBtn.classList.toggle("on", np);
                    card.classList.toggle("pinned", np || sel.has(id));
                } catch (err) { showToast("失败：" + err.message); }
            },
        }, "📌");

        card.append(
            img, pinBtn,
            el("div", { class: "anima-t8-art-info" },
                el("div", { class: "anima-t8-art-slug" }, id),
                el("div", { class: "anima-t8-art-count" }, `${a.post_count || 0} posts`),
            ),
        );

        card.addEventListener("click", () => {
            if (sel.has(id)) sel.delete(id);
            else sel.set(id, a);
            const np = a.pinned || a.is_pinned;
            card.classList.toggle("pinned", np || sel.has(id));
            applyBtn.textContent = sel.size > 0 ? `➜ 添加 ${sel.size} 个` : "➜ 添加选中";
        });
        card.addEventListener("dblclick", async (e) => {
            e.preventDefault();
            let imgUrl = a.image_url || previewCache.get(a.tag) || "";
            if (!imgUrl) {
                try {
                    const d = await AnimaApi.previewGtag(a.tag);
                    imgUrl = (d && d.image_url) || "";
                    previewCache.set(a.tag, imgUrl);
                } catch (_) { /* ignore */ }
            }
            preview({ ...a, image_url: imgUrl });
        });
        return card;
    }

    function preview(a) {
        const m = el("div", { class: "anima-t8-preview-mask" });
        const insertAndClose = () => { doApply([a]); m.remove(); };
        m.append(el("div", { class: "anima-t8-preview-box" },
            el("div", { style: { fontWeight: "600" } }, a.slug + (a.tag ? " · " + a.tag : "")),
            a.image_url ? el("img", { src: a.image_url, referrerpolicy: "no-referrer" }) :
                el("div", { class: "anima-t8-empty" }, "无预览图"),
            el("div", { class: "anima-t8-preview-actions" },
                el("button", { class: "anima-t8-btn", onclick: () => m.remove() }, "关闭"),
                el("button", { class: "anima-t8-btn primary", onclick: insertAndClose }, "➜ 一键添加"),
            ),
        ));
        m.addEventListener("click", (e) => { if (e.target === m) m.remove(); });
        document.body.appendChild(m);
    }

    function doApply(items) {
        if (!onApply) { showToast("未连接到节点"); return; }
        const t = getTab();
        const lines = items.map(a => {
            const id = itemId(a);
            return Math.abs(weight - 1.0) < 1e-3 ? id : `${id}:${weight.toFixed(2)}`;
        });
        onApply(lines, { isArtist: t.isArtist, source: t.source, category: t.category });
        showToast(`已添加 ${lines.length} 个`);
    }

    const applyBtn = el("button", {
        class: "anima-t8-btn primary",
        onclick: async () => {
            const sel = getSelected();
            if (sel.size === 0) { showToast("请先点击选择项目"); return; }
            doApply(Array.from(sel.values()));
            mask.remove();
        },
    }, "➜ 添加选中");

    pageInput.addEventListener("change", () => gotoPage(pageInput.value));
    pageInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); gotoPage(pageInput.value); }
    });

    const tabBar = el("div", { class: "anima-t8-row", style: { gap: "4px", flexWrap: "wrap", margin: "0 0 6px 0" } });
    const tabBtns = {};
    TABS.forEach(t => {
        const b = el("button", {
            class: "anima-t8-btn" + (currentTab === t.key ? " primary" : ""),
            style: { padding: "4px 10px", fontSize: "13px" },
            onclick: () => {
                if (currentTab === t.key) return;
                currentTab = t.key;
                Object.entries(tabBtns).forEach(([k, btn]) =>
                    btn.classList.toggle("primary", k === t.key));
                kw = ""; searchInput.value = "";
                letter = ""; updateLetterBtns();
                page = 1;
                applyBtn.textContent = "➜ 添加选中";
                refresh();
            },
        }, t.label);
        tabBtns[t.key] = b;
        tabBar.append(b);
    });

    const letterBar = el("div", { class: "anima-t8-row", style: { flexWrap: "wrap", gap: "4px", margin: "4px 0" } });
    const letters = ["全部", ..."abcdefghijklmnopqrstuvwxyz".split(""), "#"];
    const letterBtns = {};
    letters.forEach(l => {
        const key = l === "全部" ? "" : l;
        const b = el("button", {
            class: "anima-t8-btn" + (letter === key ? " primary" : ""),
            style: { minWidth: "30px", padding: "2px 6px", fontSize: "12px" },
            onclick: () => {
                letter = key;
                updateLetterBtns();
                page = 1; refresh();
            },
        }, l === "全部" ? "全部" : l.toUpperCase());
        letterBtns[key] = b;
        letterBar.append(b);
    });
    function updateLetterBtns() {
        Object.entries(letterBtns).forEach(([k, btn]) =>
            btn.classList.toggle("primary", k === letter));
    }

    const refreshBtn = el("button", {
        class: "anima-t8-btn",
        onclick: async () => {
            const t = getTab();
            showToast("拉取中…");
            try {
                const r = await AnimaApi.refreshGtags(t.category);
                showToast(`已刷新 ${r.count} 个`);
                refresh();
            } catch (e) { showToast("失败：" + e.message); }
        },
    }, "🔄 刷新");

    const panel = el("div", { class: "anima-t8-panel" },
        el("div", { class: "anima-t8-header" },
            el("h2", {}, "🌐 Gelbooru 标签库"),
            refreshBtn,
            el("button", { class: "anima-t8-close", onclick: () => mask.remove() }, "×"),
        ),
        el("div", { class: "anima-t8-body" },
            el("div", { class: "anima-t8-main" },
                tabBar,
                el("div", { class: "anima-t8-toolbar" },
                    searchInput,
                    el("span", { style: { fontSize: "12px" } }, "权重"), weightInput,
                    el("button", {
                        class: "anima-t8-btn",
                        onclick: (e) => {
                            pinnedOnly = !pinnedOnly;
                            e.currentTarget.classList.toggle("primary", pinnedOnly);
                            page = 1; refresh();
                        },
                    }, "📌 仅固定"),
                    applyBtn,
                ),
                letterBar,
                totalLabel,
                grid,
                el("div", { class: "anima-t8-row", style: { justifyContent: "center", marginTop: "12px", gap: "6px", flexWrap: "wrap" } },
                    el("button", { class: "anima-t8-btn", onclick: () => gotoPage(1) }, "« 首页"),
                    el("button", { class: "anima-t8-btn", onclick: () => gotoPage(page - 1) }, "← 上一页"),
                    el("span", { style: { fontSize: "12px", color: "#5a6b80", display: "inline-flex", alignItems: "center", gap: "4px" } },
                        "第", pageInput, pageInfo, "页"),
                    el("button", { class: "anima-t8-btn", onclick: () => gotoPage(page + 1) }, "下一页 →"),
                    el("button", { class: "anima-t8-btn", onclick: () => gotoPage(Math.ceil(total / pageSize)) }, "末页 »"),
                ),
            ),
        ),
    );

    mask.append(panel);
    mask.addEventListener("click", (e) => { if (e.target === mask) mask.remove(); });
    document.body.appendChild(mask);
    refresh();
}
