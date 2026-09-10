import threading
import time

import yaml as _yaml
from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse, StreamingResponse

from .. import db, docker_client, events, jobs
from ..models import ComposeImport

router = APIRouter(prefix="/compose", tags=["compose"])


@router.get("")
def get_compose():
    """Export the current Camptainer objects as a docker-compose.yml file."""
    try:
        yaml_text = docker_client.build_compose()
    except RuntimeError as exc:
        return PlainTextResponse(
            f"# Docker daemon unavailable: {exc}\n", status_code=200
        )
    return PlainTextResponse(yaml_text, media_type="text/yaml")


def _run_import_job(
    job_id: str, text: str, import_name: str | None, auto_pull: bool
) -> None:
    """Worker thread: parse + create networks/containers, persist result."""
    try:
        jobs.update_job(job_id, status="running", message="Importing\u2026")

        def on_progress(message: str, current: int, total: int) -> None:
            jobs.update_job(
                job_id, current=current, total=total, message=message
            )

        outcome = docker_client.import_compose(
            text, on_progress=on_progress, auto_pull=auto_pull
        )

        net_names = [n["name"] for n in outcome.get("networks", []) if n.get("name")]
        ct_names = [c["name"] for c in outcome.get("containers", []) if c.get("name")]

        import_id = None
        if net_names or ct_names:
            ts = time.strftime("%Y-%m-%d %H:%M:%S")
            short = job_id[:6]
            name = (import_name or "").strip() or f"compose-{ts}-{short}"
            import_id = db.save_compose_import(name, net_names, ct_names)
            outcome["import_id"] = import_id
            outcome["import_name"] = name

        jobs.update_job(
            job_id,
            status="done",
            message="Imported",
            result=outcome,
        )
        events.broadcast_change()
    except Exception as exc:
        jobs.update_job(job_id, status="failed", error=str(exc))


@router.post("/import")
def import_compose(payload: ComposeImport):
    """Queue a compose import as a background job. Returns a job_id immediately."""
    text = payload.yaml or ""
    try:
        doc = _yaml.safe_load(text) or {}
    except _yaml.YAMLError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid YAML: {exc}")

    n_nets = len(doc.get("networks") or {})
    n_svcs = len((doc.get("services") or {}))
    total = n_nets + n_svcs

    job_id = jobs.create_job("compose-import", total=total)
    threading.Thread(
        target=_run_import_job,
        args=(job_id, text, payload.name, False),
        daemon=True,
    ).start()
    return {"job_id": job_id, "status": "pending", "total": total}


@router.get("/import/{job_id}")
def get_import_status(job_id: str):
    job = jobs.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return job


@router.get("/jobs/active")
def active_jobs():
    """In-flight imports (and the last few completed ones) for the UI badge."""
    recents = jobs.list_recent_jobs(limit=20)
    return [j for j in recents if j.get("status") in ("pending", "running")]


@router.get("/imports")
def list_imports():
    """List past compose imports that still own live resources."""
    return db.list_compose_imports(include_torn_down=False)


@router.get("/imports/{import_id}")
def get_import(import_id: int):
    rec = db.get_compose_import(import_id)
    if not rec:
        raise HTTPException(status_code=404, detail="import not found")
    return rec


@router.post("/imports/{import_id}/teardown")
def teardown_import(import_id: int):
    """Remove every network and container created by a single compose import."""
    rec = db.get_compose_import(import_id)
    if not rec:
        raise HTTPException(status_code=404, detail="import not found")
    if rec["torn_down"]:
        return {"ok": True, "already_torn_down": True}
    # Containers first so Docker doesn't complain about endpoints still attached.
    errors: list[str] = []
    for name in rec.get("containers", []):
        try:
            docker_client.remove_container_by_name(name)
        except Exception as exc:
            errors.append(f"container {name}: {exc}")
    for name in rec.get("networks", []):
        try:
            docker_client.remove_network(name)
        except Exception as exc:
            errors.append(f"network {name}: {exc}")
    db.mark_compose_import_torn_down(import_id)
    events.broadcast_change()
    return {"ok": True, "import_id": import_id, "errors": errors}


@router.delete("/imports/{import_id}")
def forget_import(import_id: int):
    deleted = db.delete_compose_import(import_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="import not found")
    return {"ok": True}


@router.post("/pull")
def pull_image(image: str):
    """Pull an image, streaming progress (SSE)."""
    return StreamingResponse(
        docker_client.pull_image(image), media_type="text/plain"
    )
