"""WebSocket live-event hub.

A background task broadcasts a full snapshot of containers + networks every
few seconds. Mutations also trigger an immediate broadcast when possible.

The event loop and connection manager are reset whenever ``set_loop`` is
called with a loop that isn't the current one — this makes the hub safe
under uvicorn's ``--reload`` worker, where the previous loop object
becomes invalid.
"""
import asyncio
import json
from typing import Set

from . import docker_client

_manager = None
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
    loop = _loop
    if loop is None or loop.is_closed():
        return
    try:
        data = docker_client.snapshot()
        msg = json.dumps({"type": "snapshot", "data": data})
        asyncio.run_coroutine_threadsafe(get_manager().broadcast(msg), loop)
    except Exception:
        pass


def set_loop(loop):
    """Bind the hub to ``loop``. If the loop changed, drop the old manager
    (its WebSockets are dead anyway)."""
    global _loop, _manager
    if _loop is loop:
        return
    _loop = loop
    _manager = None  # force a fresh manager on next get_manager()
