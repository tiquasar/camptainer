"""In-memory job manager for long-running requests.

Jobs live in process memory and are intended for short-lived, single-user dev
tooling. They are created in :func:`create_job`, mutated by the worker thread
through :func:`update_job`, and read by the API via :func:`get_job`. A small
ring buffer caps total memory usage.
"""
import threading
import time
import uuid
from typing import Any, Callable, Dict, Optional

_LOCK = threading.Lock()
_JOBS: Dict[str, Dict[str, Any]] = {}
MAX_JOBS = 200


def _now() -> float:
    return time.time()


def create_job(kind: str, total: int = 0) -> str:
    """Allocate a new job in ``pending`` state and return its id."""
    job_id = uuid.uuid4().hex[:12]
    with _LOCK:
        _JOBS[job_id] = {
            "id": job_id,
            "kind": kind,
            "status": "pending",
            "progress": {"current": 0, "total": total, "message": "Queued"},
            "result": None,
            "error": None,
            "created_at": _now(),
            "updated_at": _now(),
        }
        if len(_JOBS) > MAX_JOBS:
            oldest = sorted(_JOBS.items(), key=lambda kv: kv[1]["created_at"])[
                : len(_JOBS) - MAX_JOBS
            ]
            for jid, _ in oldest:
                _JOBS.pop(jid, None)
    return job_id


def update_job(
    job_id: str,
    *,
    status: Optional[str] = None,
    current: Optional[int] = None,
    total: Optional[int] = None,
    message: Optional[str] = None,
    result: Any = None,
    error: Optional[str] = None,
) -> None:
    """Mutate a job in place. ``None`` arguments are ignored."""
    with _LOCK:
        job = _JOBS.get(job_id)
        if not job:
            return
        if status is not None:
            job["status"] = status
        if current is not None or total is not None or message is not None:
            progress = job["progress"]
            if current is not None:
                progress["current"] = current
            if total is not None:
                progress["total"] = total
            if message is not None:
                progress["message"] = message
        if result is not None:
            job["result"] = result
        if error is not None:
            job["error"] = error
        job["updated_at"] = _now()


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    with _LOCK:
        job = _JOBS.get(job_id)
        return dict(job) if job else None
