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
            },
        }

    @staticmethod
    def _part_keys(parts):
        indexed = []
        for key in parts:
            if not key.startswith("part_"):
                continue
            suffix = key[5:]
            if suffix.isdigit():
                indexed.append((int(suffix), key))
        indexed.sort(key=lambda item: item[0])
        return [key for _, key in indexed]

    def combine(self, separator: str = ", ", **parts):
        ordered = [parts.get(key, "") for key in self._part_keys(parts)]
        cleaned = [(p or "").strip().strip(",") for p in ordered]
        cleaned = [p for p in cleaned if p]
        return ((separator or ", ").join(cleaned),)


NODE_CLASS_MAPPINGS = {"AnimaPromptCombinerT8": AnimaPromptCombinerT8}
NODE_DISPLAY_NAME_MAPPINGS = {"AnimaPromptCombinerT8": "Anima Prompt Combiner T8"}
