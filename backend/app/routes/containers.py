from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse

from .. import docker_client, events
from ..models import ConnectRequest, ContainerCreate

router = APIRouter(prefix="/containers", tags=["containers"])


@router.post("")
def create_container(payload: ContainerCreate):
    try:
        c = docker_client.create_container(
            name=payload.name,
            image=payload.image,
            ports=payload.ports,
            environment=payload.environment,
            volumes=payload.volumes,
            networks=payload.networks,
            command=payload.command,
        )
        events.broadcast_change()
        return c
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("")
def get_containers():
    try:
        return docker_client.list_containers()
    except RuntimeError as exc:
        return {"containers": [], "docker_available": False, "error": str(exc)}


@router.post("/{container_id}/start")
def start_container(container_id: str):
    try:
        docker_client.start_container(container_id)
        events.broadcast_change()
        return {"ok": True}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/{container_id}/stop")
def stop_container(container_id: str):
    try:
        docker_client.stop_container(container_id)
        events.broadcast_change()
        return {"ok": True}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/{container_id}/restart")
def restart_container(container_id: str):
    try:
        docker_client.restart_container(container_id)
        events.broadcast_change()
        return {"ok": True}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/{container_id}")
def delete_container(container_id: str):
    docker_client.remove_container(container_id)
    events.broadcast_change()
    return {"ok": True}


@router.get("/{container_id}/logs")
def container_logs(container_id: str, tail: int = 200):
    try:
        text = docker_client.get_logs(container_id, tail=tail)
        return PlainTextResponse(text, media_type="text/plain")
    except Exception as exc:
        return PlainTextResponse(f"# error fetching logs: {exc}", status_code=200)


@router.get("/{container_id}/stats")
def container_stats(container_id: str):
    try:
        return docker_client.get_stats(container_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/{container_id}/recreate")
def recreate(container_id: str, payload: ContainerCreate):
    """Stop + remove + recreate a container with a (possibly) new spec."""
    try:
        c = docker_client.recreate_container(container_id, payload)
        events.broadcast_change()
        return c
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/{container_id}/connect")
def connect(container_id: str, payload: ConnectRequest):
    """Drag-and-drop target: join a container to a network."""
    try:
        docker_client.connect_container(container_id, payload.network)
        events.broadcast_change()
        return {"ok": True, "container": container_id, "network": payload.network}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/{container_id}/disconnect")
def disconnect(container_id: str, payload: ConnectRequest):
    try:
        docker_client.disconnect_container(container_id, payload.network)
        events.broadcast_change()
        return {"ok": True, "container": container_id, "network": payload.network}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
