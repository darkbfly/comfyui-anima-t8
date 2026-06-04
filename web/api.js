// comfyui-anima-t8 前端 API 封装
const BASE = "/anima_t8";

async function _req(method, path, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
        opts.headers["Content-Type"] = "application/json";
        opts.body = JSON.stringify(body);
    }
    const resp = await fetch(BASE + path, opts);
    const text = await resp.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { json = null; }
    if (!resp.ok) {
        // 后端返回非 2xx，试图从 JSON或文本中提取具体错误
        const detail = (json && json.error) || text.replace(/<[^>]+>/g, "").trim().slice(0, 200) || resp.statusText;
        throw new Error(`HTTP ${resp.status}: ${detail}`);
    }
    if (!json || !json.ok) {
        throw new Error((json && json.error) || "响应不是合法 JSON");
    }
    return json.data;
}

export const AnimaApi = {
    listPrompts: (params = {}) => {
        const usp = new URLSearchParams();
        if (params.q) usp.set("q", params.q);
        if (params.tag) usp.set("tag", params.tag);
        if (params.favorite) usp.set("favorite", "1");
        if (params.pinned) usp.set("pinned", "1");
        const qs = usp.toString();
        return _req("GET", "/prompts" + (qs ? "?" + qs : ""));
    },
    getPrompt: (id) => _req("GET", "/prompts/" + encodeURIComponent(id)),
    upsertPrompt: (data) => _req("POST", "/prompts", data),
    deletePrompt: (id) => _req("DELETE", "/prompts/" + encodeURIComponent(id)),
    favoritePrompt: (id) => _req("POST", "/prompts/" + encodeURIComponent(id) + "/favorite"),
    pinPrompt: (id) => _req("POST", "/prompts/" + encodeURIComponent(id) + "/pin"),

    listTags: () => _req("GET", "/tags"),
    upsertTag: (data) => _req("POST", "/tags", data),
    deleteTag: (id) => _req("DELETE", "/tags/" + encodeURIComponent(id)),

    listArtists: (params = {}) => {
        const usp = new URLSearchParams();
        if (params.q) usp.set("q", params.q);
        if (params.page) usp.set("page", String(params.page));
        if (params.page_size) usp.set("page_size", String(params.page_size));
        if (params.pinned) usp.set("pinned", "1");
        if (params.letter) usp.set("letter", params.letter);
        if (params.with_image) usp.set("with_image", "1");
        const qs = usp.toString();
        return _req("GET", "/artists" + (qs ? "?" + qs : ""));
    },
    refreshArtists: () => _req("POST", "/artists/refresh"),
    pinArtist: (slug, pinned) => _req("POST", "/artists/" + encodeURIComponent(slug) + "/pin", { pinned }),

    // ----- Danbooru tags（artist / copyright / character） -----
    listDtags: (params = {}) => {
        const usp = new URLSearchParams();
        usp.set("category", params.category || "artist");
        if (params.q) usp.set("q", params.q);
        if (params.page) usp.set("page", String(params.page));
        if (params.page_size) usp.set("page_size", String(params.page_size));
        if (params.pinned) usp.set("pinned", "1");
        if (params.letter) usp.set("letter", params.letter);
        return _req("GET", "/dtags?" + usp.toString());
    },
    refreshDtags: (category) => _req("POST", "/dtags/refresh", { category }),
    pinDtag: (name, category, pinned) => _req("POST", "/dtags/pin", { name, category, pinned }),
    previewDtag: (name) => _req("GET", "/dtags/preview?name=" + encodeURIComponent(name)),
    listDtagPosts: (name, page = 1, limit = 20) => {
        const usp = new URLSearchParams();
        usp.set("name", name);
        usp.set("page", String(page));
        usp.set("limit", String(limit));
        return _req("GET", "/dtags/posts?" + usp.toString());
    },

    // ----- Gelbooru tags（artist / copyright / character / general） -----
    listGtags: (params = {}) => {
        const usp = new URLSearchParams();
        usp.set("category", params.category || "artist");
        if (params.q) usp.set("q", params.q);
        if (params.page) usp.set("page", String(params.page));
        if (params.page_size) usp.set("page_size", String(params.page_size));
        if (params.pinned) usp.set("pinned", "1");
        if (params.letter) usp.set("letter", params.letter);
        return _req("GET", "/gtags?" + usp.toString());
    },
    refreshGtags: (category) => _req("POST", "/gtags/refresh", { category }),
    pinGtag: (name, category, pinned) => _req("POST", "/gtags/pin", { name, category, pinned }),
    previewGtag: (name) => _req("GET", "/gtags/preview?name=" + encodeURIComponent(name)),
    listGtagPosts: (name, page = 1, limit = 20) => {
        const usp = new URLSearchParams();
        usp.set("name", name);
        usp.set("page", String(page));
        usp.set("limit", String(limit));
        return _req("GET", "/gtags/posts?" + usp.toString());
    },

    // ----- Civitai 模板抓取 -----
    refreshFromCivitai: (params) => _req("POST", "/civitai/refresh", params || {}),

    listSnippets: (type) => _req("GET", "/snippets" + (type ? "?type=" + type : "")),
    addSnippet: (content, type) => _req("POST", "/snippets", { content, type }),
    deleteSnippet: (id) => _req("DELETE", "/snippets/" + encodeURIComponent(id)),

    meta: () => _req("GET", "/meta"),
    exportAll: () => _req("GET", "/export"),
    importAll: (data, replace) => _req("POST", "/import", { ...data, __replace: !!replace }),
};
