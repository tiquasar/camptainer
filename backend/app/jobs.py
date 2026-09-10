"""In-memory + SQLite-backed job manager for long-running requests.

Jobs are first written to memory (cheap, frequent reads) and mirrored to
SQLite (so a backend restart doesn't lose them). Reads consult memory
first and fall back to SQLite. The cap + sweep prevent unbounded growth.
"""
import threading
import time
import uuid
from typing import Any, Dict, Optional

from . import db

_LOCK = threading.Lock()
_JOBS: Dict[str, Dict[str, Any]] = {}
MAX_JOBS = 200


def _now() -> float:
    return time.time()


def _evict_if_needed() -> None:
    if len(_JOBS) <= MAX_JOBS:
        return
    oldest = sorted(_JOBS.items(), key=lambda kv: kv[1]["created_at"])[
        : len(_JOBS) - MAX_JOBS
    ]
    for jid, _ in oldest:
        _JOBS.pop(jid, None)


def create_job(kind: str, total: int = 0, payload: Optional[dict] = None) -> str:
    """Allocate a new job in ``pending`` state and return its id."""
    job_id = uuid.uuid4().hex[:12]
    now = _now()
    rec = {
        "id": job_id,
        "kind": kind,
        "status": "pending",
        "progress": {"current": 0, "total": total, "message": "Queued"},
        "result": None,
        "error": None,
        "payload": payload or None,
        "created_at": now,
        "updated_at": now,
    }
    with _LOCK:
        _JOBS[job_id] = rec
        _evict_if_needed()
    db.save_job(
        job_id=job_id,
        kind=kind,
        status=rec["status"],
        progress=rec["progress"],
        payload=payload,
    )
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
    """Mutate a job. ``None`` arguments are ignored.

    Special case: when ``status == "done"`` and ``result`` was provided,
    we snapshot the result into the in-memory record before the
    SQLite write so a subsequent :func:`get_job` (memory hit) returns the
    final value.
    """
    with _LOCK:
        job = _JOBS.get(job_id)
        if job:
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
            # Mirror to SQLite (best-effort; do not let a DB error kill the worker).
            try:
                db.update_job(
                    job_id,
                    status=status,
                    progress=job["progress"],
                    result=result,
                    error=error,
                )
            except Exception:
                pass


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    with _LOCK:
        job = _JOBS.get(job_id)
        if job is not None:
            return dict(job)
    # Fall back to SQLite (e.g. after a backend restart).
    rec = db.get_job(job_id)
    if rec is not None:
        with _LOCK:
            _JOBS[job_id] = rec
            _evict_if_needed()
        return dict(rec)
    return None


def list_recent_jobs(limit: int = 20) -> list:
    """In-flight + recently-updated jobs (UI badge)."""
    with _LOCK:
        if _JOBS:
            items = sorted(_JOBS.values(), key=lambda j: j["updated_at"], reverse=True)
            return [dict(j) for j in items[:limit]]
    return db.list_recent_jobs(limit)
