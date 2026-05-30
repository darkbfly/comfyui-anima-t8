"""
Gelbooru Tags 管理器
====================
维护独立的 Gelbooru 标签缓存，不影响 Danbooru 的表和逻辑。
"""

from __future__ import annotations

import time
import urllib.parse
from typing import Any, Dict, List, Optional

from core.db import get_db
from api.gelbooru_client import (
    CATEGORY_NAMES,
    autocomplete_tags,
    fetch_preview_post,
    fetch_tags,
    normalize_category,
)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS gelbooru_tags (
    name        TEXT NOT NULL,
    category    INTEGER NOT NULL,
    post_count  INTEGER NOT NULL DEFAULT 0,
    pinned      INTEGER NOT NULL DEFAULT 0,
    pinned_at   REAL    NOT NULL DEFAULT 0,
    updated_at  REAL    NOT NULL DEFAULT 0,
    PRIMARY KEY (name, category)
);
CREATE INDEX IF NOT EXISTS idx_gbt_category   ON gelbooru_tags(category);
CREATE INDEX IF NOT EXISTS idx_gbt_post_count ON gelbooru_tags(post_count DESC);
CREATE INDEX IF NOT EXISTS idx_gbt_pinned     ON gelbooru_tags(pinned DESC);
"""


class GelbooruManager:
    def __init__(self):
        self.db = get_db()
        self.db.conn().executescript(_SCHEMA)

    def count(self, category) -> int:
        category = normalize_category(category)
        row = self.db.fetchone(
            "SELECT COUNT(*) AS c FROM gelbooru_tags WHERE category=?",
            (category,),
        )
        return int(row["c"]) if row else 0

    def fetch(self, category, force_refresh: bool = False,
              max_pages: int = 10, page_size: int = 100) -> int:
        category = normalize_category(category)
        if not force_refresh and self.count(category) > 0:
            return self.count(category)

        rows = fetch_tags(category, max_pages=max_pages, page_size=page_size)
        now = time.time()
        with self.db.transaction() as conn:
            conn.execute("DELETE FROM gelbooru_tags WHERE category=? AND pinned=0",
                         (category,))
            for r in rows:
                conn.execute(
                    "INSERT INTO gelbooru_tags(name, category, post_count, pinned, pinned_at, updated_at) "
                    "VALUES (?,?,?,0,0,?) "
                    "ON CONFLICT(name, category) DO UPDATE SET "
                    "  post_count=excluded.post_count, updated_at=excluded.updated_at",
                    (r["name"], r["category"], r["post_count"], now),
                )
        return self.count(category)

    def search(self, category, keyword: str = "", page: int = 1,
               page_size: int = 60, pinned_only: bool = False,
               letter: str = "") -> Dict[str, Any]:
        category = normalize_category(category)
        kw = (keyword or "").strip().lower()
        lt = (letter or "").strip().lower()

        wh = ["category=?"]
        params: List[Any] = [category]
        if kw:
            wh.append("LOWER(name) LIKE ?")
            params.append(f"%{kw}%")
        if pinned_only:
            wh.append("pinned=1")
        if lt:
            if lt == "#":
                wh.append("(LOWER(SUBSTR(name,1,1)) NOT BETWEEN 'a' AND 'z')")
            elif len(lt) == 1 and lt.isalpha():
                wh.append("LOWER(SUBSTR(name,1,1))=?")
                params.append(lt)

        if kw:
            self._cache_autocomplete(category, kw)

        where_sql = " WHERE " + " AND ".join(wh)

        total_row = self.db.fetchone(
            f"SELECT COUNT(*) AS c FROM gelbooru_tags{where_sql}",
            tuple(params),
        )
        total = int(total_row["c"]) if total_row else 0

        offset = max(0, (page - 1) * page_size)
        rows = self.db.fetchall(
            f"SELECT name, category, post_count, pinned "
            f"FROM gelbooru_tags{where_sql} "
            f"ORDER BY pinned DESC, post_count DESC, name ASC "
            f"LIMIT ? OFFSET ?",
            tuple(params) + (page_size, offset),
        )

        items = []
        for r in rows:
            items.append({
                "slug": r["name"],
                "tag": r["name"],
                "category": r["category"],
                "category_name": CATEGORY_NAMES.get(r["category"], "general"),
                "post_count": r["post_count"],
                "pinned": bool(r["pinned"]),
                "has_image": False,
                "image_url": "",
            })
        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    def _cache_autocomplete(self, category: int, keyword: str) -> None:
        rows = autocomplete_tags(keyword, category, limit=50)
        if not rows:
            return
        now = time.time()
        with self.db.transaction() as conn:
            for r in rows:
                conn.execute(
                    "INSERT INTO gelbooru_tags(name, category, post_count, pinned, pinned_at, updated_at) "
                    "VALUES (?,?,?,0,0,?) "
                    "ON CONFLICT(name, category) DO UPDATE SET "
                    "  post_count=excluded.post_count, updated_at=excluded.updated_at",
                    (r["name"], r["category"], r["post_count"], now),
                )

    def fetch_preview(self, name: str) -> Dict[str, str]:
        if not name:
            return {"image_url": "", "sample_url": "", "source_url": ""}
        cached = _PREVIEW_CACHE.get(name)
        if cached is not None:
            return cached

        raw = fetch_preview_post(name)
        result = {"image_url": "", "sample_url": "", "source_url": raw.get("source_url", "")}
        if raw.get("image_url"):
            result["image_url"] = "/anima_t8/gtags/image?u=" + urllib.parse.quote(raw["image_url"], safe="")
        if raw.get("sample_url"):
            result["sample_url"] = "/anima_t8/gtags/image?u=" + urllib.parse.quote(raw["sample_url"], safe="")

        if result["image_url"]:
            _PREVIEW_CACHE[name] = result
            if len(_PREVIEW_CACHE) > 4096:
                for k in list(_PREVIEW_CACHE.keys())[:2048]:
                    _PREVIEW_CACHE.pop(k, None)
        return result

    def set_pinned(self, name: str, category, pinned: bool) -> bool:
        category = normalize_category(category)
        now = time.time() if pinned else 0
        cur = self.db.execute(
            "UPDATE gelbooru_tags SET pinned=?, pinned_at=? WHERE name=? AND category=?",
            (1 if pinned else 0, now, name, category),
        )
        return cur.rowcount > 0


_PREVIEW_CACHE: Dict[str, Dict[str, str]] = {}
_MGR: Optional[GelbooruManager] = None


def get_gelbooru_manager() -> GelbooruManager:
    global _MGR
    if _MGR is None:
        _MGR = GelbooruManager()
    return _MGR
