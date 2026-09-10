from fastapi import APIRouter, HTTPException

from .. import docker_client, events

router = APIRouter(prefix="/images", tags=["images"])


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
def list_images():
    try:
        return docker_client.list_images()
    except RuntimeError as exc:
        return {"images": [], "docker_available": False, "error": str(exc)}


@router.delete("/{image_id}")
def remove_image(image_id: str, force: bool = False):
    _wrap(docker_client.remove_image, image_id, force=force)
    events.broadcast_change()
    return {"ok": True}


@router.post("/prune")
def prune_images():
    try:
        result = docker_client.prune_images()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return result or {"SpaceReclaimed": 0, "ImagesDeleted": []}
