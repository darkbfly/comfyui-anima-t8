"""
comfyui-anima-t8
================
Anima 动漫提示词生成器 ComfyUI 自定义节点。

- 风格库：正/负/风格三段式管理（标签、搜索、收藏、置顶）
- 艺术家库：1000+ 画师标签（搜索、预览、Pin、一键插入）
- 数据来源：https://anima.mooshieblob.com/
"""
import os
import sys
import traceback

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
if _THIS_DIR not in sys.path:
    sys.path.insert(0, _THIS_DIR)

try:
    from .nodes.anima_prompt_node import AnimaPromptT8
    from .nodes.anima_artist_node import AnimaArtistStyleT8
    from .nodes.anima_combiner_node import AnimaPromptCombinerT8
    from .nodes.anima_loader_node import AnimaSavedPromptLoaderT8
    from .nodes.gelbooru_style_node import AnimaGelbooruStyleT8

    NODE_CLASS_MAPPINGS.update({
        "AnimaPromptT8": AnimaPromptT8,
        "AnimaArtistStyleT8": AnimaArtistStyleT8,
        "AnimaPromptCombinerT8": AnimaPromptCombinerT8,
        "AnimaSavedPromptLoaderT8": AnimaSavedPromptLoaderT8,
        "AnimaGelbooruStyleT8": AnimaGelbooruStyleT8,
    })
    NODE_DISPLAY_NAME_MAPPINGS.update({
        "AnimaPromptT8": "Anima Prompt T8",
        "AnimaArtistStyleT8": "Anima Artist Style T8",
        "AnimaPromptCombinerT8": "Anima Prompt Combiner T8",
        "AnimaSavedPromptLoaderT8": "Anima Saved Prompt Loader T8",
        "AnimaGelbooruStyleT8": "Anima Gelbooru Style T8",
    })
except Exception:
    print("[comfyui-anima-t8] 节点加载失败：")
    traceback.print_exc()

# 注册 HTTP 路由（风格库 / 艺术家库 API）
try:
    from .server import routes as _routes  # noqa: F401
    _routes.register_routes()
    print("[comfyui-anima-t8] HTTP 路由注册成功 -> /anima_t8/*")
except Exception:
    print("[comfyui-anima-t8] HTTP 路由注册失败：")
    traceback.print_exc()

# 暴露 web 目录给 ComfyUI 前端
WEB_DIRECTORY = "./web"

# 后台预加载：首次启动异步拉取 1000+ 艺术家数据（不阻塞 ComfyUI 启动）
def _preload_assets():
    try:
        import threading
        def _job():
            try:
                from core import tag_manager, prompt_manager
                from core.artist_manager import get_artist_manager
                tag_manager.ensure_default_tags()
                prompt_manager.ensure_default_prompts()
                # 仅在本地缓存为空时拉取一次
                mgr = get_artist_manager()
                from core.db import get_db
                row = get_db().fetchone("SELECT COUNT(*) AS c FROM artists_cache")
                if (row or {}).get("c", 0) == 0:
                    print("[comfyui-anima-t8] 首次拉取艺术家库…")
                    arts = mgr.fetch(force_refresh=True)
                    print(f"[comfyui-anima-t8] 艺术家库已缓存：{len(arts)} 个")
                else:
                    print(f"[comfyui-anima-t8] 艺术家库已存在本地缓存：{row['c']} 个")
            except Exception:
                traceback.print_exc()
        threading.Thread(target=_job, name="anima-t8-preload", daemon=True).start()
    except Exception:
        traceback.print_exc()

_preload_assets()

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]

print("[comfyui-anima-t8] 已加载，节点数: {}".format(len(NODE_CLASS_MAPPINGS)))
