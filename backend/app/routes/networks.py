from fastapi import APIRouter, HTTPException

from .. import docker_client, events
from ..models import NetworkCreate

router = APIRouter(prefix="/networks", tags=["networks"])


@router.post("")
def create_network(payload: NetworkCreate):
    try:
        net = docker_client.create_network(payload.name, payload.driver)
        events.broadcast_change()
        return net
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("")
def get_networks():
    try:
        return docker_client.list_networks()
    except RuntimeError as exc:
        return {"networks": [], "docker_available": False, "error": str(exc)}


@router.delete("/{name}")
def delete_network(name: str):
    docker_client.remove_network(name)
    events.broadcast_change()
    return {"ok": True}
