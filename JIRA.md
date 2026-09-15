# Camptainer — Bug & feature log

This file tracks concrete code-review passes against the Camptainer
codebase. Each entry lists the issue, the fix, and the files touched so
the rationale stays searchable.

---

## Pass 2 — Quick-win bug fixes (2026-09-14)

Six user-visible bugs were fixed after a manual code-walk of the
backend + frontend. Each fix is small (< 25 lines) and eliminates a
specific failure mode that surfaced during routine use. **No new
dependencies were added.**

### Q1 — `streamLogs` never delivers data
- **Symptom.** Opening the **Logs** tab on a container showed the
  initial replay buffer (one-shot fetch) but no live lines ever
  arrived.
- **Root cause.** `streamLogs` is called with `timeoutMs: 0` (long-lived
  stream, no timeout intended). `withTimeout()` unconditionally created
  a `setTimeout(reject, 0)` timer; `Promise.race` then rejected on the
  next tick with `"stream … timed out after 0s"`, killing the stream
  before the first chunk was read.
- **Fix.** Short-circuit `withTimeout` when `ms <= 0` so long-lived
  streams bypass the race entirely.
- **File:** `frontend/src/api.js:14-25`.

### Q2 — `exec_attach` silently swallows bad exec ids
- **Symptom.** Opening the interactive shell against a stale `exec_id`
  (container restarted, exec expired) hung the Shell panel with no
  error and no way out besides closing it.
- **Root cause.** The WebSocket was accepted before `exec_start` ran.
  When `exec_start` raised (NotFound / APIError), nothing was sent
  back; the client sat on an open socket.
- **Fix.** Wrap `exec_start` in `try/except`. On failure, send a
  `# error: …` text frame and close the socket.
- **File:** `backend/app/routes/containers.py:166-178`.

### Q3 — `exec_attach` pokes private docker-py internals
- **Symptom.** Fragile — relies on `sock._sock`, a name not part of
  docker-py's public API.
- **Fix.** Use the documented `sock.recv(4096)` / `sock.sendall(...)`
  on the connection object returned by `exec_start(..., socket=True)`.
- **File:** `backend/app/routes/containers.py:191, 222`.

### Q4 — `Recreate` silently drops CPU + memory limits
- **Symptom.** Clicking **Recreate** on a container with a configured
  CPU or memory limit produced a replacement that had no limit at all.
- **Root cause.** `ContainerDetail.recreate` built the new spec from
  `_container_summary` fields, which never carried `NanoCpus` or
  `Memory`. The recreate spec therefore omitted them, and the backend
  recreated without limits.
- **Fix.**
  1. Extend `_container_full` (`backend/app/docker_client.py:223-249`)
     to extract `NanoCpus` → `cpu` (cores, decimal) and `Memory` →
     `mem` (Docker memory string via a small `_bytes_to_mem` helper).
  2. Have `recreate` pass `container.cpu` / `container.mem` through.
- **Files:**
  `backend/app/docker_client.py:223-256`,
  `frontend/src/components/ContainerDetail.jsx:140-141`.

### Q5 — Closing the compose dialog mid-import reports a fake error
- **Symptom.** Hitting the `×` button (or the backdrop) while an
  import was running immediately surfaced
  `Imported with errors: Dialog closed before import finished` in the
  next time the dialog was opened, even though the import was
  continuing server-side.
- **Root cause.** `pollJob` was Promise-based and "resolved" with a
  synthetic `{errors: ["Dialog closed before import finished"]}` when
  the user detached, which `doImport` then treated as a normal
  completion and routed through the error toast.
- **Fix.** Refactor `pollJob` to use callbacks (`onUpdate`, `onDone`,
  `onError`) instead of a Promise. On detach (`stopRef.current`),
  silently stop polling — the job keeps running, but no `onDone` /
  `onError` fires, so no toast or synthetic error appears.
- **File:** `frontend/src/components/ComposeImport.jsx:31-66, 173-188`.

### Q6 — Orphaned `pending` / `running` jobs accumulate forever
- **Symptom.** If the backend was killed mid-import (Ctrl-C, crash,
  OOM), the job row stayed in `jobs` with status `pending` /
  `running` indefinitely. The in-flight badge in the topbar kept
  showing `N importing` for those jobs even hours later.
- **Root cause.**
  1. `sweep_old_jobs` only deleted `status IN ('done','failed')`
     rows — non-terminal states were never cleaned up.
  2. `sweep_old_jobs` was defined in `db.py` but never called from
     anywhere.
  3. `jobs.update_job` silently swallowed SQLite write errors, so a
     dead in-memory record could drift from the DB record.
- **Fix.**
  1. `sweep_old_jobs` now deletes any job whose `updated_at` is older
     than `JOB_RETENTION_SECONDS` (24 h). Active jobs are updated on
     every progress tick, so they survive; abandoned ones (worker
     thread died, backend crashed) are reaped.
  2. Wire the sweep into the FastAPI `lifespan`: run once on startup,
     then every hour via a new background task `_sweep_loop`.
  3. `jobs.update_job` now logs the exception via
     `log.exception(...)` instead of `pass`.
- **Files:**
  `backend/app/db.py:9-13, 302-313`,
  `backend/app/jobs.py:8-14, 107`,
  `backend/app/main.py:5, 11, 17, 30-49`.

---

## Follow-ups still open (not addressed in this pass)

These were identified during the same review pass but not in scope
for the quick-win cut. See the prior review notes for context:

- Per-container env / volume editing (`ContainerDetail.jsx` Config tab
  is read-only).
- Bulk multi-select on the canvas.
- Persisted metrics history (currently lost on tab switch).
- Terminal emulation (no xterm.js; ANSI colours render as garbage).
- Image auto-pull prompt when creating a container whose image is
  missing locally.
- `build_compose` round-trip is lossy: drops `volumes`, `mem_limit`,
  `nano_cpus`, extra host-config.
- CORS allowlist is hardcoded to `localhost:5173/5174`; any other
  host (LAN IP, Tailscale, reverse proxy) gets blocked.
- `pull_image` SSE can hang forever if the worker thread dies before
  putting the `None` sentinel.
- `stream_logs` splits each chunk on `\n` independently — a log line
  spanning two TCP chunks gets torn in two.
- `_image_in_use` is O(containers × tags) with no label filter; becomes
  slow on large installs.
- `/health` always returns 200 even when Docker is down; most monitors
  key on status code.
- `db._conn()` opens a fresh connection per helper call.

---