from fastapi import APIRouter, HTTPException

from .. import docker_client, events
from ..db import delete_stack, get_stack, list_stacks, save_stack
from ..models import StackCreate, StackSave

router = APIRouter(prefix="/stacks", tags=["stacks"])


@router.post("")
def create_stack(payload: StackCreate):
    """Create a whole group of networks + containers in one call, then persist
    the stack definition."""
    try:
        outcome = docker_client.apply_definition(payload.model_dump())
        definition = payload.model_dump()
        stack_id = save_stack(payload.name, definition)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    events.broadcast_change()
    return {"stack_id": stack_id, **outcome}


@router.post("/save")
def save_current(payload: StackSave):
    """Snapshot the current live Camptainer objects into a named stack."""
    try:
        definition = docker_client.snapshot_definition()
        stack_id = save_stack(payload.name, definition)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"stack_id": stack_id, "name": payload.name}


@router.post("/{stack_id}/apply")
def apply_stack(stack_id: int):
    rec = get_stack(stack_id)
    if not rec:
        raise HTTPException(status_code=404, detail="stack not found")
    try:
        result = docker_client.apply_definition(rec["definition"])
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    events.broadcast_change()
    return result


@router.post("/{stack_id}/teardown")
def teardown_stack(stack_id: int):
    rec = get_stack(stack_id)
    if not rec:
        raise HTTPException(status_code=404, detail="stack not found")
    try:
        docker_client.teardown_definition(rec["definition"])
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    events.broadcast_change()
    return {"ok": True}


@router.get("")
def get_stacks():
    return list_stacks()


@router.get("/{stack_id}")
def get_stack_route(stack_id: int):
    rec = get_stack(stack_id)
    if not rec:
        raise HTTPException(status_code=404, detail="stack not found")
    return rec


@router.delete("/{stack_id}")
def delete_stack_route(stack_id: int):
    delete_stack(stack_id)
    return {"ok": True}
