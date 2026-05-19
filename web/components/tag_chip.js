// 通用 Toast / Mask / 工具
export function showToast(msg, ms = 1800) {
    const el = document.createElement("div");
    el.className = "anima-t8-toast";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
}

export function loadStyle(href) {
    if (document.querySelector(`link[data-anima-t8="${href}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.animaT8 = href;
    document.head.appendChild(link);
}

export function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
        if (k === "class") node.className = v;
        else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
        else if (k.startsWith("on") && typeof v === "function") {
            node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (v !== null && v !== undefined && v !== false) {
            node.setAttribute(k, v === true ? "" : v);
        }
    });
    for (const c of children) {
        if (c === null || c === undefined || c === false) continue;
        node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
}

export function tagChip(text, color = "#FF6B9D", { outline = false, onClick = null } = {}) {
    const cls = "anima-t8-tag-chip" + (outline ? " outline" : "");
    const span = el("span", {
        class: cls,
        style: outline ? { color, background: "white" } : { background: color },
    }, text);
    if (onClick) span.addEventListener("click", onClick);
    return span;
}

export function confirmDialog(message) {
    return new Promise((resolve) => {
        // 简化版：用浏览器 confirm，避免引入额外组件
        resolve(window.confirm(message));
    });
}
