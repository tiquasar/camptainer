from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import PlainTextResponse, StreamingResponse

from .. import docker_client, events
from ..models import ConnectRequest, ContainerCreate, ExecRequest

router = APIRouter(prefix="/containers", tags=["containers"])


def _wrap(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except docker_client.NotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc) or "not found")
    except docker_client.ImageNotFound as exc:
        raise HTTPException(status_code=404, detail=f"image not found: {exc}")
    except docker_client.APIError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.post("")
def create_container(payload: ContainerCreate):
    c = _wrap(
        docker_client.create_container,
        name=payload.name,
        image=payload.image,
        ports=payload.ports,
        environment=payload.environment,
        volumes=payload.volumes,
        networks=payload.networks,
        command=payload.command,
        restart_policy=payload.restart_policy,
        cpu=payload.cpu,
        mem=payload.mem,
        auto_pull=payload.auto_pull,
    )
    events.broadcast_change()
    return c


@router.get("")
def get_containers():
    try:
        return docker_client.list_containers()
    except RuntimeError as exc:
        return {"containers": [], "docker_available": False, "error": str(exc)}


@router.get("/{container_id}")
def get_container(container_id: str):
    return _wrap(docker_client.get_container, container_id)


@router.post("/{container_id}/start")
def start_container(container_id: str):
    _wrap(docker_client.start_container, container_id)
    events.broadcast_change()
    return {"ok": True}


@router.post("/{container_id}/stop")
def stop_container(container_id: str):
    _wrap(docker_client.stop_container, container_id)
    events.broadcast_change()
    return {"ok": True}


@router.post("/{container_id}/restart")
def restart_container(container_id: str):
    _wrap(docker_client.restart_container, container_id)
    events.broadcast_change()
    return {"ok": True}


@router.delete("/{container_id}")
def delete_container(container_id: str):
    _wrap(docker_client.remove_container, container_id)
    events.broadcast_change()
    return {"ok": True}


@router.get("/{container_id}/logs")
def container_logs(
    container_id: str,
    tail: int = 200,
    follow: bool = Query(False, description="Stream new lines as they arrive"),
):
    """One-shot tail by default; ``?follow=true`` switches to SSE streaming."""
    if not follow:
        try:
            text = docker_client.get_logs(container_id, tail=tail)
        except Exception as exc:
            raise HTTPException(status_code=404, detail=str(exc))
        return PlainTextResponse(text, media_type="text/plain")

    def gen():
        try:
            for line in docker_client.stream_logs(container_id, follow=True, tail=tail):
                yield line
        except Exception as exc:
            yield f"# error: {exc}\n"

    return StreamingResponse(gen(), media_type="text/plain")


@router.get("/{container_id}/stats")
def container_stats(container_id: str):
    return _wrap(docker_client.get_stats, container_id)


@router.post("/{container_id}/recreate")
def recreate(container_id: str, payload: ContainerCreate):
    """Stop + remove + recreate a container with a (possibly) new spec."""
    c = _wrap(docker_client.recreate_container, container_id, payload)
    events.broadcast_change()
    return c


@router.post("/{container_id}/connect")
def connect(container_id: str, payload: ConnectRequest):
    _wrap(docker_client.connect_container, container_id, payload.network)
    events.broadcast_change()
    return {"ok": True, "container": container_id, "network": payload.network}


@router.post("/{container_id}/disconnect")
def disconnect(container_id: str, payload: ConnectRequest):
    _wrap(docker_client.disconnect_container, container_id, payload.network)
    events.broadcast_change()
    return {"ok": True, "container": container_id, "network": payload.network}


# ---- exec shell ------------------------------------------------------------

@router.post("/{container_id}/exec")
def exec_create(container_id: str, payload: ExecRequest):
    """Open an interactive exec session.

    Returns the ``exec_id`` and a WebSocket URL. The actual stream lives
    on the ``/containers/{id}/exec/{exec_id}/attach`` endpoint.
    """
    try:
        info = docker_client.exec_create(container_id, payload.command, payload.interactive)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {
        "exec_id": info["exec_id"],
        "ws": f"/containers/{container_id}/exec/{info['exec_id']}/attach",
    }


@router.websocket("/{container_id}/exec/{exec_id}/attach")
async def exec_attach(ws: WebSocket, container_id: str, exec_id: str):
    """Bidirectional stream between a browser WebSocket and a docker exec.

    Protocol: text frames from the browser are appended to the exec's
    stdin. The exec's stdout/stderr is forwarded as text frames. A
    ``{"type":"resize","rows":N,"cols":M}`` JSON frame resizes the PTY.
    """
    import asyncio
    import json
    import threading

    await ws.accept()
    cli = docker_client.get_client()
    sock = cli.api.exec_start(
        exec_id, detach=False, tty=True, stream=True, socket=True
    )
    loop = asyncio.get_running_loop()
    done = threading.Event()

    def _close():
        try:
            sock.close()
        except Exception:
            pass

    async def pump_out():
        try:
            while not done.is_set():
                chunk = await loop.run_in_executor(None, lambda: sock._sock.recv(4096))
                if not chunk:
                    break
                text = chunk.decode("utf-8", errors="replace") if isinstance(chunk, bytes) else chunk
                await ws.send_text(text)
        except WebSocketDisconnect:
            pass
        except Exception:
            pass
        finally:
            done.set()

    async def pump_in():
        try:
            while not done.is_set():
                msg = await ws.receive_text()
                if not msg:
                    continue
                try:
                    payload = json.loads(msg)
                except Exception:
                    payload = None
                if isinstance(payload, dict) and payload.get("type") == "resize":
                    docker_client.exec_resize(
                        exec_id,
                        int(payload.get("rows", 24)),
                        int(payload.get("cols", 80)),
                    )
                    continue
                await loop.run_in_executor(
                    None,
                    lambda m=msg: sock._sock.sendall(m.encode("utf-8", errors="replace")),
                )
        except WebSocketDisconnect:
            pass
        except Exception:
            pass
        finally:
            done.set()

    try:
        await asyncio.gather(pump_out(), pump_in(), return_exceptions=True)
    finally:
        done.set()
        _close()
        try:
            await ws.close()
        except Exception:
            pass
