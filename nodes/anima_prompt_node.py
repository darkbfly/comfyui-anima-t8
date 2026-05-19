"""Anima Prompt T8 主节点：三段式 (positive / negative / style) 提示词输出。"""
try:
    from core.db import DEFAULT_NEGATIVE_PROMPT
except Exception:
    from ..core.db import DEFAULT_NEGATIVE_PROMPT


class AnimaPromptT8:
    """正/负/风格三段式提示词节点。

    - positive : 正向提示
    - negative : 负向提示（默认填充 Anima 推荐 negative）
    - style    : 风格 / 艺术家提示
    输出 4 路：POSITIVE / NEGATIVE / STYLE / MERGED_POSITIVE
    """

    CATEGORY = "Anima/T8"
    FUNCTION = "generate"
    RETURN_TYPES = ("STRING", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("POSITIVE", "NEGATIVE", "STYLE", "MERGED_POSITIVE")
    OUTPUT_NODE = False

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "positive": ("STRING", {
                    "multiline": True,
                    "default": "score_9,score_8,score_7,1girl, masterpiece, best quality, ultra detailed",
                    "placeholder": "正向提示词 (Positive)",
                }),
                "negative": ("STRING", {
                    "multiline": True,
                    "default": DEFAULT_NEGATIVE_PROMPT,
                    "placeholder": "负向提示词 (Negative)",
                }),
                "style": ("STRING", {
                    "multiline": True,
                    "default": "",
                    "placeholder": "风格 / 艺术家提示，例如：(artist:wlop:1.1), (artist:hiten:0.9)",
                }),
            },
            "optional": {
                "merge_separator": ("STRING", {"default": ", "}),
            },
        }

    def generate(self, positive: str, negative: str, style: str, merge_separator: str = ", "):
        positive = (positive or "").strip()
        negative = (negative or "").strip()
        style = (style or "").strip()
        sep = merge_separator if merge_separator is not None else ", "

        merged = positive
        if style:
            merged = (positive + sep + style).strip(sep + " \n\t")
            if not positive:
                merged = style

        return (positive, negative, style, merged)


NODE_CLASS_MAPPINGS = {"AnimaPromptT8": AnimaPromptT8}
NODE_DISPLAY_NAME_MAPPINGS = {"AnimaPromptT8": "Anima Prompt T8"}
