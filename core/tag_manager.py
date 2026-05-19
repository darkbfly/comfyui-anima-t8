"""标签管理。"""
import json
import os
from typing import List, Dict, Any, Optional
from .db import get_db
from .models import Tag, _gen_id


def list_tags() -> List[Dict[str, Any]]:
    return get_db().fetchall("SELECT * FROM tags ORDER BY name ASC")


def get_tag(tag_id: str) -> Optional[Dict[str, Any]]:
    return get_db().fetchone("SELECT * FROM tags WHERE id = ?", (tag_id,))


def upsert_tag(name: str, color: str = "#FF6B9D", tag_id: Optional[str] = None) -> Dict[str, Any]:
    db = get_db()
    name = (name or "").strip()
    if not name:
        raise ValueError("标签名不能为空")
    if not tag_id:
        existing = db.fetchone("SELECT * FROM tags WHERE name = ?", (name,))
        if existing:
            return existing
        tag_id = _gen_id()
    db.execute(
        "INSERT OR REPLACE INTO tags(id, name, color) VALUES (?, ?, ?)",
        (tag_id, name, color or "#FF6B9D"),
    )
    return {"id": tag_id, "name": name, "color": color or "#FF6B9D"}


def delete_tag(tag_id: str) -> bool:
    db = get_db()
    db.execute("DELETE FROM tags WHERE id = ?", (tag_id,))
    return True


def ensure_default_tags() -> None:
    """首次启动时写入内置默认标签。"""
    db = get_db()
    if db.fetchone("SELECT COUNT(*) AS c FROM tags")["c"] > 0:
        return
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    path = os.path.join(root, "data", "default_tags.json")
    if not os.path.exists(path):
        return
    try:
        with open(path, "r", encoding="utf-8") as f:
            tags = json.load(f)
        for t in tags:
            upsert_tag(t.get("name", ""), t.get("color", "#FF6B9D"))
    except Exception as e:
        print("[anima_t8] 加载默认标签失败:", e)
