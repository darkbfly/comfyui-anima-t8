"""Anima Saved Prompt Loader T8：从本地风格库按标题加载。"""
try:
    from core import prompt_manager
except Exception:
    from ..core import prompt_manager


def _all_titles():
    try:
        items = prompt_manager.list_prompts()
        labels = []
        for p in items:
            mark = ""
            if p.get("is_pinned"):
                mark = "📌 "
            elif p.get("is_favorite"):
                mark = "⭐ "
            labels.append(f"{mark}{p.get('title') or '(无标题)'}|||{p.get('id')}")
        if not labels:
            labels = ["(库中暂无)"]
        return labels
    except Exception as e:
        print("[anima_t8] 加载提示词列表失败:", e)
        return ["(加载失败)"]


class AnimaSavedPromptLoaderT8:
    """从已保存的风格库加载条目。

    选项格式：`<标记> <标题>|||<id>`，加载时按 `|||` 后的 id 精确取数据。
    """

    CATEGORY = "Anima/T8"
    FUNCTION = "load"
    RETURN_TYPES = ("STRING", "STRING", "STRING", "INT", "INT", "INT", "FLOAT")
    RETURN_NAMES = ("POSITIVE", "NEGATIVE", "STYLE", "WIDTH", "HEIGHT", "STEPS", "CFG")

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompt": (_all_titles(),),
            }
        }

    @classmethod
    def IS_CHANGED(cls, prompt):
        # 永远视为改变，确保每次刷新都重读数据库
        import time
        return time.time()

    def load(self, prompt: str):
        if not prompt or "|||" not in prompt:
            return ("", "", "", 896, 1088, 30, 5.5)
        try:
            pid = prompt.split("|||", 1)[1]
            data = prompt_manager.get_prompt(pid)
            if not data:
                return ("", "", "", 896, 1088, 30, 5.5)
            return (
                data.get("positive_prompt", "") or "",
                data.get("negative_prompt", "") or "",
                data.get("artist_prompt", "") or "",
                int(data.get("width") or 896),
                int(data.get("height") or 1088),
                int(data.get("steps") or 30),
                float(data.get("cfg_scale") or 5.5),
            )
        except Exception as e:
            print("[anima_t8] 加载提示词失败:", e)
            return ("", "", "", 896, 1088, 30, 5.5)


NODE_CLASS_MAPPINGS = {"AnimaSavedPromptLoaderT8": AnimaSavedPromptLoaderT8}
NODE_DISPLAY_NAME_MAPPINGS = {"AnimaSavedPromptLoaderT8": "Anima Saved Prompt Loader T8"}
