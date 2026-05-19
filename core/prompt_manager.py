"""提示词与片段收藏管理。"""
import json
import os
from typing import List, Optional, Dict, Any
from .db import get_db
from .models import Prompt, FavoriteSnippet, _now_ms, _gen_id


# ---------- 完整提示词 (Prompt) ----------

def list_prompts(
    keyword: Optional[str] = None,
    tag_id: Optional[str] = None,
    favorite_only: bool = False,
    pinned_only: bool = False,
) -> List[Dict[str, Any]]:
    db = get_db()
    where = []
    params: list = []
    if keyword:
        where.append(
            "(title LIKE ? OR description LIKE ? OR positive_prompt LIKE ? "
            "OR negative_prompt LIKE ? OR artist_prompt LIKE ?)"
        )
        kw = f"%{keyword}%"
        params += [kw, kw, kw, kw, kw]
    if favorite_only:
        where.append("is_favorite = 1")
    if pinned_only:
        where.append("is_pinned = 1")

    base_sql = "SELECT * FROM prompts"
    if tag_id:
        base_sql = (
            "SELECT p.* FROM prompts p "
            "INNER JOIN prompt_tag_ref r ON r.prompt_id = p.id "
            "WHERE r.tag_id = ?"
        )
        params.insert(0, tag_id)
        if where:
            base_sql += " AND " + " AND ".join(where)
    else:
        if where:
            base_sql += " WHERE " + " AND ".join(where)

    base_sql += " ORDER BY is_pinned DESC, is_favorite DESC, updated_at DESC"

    rows = db.fetchall(base_sql, tuple(params))
    if not rows:
        return []

    ids = [r["id"] for r in rows]
    qmarks = ",".join("?" * len(ids))
    refs = db.fetchall(
        f"SELECT prompt_id, tag_id FROM prompt_tag_ref WHERE prompt_id IN ({qmarks})",
        tuple(ids),
    )
    tag_map: Dict[str, List[str]] = {}
    for r in refs:
        tag_map.setdefault(r["prompt_id"], []).append(r["tag_id"])

    return [Prompt.from_row(r, tag_map.get(r["id"], [])).to_dict() for r in rows]


def get_prompt(prompt_id: str) -> Optional[Dict[str, Any]]:
    db = get_db()
    row = db.fetchone("SELECT * FROM prompts WHERE id = ?", (prompt_id,))
    if not row:
        return None
    refs = db.fetchall(
        "SELECT tag_id FROM prompt_tag_ref WHERE prompt_id = ?", (prompt_id,)
    )
    tag_ids = [r["tag_id"] for r in refs]
    return Prompt.from_row(row, tag_ids).to_dict()


def upsert_prompt(data: Dict[str, Any]) -> Dict[str, Any]:
    db = get_db()
    pid = data.get("id") or _gen_id()
    now = _now_ms()
    existing = db.fetchone("SELECT id, created_at FROM prompts WHERE id = ?", (pid,))
    created_at = existing["created_at"] if existing else now

    db.execute(
        """
        INSERT OR REPLACE INTO prompts (
            id, title, description, positive_prompt, negative_prompt, artist_prompt,
            seed, parameters, width, height, steps, cfg_scale,
            is_favorite, is_pinned, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            pid,
            data.get("title", "") or "",
            data.get("description", "") or "",
            data.get("positive_prompt", "") or "",
            data.get("negative_prompt", "") or "",
            data.get("artist_prompt", "") or "",
            data.get("seed", "") or "",
            data.get("parameters", "") or "",
            int(data.get("width", 896) or 896),
            int(data.get("height", 1088) or 1088),
            int(data.get("steps", 30) or 30),
            float(data.get("cfg_scale", 5.5) or 5.5),
            1 if data.get("is_favorite") else 0,
            1 if data.get("is_pinned") else 0,
            int(created_at),
            now,
        ),
    )

    # 更新 tag 关联
    tag_ids = data.get("tag_ids") or []
    db.execute("DELETE FROM prompt_tag_ref WHERE prompt_id = ?", (pid,))
    if tag_ids:
        db.executemany(
            "INSERT OR IGNORE INTO prompt_tag_ref(prompt_id, tag_id) VALUES (?, ?)",
            [(pid, t) for t in tag_ids],
        )

    return get_prompt(pid) or {}


def delete_prompt(prompt_id: str) -> bool:
    db = get_db()
    db.execute("DELETE FROM prompts WHERE id = ?", (prompt_id,))
    return True


def toggle_favorite(prompt_id: str) -> Optional[Dict[str, Any]]:
    db = get_db()
    row = db.fetchone("SELECT is_favorite FROM prompts WHERE id = ?", (prompt_id,))
    if not row:
        return None
    new_val = 0 if row["is_favorite"] else 1
    db.execute(
        "UPDATE prompts SET is_favorite = ?, updated_at = ? WHERE id = ?",
        (new_val, _now_ms(), prompt_id),
    )
    return get_prompt(prompt_id)


def toggle_pin(prompt_id: str) -> Optional[Dict[str, Any]]:
    db = get_db()
    row = db.fetchone("SELECT is_pinned FROM prompts WHERE id = ?", (prompt_id,))
    if not row:
        return None
    new_val = 0 if row["is_pinned"] else 1
    db.execute(
        "UPDATE prompts SET is_pinned = ?, updated_at = ? WHERE id = ?",
        (new_val, _now_ms(), prompt_id),
    )
    return get_prompt(prompt_id)


# ---------- 片段收藏 (FavoriteSnippet) ----------

def list_snippets(snippet_type: Optional[str] = None) -> List[Dict[str, Any]]:
    db = get_db()
    if snippet_type:
        rows = db.fetchall(
            "SELECT * FROM favorite_snippets WHERE type = ? ORDER BY created_at DESC",
            (snippet_type,),
        )
    else:
        rows = db.fetchall(
            "SELECT * FROM favorite_snippets ORDER BY created_at DESC"
        )
    return rows


def add_snippet(content: str, snippet_type: str = "positive") -> Dict[str, Any]:
    db = get_db()
    sid = _gen_id()
    now = _now_ms()
    db.execute(
        "INSERT INTO favorite_snippets(id, content, type, created_at) VALUES (?, ?, ?, ?)",
        (sid, content, snippet_type, now),
    )
    return {"id": sid, "content": content, "type": snippet_type, "created_at": now}


def delete_snippet(snippet_id: str) -> bool:
    get_db().execute("DELETE FROM favorite_snippets WHERE id = ?", (snippet_id,))
    return True


# ---------- 导入 / 导出 ----------

# ---------- 默认种子提示词 ----------

def ensure_default_prompts() -> int:
    """写入内置的默认模板提示词（来源：data/default_prompts.json）。

    按 title 增量：库里已存在同名 title 跳过，新提供的模板补入。
    这样不会覆盖/破坏用户已编辑过的数据，也能随着 json 更新不断补充。
    返回实际新增写入的提示词数量。
    """
    db = get_db()
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    path = os.path.join(root, "data", "default_prompts.json")
    if not os.path.exists(path):
        return 0
    try:
        with open(path, "r", encoding="utf-8") as f:
            seeds = json.load(f)
    except Exception as e:
        print("[anima_t8] 加载默认提示词失败:", e)
        return 0

    existing_titles = {r["title"] for r in db.fetchall("SELECT title FROM prompts")}
    tag_rows = db.fetchall("SELECT id, name FROM tags")
    tag_map = {r["name"]: r["id"] for r in tag_rows}

    n = 0
    from .db import DEFAULT_NEGATIVE_PROMPT
    for s in seeds:
        title = s.get("title", "") or ""
        if not title or title in existing_titles:
            continue
        names = s.get("tag_names") or []
        tag_ids = [tag_map[n] for n in names if n in tag_map]
        upsert_prompt({
            "title": title,
            "description": s.get("description", ""),
            "positive_prompt": s.get("positive_prompt", ""),
            "negative_prompt": s.get("negative_prompt", "") or DEFAULT_NEGATIVE_PROMPT,
            "artist_prompt": s.get("artist_prompt", ""),
            "is_favorite": bool(s.get("is_favorite")),
            "is_pinned": bool(s.get("is_pinned")),
            "tag_ids": tag_ids,
        })
        existing_titles.add(title)
        n += 1
    if n > 0:
        print(f"[anima_t8] 已补入 {n} 个新默认提示词")
    return n


def export_all() -> Dict[str, Any]:
    db = get_db()
    return {
        "prompts": db.fetchall("SELECT * FROM prompts"),
        "tags": db.fetchall("SELECT * FROM tags"),
        "prompt_tag_ref": db.fetchall("SELECT * FROM prompt_tag_ref"),
        "favorite_snippets": db.fetchall("SELECT * FROM favorite_snippets"),
        "version": 1,
    }


def import_all(data: Dict[str, Any], replace: bool = False) -> Dict[str, int]:
    db = get_db()
    if replace:
        db.execute("DELETE FROM prompt_tag_ref")
        db.execute("DELETE FROM prompts")
        db.execute("DELETE FROM tags")
        db.execute("DELETE FROM favorite_snippets")

    cnt = {"prompts": 0, "tags": 0, "snippets": 0}

    for t in data.get("tags") or []:
        db.execute(
            "INSERT OR IGNORE INTO tags(id, name, color) VALUES (?, ?, ?)",
            (t.get("id") or _gen_id(), t.get("name") or "", t.get("color") or "#FF6B9D"),
        )
        cnt["tags"] += 1

    for p in data.get("prompts") or []:
        upsert_prompt(p)
        cnt["prompts"] += 1

    for ref in data.get("prompt_tag_ref") or []:
        db.execute(
            "INSERT OR IGNORE INTO prompt_tag_ref(prompt_id, tag_id) VALUES (?, ?)",
            (ref["prompt_id"], ref["tag_id"]),
        )

    for s in data.get("favorite_snippets") or []:
        db.execute(
            "INSERT OR IGNORE INTO favorite_snippets(id, content, type, created_at) VALUES (?, ?, ?, ?)",
            (
                s.get("id") or _gen_id(),
                s.get("content") or "",
                s.get("type") or "positive",
                int(s.get("created_at") or _now_ms()),
            ),
        )
        cnt["snippets"] += 1

    return cnt
