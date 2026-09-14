import asyncio
import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from . import db, events
from .docker_client import docker_status
from .routes import compose, containers, images, networks, stacks, volumes

_PING_INTERVAL = 30.0
_SWEEP_INTERVAL = 3600.0


async def _ping_loop():
    """Periodically reset the Docker client cache so a restarted Docker
    daemon doesn't leave us with a dead connection."""
    while True:
        await asyncio.sleep(_PING_INTERVAL)
        try:
            from . import docker_client

            docker_client.healthcheck()
        except Exception:
            pass


async def _sweep_loop():
    """Periodically prune stale jobs so the UI badge and DB don't grow
    unbounded."""
    while True:
        await asyncio.sleep(_SWEEP_INTERVAL)
        try:
            db.sweep_old_jobs()
        except Exception:
            pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    try:
        db.sweep_old_jobs()
    except Exception:
        pass
    loop = asyncio.get_running_loop()
    events.set_loop(loop)
    snapshot_task = asyncio.create_task(events.snapshot_loop())
    ping_task = asyncio.create_task(_ping_loop())
    sweep_task = asyncio.create_task(_sweep_loop())
    try:
        yield
    finally:
        snapshot_task.cancel()
        ping_task.cancel()
        sweep_task.cancel()
        for t in (snapshot_task, ping_task, sweep_task):
            try:
                await t
            except (asyncio.CancelledError, Exception):
                pass


app = FastAPI(title="Camptainer", version="0.2.0", lifespan=lifespan)

# Local dev (Vite on 5173/5174) + any static build hosted alongside.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(networks.router)
app.include_router(containers.router)
app.include_router(stacks.router)
app.include_router(compose.router)
app.include_router(images.router)
app.include_router(volumes.router)


@app.get("/health")
def health():
    """Liveness + Docker status. Returns 200 either way; the ``docker`` field
    tells the caller whether the daemon is actually reachable."""
    return {"status": "ok", "docker": docker_status()}


@app.websocket("/events")
async def events_ws(ws: WebSocket):
    mgr = events.get_manager()
    await mgr.connect(ws)
    try:
        # Send an initial snapshot immediately on connect (tolerate Docker being down).
        from . import docker_client

        try:
            initial = docker_client.snapshot()
        except Exception as exc:
            initial = {"error": str(exc), "containers": [], "networks": []}
        await ws.send_text(json.dumps({"type": "snapshot", "data": initial}))

        while True:
            # keep the socket open; snapshots are pushed by the background loop
            await ws.receive_text()
    except WebSocketDisconnect:
        mgr.disconnect(ws)
    except Exception:
        mgr.disconnect(ws)
