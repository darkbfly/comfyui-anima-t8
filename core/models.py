"""数据模型 dataclass，对应 AnimaForge App 中的 Room Entity / Artist 数据。"""
from dataclasses import dataclass, field, asdict
from typing import List, Optional
import time
import uuid


def _now_ms() -> int:
    return int(time.time() * 1000)


def _gen_id() -> str:
    return uuid.uuid4().hex


@dataclass
class Prompt:
    id: str = field(default_factory=_gen_id)
    title: str = ""
    description: str = ""
    positive_prompt: str = ""
    negative_prompt: str = ""
    artist_prompt: str = ""        # 风格 / 艺术家提示
    seed: str = ""
    parameters: str = ""
    width: int = 896
    height: int = 1088
    steps: int = 30
    cfg_scale: float = 5.5
    is_favorite: bool = False
    is_pinned: bool = False
    created_at: int = field(default_factory=_now_ms)
    updated_at: int = field(default_factory=_now_ms)
    tag_ids: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        d = asdict(self)
        return d

    @staticmethod
    def from_row(row: dict, tag_ids: Optional[List[str]] = None) -> "Prompt":
        return Prompt(
            id=row["id"],
            title=row["title"] or "",
            description=row["description"] or "",
            positive_prompt=row["positive_prompt"] or "",
            negative_prompt=row["negative_prompt"] or "",
            artist_prompt=row["artist_prompt"] or "",
            seed=row["seed"] or "",
            parameters=row["parameters"] or "",
            width=row["width"] or 896,
            height=row["height"] or 1088,
            steps=row["steps"] or 30,
            cfg_scale=row["cfg_scale"] or 5.5,
            is_favorite=bool(row["is_favorite"]),
            is_pinned=bool(row["is_pinned"]),
            created_at=row["created_at"] or _now_ms(),
            updated_at=row["updated_at"] or _now_ms(),
            tag_ids=tag_ids or [],
        )


@dataclass
class Tag:
    id: str = field(default_factory=_gen_id)
    name: str = ""
    color: str = "#FF6B9D"

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class FavoriteSnippet:
    id: str = field(default_factory=_gen_id)
    content: str = ""
    type: str = "positive"   # positive / negative / style
    created_at: int = field(default_factory=_now_ms)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Artist:
    slug: str = ""
    tag: str = ""
    image_id: str = ""
    post_count: int = 0
    shard: str = ""
    has_image: bool = False
    is_pinned: bool = False

    def to_dict(self) -> dict:
        return asdict(self)
