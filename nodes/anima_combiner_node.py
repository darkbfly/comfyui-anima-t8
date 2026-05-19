"""Anima Prompt Combiner T8：将多段提示词按指定分隔符拼接。"""


class AnimaPromptCombinerT8:
    """多段拼接节点：character / scene / quality / extra / style 等。"""

    CATEGORY = "Anima/T8"
    FUNCTION = "combine"
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("COMBINED",)

    @classmethod
    def INPUT_TYPES(cls):
        text_opt = ("STRING", {"multiline": True, "default": ""})
        return {
            "required": {
                "separator": ("STRING", {"default": ", "}),
            },
            "optional": {
                "part_1": text_opt,
                "part_2": text_opt,
                "part_3": text_opt,
                "part_4": text_opt,
                "part_5": text_opt,
                "part_6": text_opt,
            },
        }

    def combine(self, separator: str = ", ", **parts):
        # parts 中只取非空字符串，按 part_1..part_6 顺序
        ordered = [parts.get(f"part_{i}", "") for i in range(1, 7)]
        cleaned = [(p or "").strip().strip(",") for p in ordered]
        cleaned = [p for p in cleaned if p]
        return ((separator or ", ").join(cleaned),)


NODE_CLASS_MAPPINGS = {"AnimaPromptCombinerT8": AnimaPromptCombinerT8}
NODE_DISPLAY_NAME_MAPPINGS = {"AnimaPromptCombinerT8": "Anima Prompt Combiner T8"}
