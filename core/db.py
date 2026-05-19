"""SQLite 数据库封装。线程安全单例，自动建表，支持迁移。"""
import os
import sqlite3
import threading
from typing import Optional


_DEFAULT_NEGATIVE = (
    "lazyneg, lazyhand, censored, mosaic censoring, photorealistic, realistic, "
    "artist name, signature, lowres, bad anatomy, bad hands, text, error, "
    "missing fingers, extra fingers, fewer digits, cropped, worst quality, "
    "low quality, jpeg artifacts, watermark, username, sketch, jpeg "
    "Closed eyes, artifacts, signature, watermark, username, simple background, "
    "conjoined, bad ai-generated, shiny clothes, shiny skin, gold skin, "
    "white hair, halo,three hands"
)

DEFAULT_NEGATIVE_PROMPT = _DEFAULT_NEGATIVE


_SCHEMA = """
CREATE TABLE IF NOT EXISTS prompts (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL DEFAULT '',
    description     TEXT NOT NULL DEFAULT '',
    positive_prompt TEXT NOT NULL DEFAULT '',
    negative_prompt TEXT NOT NULL DEFAULT '',
    artist_prompt   TEXT NOT NULL DEFAULT '',
    seed            TEXT NOT NULL DEFAULT '',
    parameters      TEXT NOT NULL DEFAULT '',
    width           INTEGER NOT NULL DEFAULT 896,
    height          INTEGER NOT NULL DEFAULT 1088,
    steps           INTEGER NOT NULL DEFAULT 30,
    cfg_scale       REAL NOT NULL DEFAULT 5.5,
    is_favorite     INTEGER NOT NULL DEFAULT 0,
    is_pinned       INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
    id      TEXT PRIMARY KEY,
    name    TEXT NOT NULL UNIQUE,
    color   TEXT NOT NULL DEFAULT '#FF6B9D'
);

CREATE TABLE IF NOT EXISTS prompt_tag_ref (
    prompt_id TEXT NOT NULL,
    tag_id    TEXT NOT NULL,
    PRIMARY KEY (prompt_id, tag_id),
    FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id)    REFERENCES tags(id)    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS favorite_snippets (
    id          TEXT PRIMARY KEY,
    content     TEXT NOT NULL,
    type        TEXT NOT NULL DEFAULT 'positive',
    created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS artists_cache (
    slug        TEXT PRIMARY KEY,
    tag         TEXT NOT NULL DEFAULT '',
    image_id    TEXT NOT NULL DEFAULT '',
    post_count  INTEGER NOT NULL DEFAULT 0,
    shard       TEXT NOT NULL DEFAULT '',
    has_image   INTEGER NOT NULL DEFAULT 0,
    updated_at  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pinned_artists (
    slug        TEXT PRIMARY KEY,
    pinned_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prompts_pinned  ON prompts(is_pinned);
CREATE INDEX IF NOT EXISTS idx_prompts_fav     ON prompts(is_favorite);
CREATE INDEX IF NOT EXISTS idx_prompts_updated ON prompts(updated_at);
CREATE INDEX IF NOT EXISTS idx_artists_tag     ON artists_cache(tag);
"""


class Database:
    _instance: Optional["Database"] = None
    _lock = threading.Lock()

    def __init__(self, db_path: str):
        self.db_path = db_path
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self._conn_lock = threading.RLock()
        # 启动时检测数据库是否损坏，损坏则自动重建
        self._open_with_recovery(db_path)
        self._conn.row_factory = sqlite3.Row
        try:
            self._conn.execute("PRAGMA foreign_keys = ON;")
            self._conn.execute("PRAGMA journal_mode = WAL;")
        except sqlite3.DatabaseError:
            # PRAGMA 失败也视为损坏，强制重建一次
            self._rebuild(db_path)
        self._init_schema()

    def _open_with_recovery(self, db_path: str):
        """打开连接并运行完整性检查，损坏则重建。"""
        try:
            self._conn = sqlite3.connect(
                db_path, check_same_thread=False, isolation_level=None
            )
            cur = self._conn.execute("PRAGMA integrity_check;")
            row = cur.fetchone()
            if row and str(row[0]).lower() != "ok":
                raise sqlite3.DatabaseError(
                    f"integrity_check returned: {row[0]}")
        except sqlite3.DatabaseError as e:
            print(f"[anima_t8] 检测到数据库损坏：{e}，尝试重建…")
            self._rebuild(db_path)

    def _rebuild(self, db_path: str):
        """备份损坏文件并重新创建空库。"""
        try:
            self._conn.close()
        except Exception:
            pass
        import time
        ts = time.strftime("%Y%m%d_%H%M%S")
        for suffix in ("", "-wal", "-shm", "-journal"):
            p = db_path + suffix
            if os.path.exists(p):
                try:
                    os.rename(p, p + f".corrupt.{ts}")
                except Exception:
                    try:
                        os.remove(p)
                    except Exception:
                        pass
        self._conn = sqlite3.connect(
            db_path, check_same_thread=False, isolation_level=None
        )
        print("[anima_t8] 数据库已重建：" + db_path)

    def _init_schema(self):
        with self._conn_lock:
            self._conn.executescript(_SCHEMA)

    def conn(self) -> sqlite3.Connection:
        return self._conn

    def execute(self, sql: str, params: tuple = ()) -> sqlite3.Cursor:
        with self._conn_lock:
            return self._conn.execute(sql, params)

    def executemany(self, sql: str, seq):
        with self._conn_lock:
            return self._conn.executemany(sql, seq)

    def transaction(self):
        """返回一个上下文管理器，包裹 BEGIN/COMMIT。适用于大量写入。"""
        outer = self

        class _Tx:
            def __enter__(self_inner):
                outer._conn_lock.acquire()
                outer._conn.execute("BEGIN")
                return outer._conn

            def __exit__(self_inner, exc_type, exc, tb):
                try:
                    if exc_type is None:
                        outer._conn.execute("COMMIT")
                    else:
                        outer._conn.execute("ROLLBACK")
                finally:
                    outer._conn_lock.release()
                return False

        return _Tx()

    def fetchall(self, sql: str, params: tuple = ()) -> list:
        with self._conn_lock:
            cur = self._conn.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]

    def fetchone(self, sql: str, params: tuple = ()) -> Optional[dict]:
        with self._conn_lock:
            cur = self._conn.execute(sql, params)
            row = cur.fetchone()
            return dict(row) if row else None


_DB: Optional[Database] = None


def get_db() -> Database:
    global _DB
    if _DB is None:
        with Database._lock:
            if _DB is None:
                root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                db_path = os.path.join(root, "data", "anima_t8.db")
                _DB = Database(db_path)
    return _DB
