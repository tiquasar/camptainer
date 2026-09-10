from fastapi import APIRouter, HTTPException

from .. import docker_client, events

router = APIRouter(prefix="/volumes", tags=["volumes"])


def _wrap(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except docker_client.NotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc) or "not found")
    except docker_client.APIError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.get("")
def list_volumes():
    try:
        return docker_client.list_volumes()
    except RuntimeError as exc:
        return {"volumes": [], "docker_available": False, "error": str(exc)}


@router.delete("/{name}")
def remove_volume(name: str, force: bool = False):
    _wrap(docker_client.remove_volume, name, force=force)
    events.broadcast_change()
    return {"ok": True}


@router.post("/prune")
def prune_volumes():
    try:
        result = docker_client.prune_volumes()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return result or {"SpaceReclaimed": 0, "VolumesDeleted": []}
