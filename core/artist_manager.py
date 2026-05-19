"""艺术家风格管理：远程拉取 + 本地缓存 + Pin。"""
import time
from typing import List, Dict, Any, Optional
from .db import get_db
from .models import _now_ms
try:
    from api.artist_client import ArtistClient
except Exception:
    from ..api.artist_client import ArtistClient  # 兜底


_CACHE_TTL_MS = 24 * 60 * 60 * 1000   # 24h


class ArtistManager:
    def __init__(self):
        self._client = ArtistClient()

    def fetch(self, force_refresh: bool = False) -> List[Dict[str, Any]]:
        db = get_db()
        if not force_refresh:
            row = db.fetchone("SELECT MAX(updated_at) AS u FROM artists_cache")
            latest = (row or {}).get("u") or 0
            if latest and (_now_ms() - latest) < _CACHE_TTL_MS:
                return self._read_local()

        artists = self._client.fetch_all()
        if not artists:
            return self._read_local()

        now = _now_ms()
        rows = []
        for a in artists:
            rows.append((
                a.get("slug") or "",
                a.get("tag") or "",
                a.get("imageId") or a.get("image_id") or "",
                int(a.get("postCount") or a.get("post_count") or 0),
                a.get("shard") or "",
                1 if a.get("hasImage") or a.get("has_image") else 0,
                now,
            ))
        # 单事务批量写入（避免为每条 INSERT 开启独立事务）
        if rows:
            with db.transaction() as conn:
                conn.execute("DELETE FROM artists_cache")
                conn.executemany(
                    """INSERT OR REPLACE INTO artists_cache
                       (slug, tag, image_id, post_count, shard, has_image, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    rows,
                )
        return self._read_local()

    def _read_local(self) -> List[Dict[str, Any]]:
        db = get_db()
        rows = db.fetchall(
            "SELECT * FROM artists_cache ORDER BY post_count DESC, slug ASC"
        )
        pinned_set = {r["slug"] for r in db.fetchall("SELECT slug FROM pinned_artists")}
        for r in rows:
            r["is_pinned"] = r["slug"] in pinned_set
            r["image_url"] = self._client.image_url(r["image_id"]) if r["has_image"] else ""
        return rows

    def search(self, keyword: str = "", page: int = 1, page_size: int = 60,
               pinned_only: bool = False, letter: str = "",
               with_image_only: bool = False) -> Dict[str, Any]:
        all_list = self._read_local()
        if not all_list:
            # 尝试触发首次拉取
            self.fetch(force_refresh=False)
            all_list = self._read_local()

        kw = (keyword or "").strip().lower()
        if kw:
            all_list = [
                a for a in all_list
                if kw in (a["slug"] or "").lower() or kw in (a["tag"] or "").lower()
            ]
        if pinned_only:
            all_list = [a for a in all_list if a.get("is_pinned")]
        if with_image_only:
            all_list = [a for a in all_list if a.get("has_image")]
        # 按首字母筛选：letter 可为 'a'..'z' 或 '#'（非字母开头）
        lt = (letter or "").strip().lower()
        if lt:
            if lt == "#":
                all_list = [a for a in all_list
                            if not (a["slug"] and a["slug"][0].isalpha())]
            elif len(lt) == 1 and lt.isalpha():
                all_list = [a for a in all_list
                            if a["slug"] and a["slug"][0].lower() == lt]

        # 置顶优先
        all_list.sort(key=lambda a: (not a.get("is_pinned"), -int(a.get("post_count") or 0)))

        total = len(all_list)
        start = max(0, (page - 1) * page_size)
        end = start + page_size
        return {
            "total": total,
            "page": page,
            "page_size": page_size,
            "items": all_list[start:end],
        }

    def pin(self, slug: str, pinned: bool) -> bool:
        db = get_db()
        if pinned:
            db.execute(
                "INSERT OR REPLACE INTO pinned_artists(slug, pinned_at) VALUES (?, ?)",
                (slug, _now_ms()),
            )
        else:
            db.execute("DELETE FROM pinned_artists WHERE slug = ?", (slug,))
        return True

    def image_url(self, image_id: str) -> str:
        return self._client.image_url(image_id)


_MANAGER: Optional[ArtistManager] = None


def get_artist_manager() -> ArtistManager:
    global _MANAGER
    if _MANAGER is None:
        _MANAGER = ArtistManager()
    return _MANAGER
