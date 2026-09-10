"""SQLite persistence: stacks, compose imports, jobs, schema migrations.

We persist enough of long-running jobs to survive a backend restart: the
job id, status, progress, result, and error are stored here so a frontend
that was polling right before the restart can still recover the outcome.
"""
import json
import sqlite3
import time
from typing import List, Optional

from . import config


_CURRENT_SCHEMA_VERSION = 3


def _conn():
    c = sqlite3.connect(config.DB_PATH, check_same_thread=False, timeout=10.0)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA synchronous=NORMAL")
    c.execute("PRAGMA foreign_keys=ON")
    return c


def _migrate(c: sqlite3.Connection) -> None:
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY
        )
        """
    )
    row = c.execute("SELECT version FROM schema_version LIMIT 1").fetchone()
    current = row["version"] if row else 0
    if current < 1:
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS stacks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                definition TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            )
            """
        )
    if current < 2:
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS compose_imports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                network_names TEXT NOT NULL,
                container_names TEXT NOT NULL,
                torn_down INTEGER NOT NULL DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            )
            """
        )
    if current < 3:
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                status TEXT NOT NULL,
                progress TEXT NOT NULL,
                result TEXT,
                error TEXT,
                payload TEXT,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            )
            """
        )
    if current < _CURRENT_SCHEMA_VERSION:
        c.execute(
            "INSERT OR REPLACE INTO schema_version (version) VALUES (?)",
            (_CURRENT_SCHEMA_VERSION,),
        )


def init_db():
    with _conn() as c:
        _migrate(c)


# ---- stacks ----------------------------------------------------------------

def save_stack(name: str, definition: dict) -> int:
    with _conn() as c:
        cur = c.execute(
            "INSERT INTO stacks (name, definition) VALUES (?, ?)",
            (name, json.dumps(definition)),
        )
        return cur.lastrowid


def list_stacks() -> list:
    with _conn() as c:
        rows = c.execute("SELECT id, name, definition, created_at FROM stacks").fetchall()
    return [dict(r) for r in rows]


def get_stack(stack_id: int) -> Optional[dict]:
    with _conn() as c:
        r = c.execute(
            "SELECT id, name, definition, created_at FROM stacks WHERE id = ?",
            (stack_id,),
        ).fetchone()
    return dict(r) if r else None


def delete_stack(stack_id: int) -> int:
    with _conn() as c:
        cur = c.execute("DELETE FROM stacks WHERE id = ?", (stack_id,))
        return cur.rowcount


# ---- compose imports -------------------------------------------------------

def save_compose_import(
    name: str, network_names: List[str], container_names: List[str]
) -> int:
    with _conn() as c:
        cur = c.execute(
            "INSERT INTO compose_imports (name, network_names, container_names) "
            "VALUES (?, ?, ?)",
            (name, json.dumps(network_names), json.dumps(container_names)),
        )
        return cur.lastrowid


def list_compose_imports(include_torn_down: bool = False) -> list:
    with _conn() as c:
        query = (
            "SELECT id, name, network_names, container_names, torn_down, created_at "
            "FROM compose_imports"
        )
        if not include_torn_down:
            query += " WHERE torn_down = 0"
        query += " ORDER BY created_at DESC, id DESC"
        rows = c.execute(query).fetchall()
    return [
        {
            "id": r["id"],
            "name": r["name"],
            "networks": json.loads(r["network_names"]),
            "containers": json.loads(r["container_names"]),
            "torn_down": bool(r["torn_down"]),
            "created_at": r["created_at"],
        }
        for r in rows
    ]


def get_compose_import(import_id: int) -> Optional[dict]:
    with _conn() as c:
        r = c.execute(
            "SELECT id, name, network_names, container_names, torn_down, created_at "
            "FROM compose_imports WHERE id = ?",
            (import_id,),
        ).fetchone()
    if not r:
        return None
    return {
        "id": r["id"],
        "name": r["name"],
        "networks": json.loads(r["network_names"]),
        "containers": json.loads(r["container_names"]),
        "torn_down": bool(r["torn_down"]),
        "created_at": r["created_at"],
    }


def mark_compose_import_torn_down(import_id: int) -> None:
    with _conn() as c:
        c.execute(
            "UPDATE compose_imports SET torn_down = 1 WHERE id = ?", (import_id,)
        )


def delete_compose_import(import_id: int) -> int:
    with _conn() as c:
        cur = c.execute("DELETE FROM compose_imports WHERE id = ?", (import_id,))
        return cur.rowcount


# ---- jobs (persist so they survive a backend restart) ---------------------

JOB_RETENTION_SECONDS = 24 * 3600  # keep done/failed jobs for 24h


def save_job(
    job_id: str,
    kind: str,
    status: str,
    progress: dict,
    result=None,
    error: Optional[str] = None,
    payload: Optional[dict] = None,
) -> None:
    now = time.time()
    with _conn() as c:
        c.execute(
            """
            INSERT INTO jobs (id, kind, status, progress, result, error, payload, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                status=excluded.status,
                progress=excluded.progress,
                result=excluded.result,
                error=excluded.error,
                updated_at=excluded.updated_at
            """,
            (
                job_id,
                kind,
                status,
                json.dumps(progress),
                json.dumps(result) if result is not None else None,
                error,
                json.dumps(payload) if payload is not None else None,
                now,
                now,
            ),
        )


def update_job(
    job_id: str,
    *,
    status: Optional[str] = None,
    progress: Optional[dict] = None,
    result=None,
    error: Optional[str] = None,
) -> None:
    """Partial update for a job row. ``None`` arguments are ignored.

    ``result`` is special: a falsy value (None, empty dict) means "leave
    alone". To explicitly clear it, pass ``{"_clear": True}`` style? Not
    implemented — in practice the only writes are "set result on done" or
    "set error on failed", so this is fine.
    """
    sets = []
    args: list = []
    if status is not None:
        sets.append("status = ?")
        args.append(status)
    if progress is not None:
        sets.append("progress = ?")
        args.append(json.dumps(progress))
    if result is not None:
        sets.append("result = ?")
        args.append(json.dumps(result))
    if error is not None:
        sets.append("error = ?")
        args.append(error)
    if not sets:
        return
    sets.append("updated_at = ?")
    args.append(time.time())
    args.append(job_id)
    with _conn() as c:
        c.execute(f"UPDATE jobs SET {', '.join(sets)} WHERE id = ?", args)


def get_job(job_id: str) -> Optional[dict]:
    with _conn() as c:
        r = c.execute(
            "SELECT id, kind, status, progress, result, error, payload, created_at, updated_at "
            "FROM jobs WHERE id = ?",
            (job_id,),
        ).fetchone()
    if not r:
        return None
    rec = dict(r)
    rec["progress"] = json.loads(rec["progress"] or "{}")
    rec["result"] = json.loads(rec["result"]) if rec["result"] is not None else None
    rec["payload"] = json.loads(rec["payload"]) if rec["payload"] is not None else None
    return rec


def list_recent_jobs(limit: int = 20) -> List[dict]:
    """Most-recently updated jobs of any status (used by the UI for the in-flight badge)."""
    with _conn() as c:
        rows = c.execute(
            "SELECT id, kind, status, progress, result, error, created_at, updated_at "
            "FROM jobs ORDER BY updated_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    out = []
    for r in rows:
        rec = dict(r)
        rec["progress"] = json.loads(rec["progress"] or "{}")
        rec["result"] = json.loads(rec["result"]) if rec["result"] is not None else None
        out.append(rec)
    return out


def sweep_old_jobs() -> int:
    cutoff = time.time() - JOB_RETENTION_SECONDS
    with _conn() as c:
        cur = c.execute(
            "DELETE FROM jobs WHERE status IN ('done', 'failed') AND updated_at < ?",
            (cutoff,),
        )
        return cur.rowcount
