import asyncio
import json
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from . import db, events
from .docker_client import docker_status
from .routes import compose, containers, images, networks, stacks, volumes

_PING_INTERVAL = 30.0
_SWEEP_INTERVAL = 3600.0
_WS_KEEPALIVE_SECONDS = 25.0


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

# Default to the local dev ports. Override via ``CORS_ORIGINS`` (comma-separated)
# when serving the UI from a LAN IP, Tailscale host, or a built static bundle.
_DEFAULT_CORS_ORIGINS = ("http://localhost:5173", "http://localhost:5174")
_cors_env = os.environ.get("CORS_ORIGINS", "").strip()
_cors_origins = (
    [o.strip() for o in _cors_env.split(",") if o.strip()]
    if _cors_env
    else list(_DEFAULT_CORS_ORIGINS)
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
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
    """Liveness probe. Always returns 200; the ``docker`` field tells the
    caller whether the daemon is actually reachable. Use ``/health/ready``
    for readiness probes that need a status code."""
    return {"status": "ok", "docker": docker_status()}


@app.get("/health/ready")
def health_ready():
    """Readiness probe. 200 when Docker is reachable, 503 otherwise.

    Most monitors key on HTTP status code rather than body fields, so this
    gives them a real signal. ``/health`` remains the liveness endpoint."""
    status = docker_status()
    if status.get("ok"):
        return {"status": "ok", **status}
    raise HTTPException(status_code=503, detail=status)


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

        # Periodic keepalive: many proxies close idle WebSockets at ~60s.
        # The frontend ignores ping frames; this just keeps the socket warm.
        async def keepalive():
            try:
                while True:
                    await asyncio.sleep(_WS_KEEPALIVE_SECONDS)
                    await ws.send_text(json.dumps({"type": "ping"}))
            except Exception:
                return

        keepalive_task = asyncio.create_task(keepalive())
        try:
            while True:
                # keep the socket open; snapshots are pushed by the background loop
                await ws.receive_text()
        finally:
            keepalive_task.cancel()
            try:
                await keepalive_task
            except (asyncio.CancelledError, Exception):
                pass
    except WebSocketDisconnect:
        mgr.disconnect(ws)
    except Exception:
        mgr.disconnect(ws)
