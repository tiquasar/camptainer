"""SQLite persistence for stack definitions and compose imports.

We only persist the *definition* of a stack (its networks and containers) so it
can be re-created or inspected later. Live container state always comes from
Docker. Compose imports additionally remember the concrete resource names that
were created so a later ``teardown`` can find them.
"""
import json
import sqlite3
from typing import List, Optional

from . import config


def _conn():
    c = sqlite3.connect(config.DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init_db():
    with _conn() as c:
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


def delete_stack(stack_id: int):
    with _conn() as c:
        c.execute("DELETE FROM stacks WHERE id = ?", (stack_id,))


# ---- compose imports ------------------------------------------------------

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


def delete_compose_import(import_id: int) -> None:
    with _conn() as c:
        c.execute("DELETE FROM compose_imports WHERE id = ?", (import_id,))
