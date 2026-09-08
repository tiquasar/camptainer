import asyncio
import json

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from . import events
from .db import init_db
from .routes import compose, containers, networks, stacks

app = FastAPI(title="Camptainer", version="0.1.0")

# Allow the Vite dev server (and any static build) to call the API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(networks.router)
app.include_router(containers.router)
app.include_router(stacks.router)
app.include_router(compose.router)


@app.on_event("startup")
async def startup():
    init_db()
    events.set_loop(asyncio.get_running_loop())
    asyncio.create_task(events.snapshot_loop())


@app.get("/health")
def health():
    return {"status": "ok"}


@app.websocket("/events")
async def events_ws(ws: WebSocket):
    mgr = events.get_manager()
    await mgr.connect(ws)
    try:
        # send an initial snapshot immediately on connect (tolerate Docker being down)
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
