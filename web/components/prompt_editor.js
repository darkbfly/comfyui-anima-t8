// 三段式提示词编辑器（用于新建 / 编辑提示词条目）
import { AnimaApi } from "../api.js";
import { el, showToast, tagChip } from "./tag_chip.js";

export function openPromptEditor(initial, { onSaved } = {}) {
    const data = Object.assign({
        id: "",
        title: "",
        description: "",
        positive_prompt: "",
        negative_prompt: "",
        artist_prompt: "",
        width: 896, height: 1088, steps: 30, cfg_scale: 5.5,
        is_favorite: false, is_pinned: false,
        tag_ids: [],
    }, initial || {});

    const mask = el("div", { class: "anima-t8-mask" });
    const titleInput = el("input", { class: "anima-t8-input", placeholder: "标题" });
    titleInput.value = data.title;
    const descInput = el("input", { class: "anima-t8-input", placeholder: "描述（可选）" });
    descInput.value = data.description;

    const posTA = el("textarea", { placeholder: "正向提示词" });
    posTA.value = data.positive_prompt;
    const negTA = el("textarea", { placeholder: "负向提示词" });
    negTA.value = data.negative_prompt;
    const styleTA = el("textarea", { placeholder: "风格 / 艺术家" });
    styleTA.value = data.artist_prompt;

    const wEl = el("input", { class: "anima-t8-input", type: "number", style: { width: "90px" } }); wEl.value = data.width;
    const hEl = el("input", { class: "anima-t8-input", type: "number", style: { width: "90px" } }); hEl.value = data.height;
    const sEl = el("input", { class: "anima-t8-input", type: "number", style: { width: "90px" } }); sEl.value = data.steps;
    const cEl = el("input", { class: "anima-t8-input", type: "number", step: "0.1", style: { width: "90px" } }); cEl.value = data.cfg_scale;

    const tagsBox = el("div", { class: "anima-t8-row", style: { flexWrap: "wrap", gap: "4px" } });
    const tagState = new Set(data.tag_ids || []);

    AnimaApi.listTags().then(tags => {
        tagsBox.innerHTML = "";
        if (!tags || tags.length === 0) {
            tagsBox.append(el("span", { style: { fontSize: "12px", color: "#8aa0bf" } }, "（暂无标签，可在提示词列表页创建）"));
            return;
        }
        tags.forEach(t => {
            const checked = tagState.has(t.id);
            const chip = tagChip(t.name, t.color, {
                outline: !checked,
                onClick: () => {
                    if (tagState.has(t.id)) tagState.delete(t.id);
                    else tagState.add(t.id);
                    chip.classList.toggle("outline");
                    if (chip.classList.contains("outline")) {
                        chip.style.background = "white"; chip.style.color = t.color;
                    } else {
                        chip.style.background = t.color; chip.style.color = "white";
                    }
                },
            });
            tagsBox.append(chip);
        });
    });

    const panel = el("div", { class: "anima-t8-panel" },
        el("div", { class: "anima-t8-header" },
            el("h2", {}, data.id ? "✏ 编辑提示词" : "➕ 新建提示词"),
            el("button", { class: "anima-t8-close", onclick: () => mask.remove() }, "×"),
        ),
        el("div", { class: "anima-t8-main anima-t8-editor" },
            el("label", {}, "标题"), titleInput,
            el("label", {}, "描述"), descInput,
            el("label", {}, "正向提示词 (Positive)"), posTA,
            el("label", {}, "负向提示词 (Negative)"), negTA,
            el("label", {}, "风格 / 艺术家 (Style)"), styleTA,
            el("label", {}, "生成参数"),
            el("div", { class: "anima-t8-row" },
                el("span", { style: { fontSize: "12px" } }, "宽"), wEl,
                el("span", { style: { fontSize: "12px" } }, "高"), hEl,
                el("span", { style: { fontSize: "12px" } }, "步数"), sEl,
                el("span", { style: { fontSize: "12px" } }, "CFG"), cEl,
            ),
            el("label", {}, "标签"), tagsBox,
            el("div", { class: "anima-t8-row", style: { marginTop: "12px", justifyContent: "flex-end" } },
                el("button", { class: "anima-t8-btn", onclick: () => mask.remove() }, "取消"),
                el("button", {
                    class: "anima-t8-btn primary",
                    onclick: async () => {
                        const payload = {
                            id: data.id || undefined,
                            title: titleInput.value.trim() || "(未命名)",
                            description: descInput.value,
                            positive_prompt: posTA.value,
                            negative_prompt: negTA.value,
                            artist_prompt: styleTA.value,
                            width: parseInt(wEl.value) || 896,
                            height: parseInt(hEl.value) || 1088,
                            steps: parseInt(sEl.value) || 30,
                            cfg_scale: parseFloat(cEl.value) || 5.5,
                            is_favorite: data.is_favorite,
                            is_pinned: data.is_pinned,
                            tag_ids: Array.from(tagState),
                        };
                        try {
                            const saved = await AnimaApi.upsertPrompt(payload);
                            showToast("已保存");
                            mask.remove();
                            onSaved && onSaved(saved);
                        } catch (e) {
                            showToast("保存失败：" + e.message);
                        }
                    }
                }, "💾 保存"),
            ),
        ),
    );

    mask.append(panel);
    mask.addEventListener("click", (e) => { if (e.target === mask) mask.remove(); });
    document.body.appendChild(mask);
}
