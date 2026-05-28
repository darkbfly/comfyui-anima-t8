// 艺术家 / Danbooru 多 Tab 库：画师（mooshieblob）/ Danbooru 画师 / 作品 IP / 角色 IP
import { AnimaApi } from "../api.js";
import { el, showToast } from "./tag_chip.js";

// 1x1 透明颁色 SVG，作为 Danbooru 未拉到图时的占位 src，避免裂图
const PLACEHOLDER_SVG = "data:image/svg+xml;utf8," + encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 3 4'>" +
    "<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>" +
    "<stop offset='0' stop-color='#eaf2ff'/><stop offset='1' stop-color='#f7e8f1'/>" +
    "</linearGradient></defs><rect width='3' height='4' fill=\"url(%23g)\"/></svg>"
);

const DANBOORU_POSTS_BASE = "https://danbooru.donmai.us/posts?tags=";

function danbooruPostsUrl(tagName) {
    const t = (tagName || "").trim();
    if (!t) return "";
    return DANBOORU_POSTS_BASE + encodeURIComponent(t);
}

function openDanbooruTag(tagName) {
    const url = danbooruPostsUrl(tagName);
    if (!url) {
        showToast("无法生成 Danbooru 链接");
        return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Tab 配置
 *  - moo  ： mooshieblob 画师库（带预览图）
 *  - dba  ： Danbooru artist（画师 tag，无预览图）
 *  - dbc  ： Danbooru copyright（作品 IP）
 *  - dbk  ： Danbooru character（角色 IP）
 *  - dbm  ： Danbooru meta（风格/画质/媒介/年代等元标签）
 */
const TABS = [
    { key: "dba", label: "👤 Danbooru 画师",        source: "dan", isArtist: true,  category: "artist",    hasImage: false },
    { key: "dbc", label: "📚 作品 IP",                 source: "dan", isArtist: false, category: "copyright", hasImage: false },
    { key: "dbk", label: "🧑‍🎤 角色 IP",                 source: "dan", isArtist: false, category: "character", hasImage: false },
    { key: "dbm", label: "🎭 风格·meta",            source: "dan", isArtist: false, category: "meta",      hasImage: false },
    { key: "moo", label: "🎨 画师库·mooshieblob", source: "moo", isArtist: true,  hasImage: true  },
];

export function openArtistGallery({ onApply } = {}) {
    let currentTab = "dba";
    let kw = "";
    let page = 1;
    const pageSize = 60;
    let pinnedOnly = false;
    let withImageOnly = true;   // 仅对 mooshieblob tab 生效
    let letter = "";
    let total = 0;
    let weight = 1.0;
    /** 选中表：key = currentTab，value = Map<id, item> */
    const selectedByTab = new Map();
    /** Danbooru 懒加载预览图客户端缓存：name -> image_url （空字符串 = 拉过但无图） */
    const previewCache = new Map();
    /** 预览图并发队列，避免一口气后端与 Danbooru API 被 60+ 请求击垮 */
    const previewQueue = [];
    let previewActive = 0;
    const MAX_CONCURRENT_PREVIEW = 4;
    /** 每次 refresh 递增，可以让旧请求回来后被丢弃（避免切 tab 后赋错位） */
    let previewGen = 0;
    function schedulePreview(name, img, gen) {
        const job = () => {
            previewActive++;
            const t0 = Date.now();
            // 客户端超时 8s，避免某个请求挂住占用并发名额
            const timeout = new Promise((_, rej) =>
                setTimeout(() => rej(new Error("timeout 8s")), 8000));
            return Promise.race([AnimaApi.previewDtag(name), timeout]).then(d => {
                const url = (d && d.image_url) || "";
                previewCache.set(name, url);
                console.debug("[anima_t8] preview", name, url ? "OK" : "empty", (Date.now() - t0) + "ms");
                if (gen !== previewGen) return;
                if (url && img.isConnected) {
                    img.onerror = () => {
                        img.onerror = null;
                        img.src = PLACEHOLDER_SVG;
                        img.classList.add("placeholder", "err");
                        const card = img.closest(".anima-t8-artist-card");
                        if (card) card.classList.add("err");
                        img.title = "预览图 URL 加载失败（可能需代理）";
                    };
                    img.src = url;
                    img.classList.remove("placeholder");
                } else if (!url && img.isConnected) {
                    img.classList.add("err");
                    const card = img.closest(".anima-t8-artist-card");
                    if (card) card.classList.add("err");
                    img.title = "Danbooru 未返回预览图（可能 post_count 太少或 banned）";
                }
            }).catch((e) => {
                console.warn("[anima_t8] preview FAIL", name, e && e.message);
                previewCache.set(name, "");
                if (gen === previewGen && img.isConnected) {
                    img.classList.add("err");
                    const card = img.closest(".anima-t8-artist-card");
                    if (card) card.classList.add("err");
                    img.title = "预览接口错误：" + (e && e.message ? e.message : e);
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
    function getSelected() {
        if (!selectedByTab.has(currentTab)) selectedByTab.set(currentTab, new Map());
        return selectedByTab.get(currentTab);
    }
    function getTab() { return TABS.find(t => t.key === currentTab); }
    function itemId(it) { return getTab().source === "moo" ? it.slug : it.tag; }

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
        class: "anima-t8-input", placeholder: "🔍 搜索 (slug / tag)",
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

    // 仅有图按钮（仅在 mooshieblob tab 可见）
    const onlyImageBtn = el("button", {
        class: "anima-t8-btn" + (withImageOnly ? " primary" : ""),
        onclick: (e) => {
            withImageOnly = !withImageOnly;
            e.currentTarget.classList.toggle("primary", withImageOnly);
            page = 1; refresh();
        },
    }, "🖼 仅有图");

    async function fetchData() {
        const t = getTab();
        if (t.source === "moo") {
            return AnimaApi.listArtists({
                q: kw, page, page_size: pageSize,
                pinned: pinnedOnly, letter, with_image: withImageOnly,
            });
        }
        return AnimaApi.listDtags({
            category: t.category,
            q: kw, page, page_size: pageSize,
            pinned: pinnedOnly, letter,
        });
    }

    /** 后台补全轮询计时器 */
    let backfillingTimer = null;

    async function refresh() {
        // tab 切换时隐藏/显示「仅有图」按钮
        onlyImageBtn.style.display = getTab().hasImage ? "" : "none";
        // 丢弃未开始的预览请求，同时让已发出的请求回来后被 gen 检查丢弃
        previewQueue.length = 0;
        previewGen++;
        // 取消上一轮后台补全轮询
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
            // 如果后端还在补全，8 秒后重拉一次（在当前 tab 未切换的前提下）
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
            grid.append(el("div", { class: "anima-t8-empty", style: { gridColumn: "1 / -1" } }, "加载失败：" + e.message));
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

        // 图片区：moo / Danbooru 有命中 mooshieblob 都直接走 image_url；
        // Danbooru 未命中的 走 IntersectionObserver 懒加载 /dtags/preview
        const img = el("img", {
            class: "anima-t8-art-img",
            loading: "lazy",
            referrerpolicy: "no-referrer",
        });
        if (a.image_url) {
            img.src = a.image_url;
            img.onerror = () => {
                img.onerror = null;
                img.src = PLACEHOLDER_SVG;
                img.classList.add("placeholder");
            };
        } else if (t.source === "dan") {
            // 先查客户端缓存
            const cached = previewCache.get(a.tag);
            if (cached) {
                img.src = cached;
                img.onerror = () => {
                    img.onerror = null;
                    img.src = PLACEHOLDER_SVG;
                    img.classList.add("placeholder");
                    img.classList.add("err");
                };
            } else {
                img.src = PLACEHOLDER_SVG;
                img.classList.add("placeholder");
                img.dataset.lazyName = a.tag;
                // 直接入队（4 并发限制），不再依赖 IntersectionObserver
                schedulePreview(a.tag, img, previewGen);
            }
        } else {
            img.src = PLACEHOLDER_SVG;
            img.classList.add("placeholder");
        }

        const pinBtn = el("button", {
            class: "anima-t8-pin-btn" + (isPinned ? " on" : ""),
            title: isPinned ? "取消固定" : "固定",
            onclick: async (e) => {
                e.stopPropagation();
                try {
                    if (t.source === "moo") {
                        await AnimaApi.pinArtist(a.slug, !isPinned);
                        a.is_pinned = !isPinned;
                    } else {
                        await AnimaApi.pinDtag(a.tag, t.category, !isPinned);
                        a.pinned = !isPinned;
                    }
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
        if (t.source === "moo") {
            card.addEventListener("dblclick", (e) => { e.preventDefault(); preview(a); });
        } else {
            // Danbooru 双击也开预览，如果还没拉到图则现拉
            card.addEventListener("dblclick", async (e) => {
                e.preventDefault();
                let imgUrl = a.image_url || previewCache.get(a.tag) || "";
                if (!imgUrl) {
                    try {
                        const d = await AnimaApi.previewDtag(a.tag);
                        imgUrl = (d && d.image_url) || "";
                        previewCache.set(a.tag, imgUrl);
                    } catch (_) { /* ignore */ }
                }
                preview({ ...a, image_url: imgUrl });
            });
        }
        return card;
    }

    function preview(a) {
        const m = el("div", { class: "anima-t8-preview-mask" });
        const insertAndClose = () => { doApply([a]); m.remove(); };
        m.append(el("div", { class: "anima-t8-preview-box" },
            el("div", { style: { fontWeight: "600" } }, a.slug + (a.tag ? " · " + a.tag : "")),
            a.image_url ? el("img", { src: a.image_url, referrerpolicy: "no-referrer" }) : el("div", { class: "anima-t8-empty" }, "无预览图"),
            el("div", { class: "anima-t8-preview-actions" },
                el("button", { class: "anima-t8-btn", onclick: () => m.remove() }, "关闭"),
                el("button", {
                    class: "anima-t8-btn",
                    onclick: () => openDanbooruTag(itemId(a)),
                }, "打开 Danbooru"),
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
        // 告诉上层当前是否是画师类（需要 artist: 前缀）还是 IP 类（不需加）
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

    // ----- Tab 切换栏 -----
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

    // ----- 字母索引栏 -----
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
                if (t.source === "moo") {
                    const r = await AnimaApi.refreshArtists();
                    showToast(`已刷新 ${r.count} 个`);
                } else {
                    const r = await AnimaApi.refreshDtags(t.category);
                    showToast(`已刷新 ${r.count} 个`);
                }
                refresh();
            } catch (e) { showToast("失败：" + e.message); }
        },
    }, "🔄 刷新");

    const panel = el("div", { class: "anima-t8-panel" },
        el("div", { class: "anima-t8-header" },
            el("h2", {}, "🎨 Anima 艺术家 / IP 库"),
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
                    onlyImageBtn,
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
