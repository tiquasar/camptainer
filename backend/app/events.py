"""WebSocket live-event hub.

A background task broadcasts a full snapshot of containers + networks every few
seconds. Mutations also trigger an immediate broadcast when possible.
"""
import asyncio
import json
from typing import Set

from . import docker_client

_manager: "ConnectionManager | None" = None
_loop = None


class ConnectionManager:
    def __init__(self):
        self.active: Set = set()

    async def connect(self, ws):
        await ws.accept()
        self.active.add(ws)

    def disconnect(self, ws):
        self.active.discard(ws)

    async def broadcast(self, message: str):
        stale = []
        for ws in list(self.active):
            try:
                await ws.send_text(message)
            except Exception:
                stale.append(ws)
        for ws in stale:
            self.active.discard(ws)


def get_manager() -> ConnectionManager:
    global _manager
    if _manager is None:
        _manager = ConnectionManager()
    return _manager


async def snapshot_loop(interval: float = 3.0):
    """Periodically push the latest Docker state to all connected clients."""
    mgr = get_manager()
    while True:
        try:
            data = docker_client.snapshot()
            await mgr.broadcast(json.dumps({"type": "snapshot", "data": data}))
        except Exception:
            # Docker may be down; keep the loop alive regardless.
            pass
        await asyncio.sleep(interval)


def broadcast_change():
    """Best-effort immediate push after a mutation (call from sync routes)."""
    global _loop
    if _loop is None:
        return
    try:
        data = docker_client.snapshot()
        msg = json.dumps({"type": "snapshot", "data": data})
        asyncio.run_coroutine_threadsafe(get_manager().broadcast(msg), _loop)
    except Exception:
        pass


def set_loop(loop):
    global _loop
    _loop = loop
