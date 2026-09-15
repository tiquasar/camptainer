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

## Pass 3 — SSE, round-trip, validation (2026-09-15)

A second review pass landed 15 fixes covering the round-trip
`build_compose` story, SSE streaming reliability, CORS for non-dev
hosts, validation of user-typed inputs, and a handful of UX bugs in
the React shell. **No new dependencies were added.** (+396 / -93
across 8 files.)

### R1 — `build_compose` round-trip is lossy
- **Symptom.** A documented feature — "export → re-import gets you the
  same thing" — silently dropped `volumes`, `mem_limit`, `cpus`,
  `user`, `working_dir`, `extra_hosts`, `dns`, `cap_add`,
  `cap_drop`, and `healthcheck`. Recreate-of-an-exported-stack was
  particularly broken: memory limits, CPU limits, and volume mounts all
  vanished.
- **Fix.**
  1. Extend `_container_full` to surface all of these from
     `Config` / `HostConfig` (`backend/app/docker_client.py`).
  2. Emit them from `build_compose` so the YAML round-trips.
  3. Accept them in `import_compose` and pass through to
     `create_container`.
  4. Forward through `recreate_container` and `snapshot_definition`.
  5. Add matching fields to the Pydantic `ContainerCreate` model.
- **Files:**
  `backend/app/docker_client.py:227-279, 309-355, 422-442, 528-577, 615-664, 696-722`,
  `backend/app/models.py:27-91`.

### R2 — `pull_image` SSE hangs forever on worker death
- **Symptom.** If the worker thread died before putting its `None`
  sentinel (Docker daemon crash, native segfault, partial write),
  `q.get()` blocked forever and the SSE response stayed open until
  the client disconnected.
- **Fix.** Add a `stall_timeout` (default 60 s) to `q.get()`. When
  triggered, yield a `# error: pull stalled …` line and return. The
  `finally: q.put(None)` already in place still runs if the worker
  exits cleanly.
- **File:** `backend/app/docker_client.py:687-714`.

### R3 — `stream_logs` splits each chunk on `\n` independently
- **Symptom.** A log line spanning two TCP chunks (common for long
  lines, or under load) was torn in two and rendered as two short
  lines.
- **Fix.** Keep a per-generator `buf` of the un-flushed remainder
  across chunks. `split("\n")` then `parts.pop()` peels off the
  remainder; the rest are emitted complete with their `\n`.
- **File:** `backend/app/docker_client.py:373-394`.

### R4 — CORS allowlist is hardcoded to dev origins
- **Symptom.** Anyone serving the UI from a LAN IP, a Tailscale
  host, or a built static bundle on a non-Vite port hit CORS
  preflight failures and got an empty page.
- **Fix.** Read `CORS_ORIGINS` (comma-separated) from the
  environment, falling back to the dev ports when unset.
- **File:** `backend/app/main.py:67-78`.

### R6 — `onEdgesDelete` direction handling is unsafe
- **Symptom.** If neither `source` nor `target` started with `ct:`
  or `net:` (a future custom edge, or a bug elsewhere), the
  delete handler happily sliced arbitrary ids and posted them.
- **Fix.** Resolve `containerNode` and `networkNode` via explicit
  prefix checks; bail out with a toast when the edge is unrecognised.
  Same fix applied to `onConnect` for symmetry.
- **File:** `frontend/src/App.jsx:270-318`.

### R7 — "Copy full ID" copies a short id
- **Symptom.** The button label and tooltip both said
  "Copy full ID" but `container.id` was the 12-char truncation from
  `_container_summary`. The clipboard got 12 chars.
- **Fix.** Add `id_full` (full sha256 hex) to `_container_full` and
  have `copyId` prefer it.
- **Files:**
  `backend/app/docker_client.py:228`,
  `frontend/src/components/ContainerDetail.jsx:152-162`.

### R8 — Logs useEffect doesn't abort in-flight fetch
- **Symptom.** Under StrictMode double-invoke or rapid tab
  switching, two `streamLogs` loops ran concurrently and appended to
  the same ring buffer out of order.
- **Fix.** Use an `AbortController`. The signal is passed to both
  `api.getLogs` and `streamLogs`; cleanup calls `ac.abort()`. Also
  short-circuit `setLogLines` when the signal fires.
- **Files:**
  `frontend/src/api.js:73-78, 122-156`,
  `frontend/src/components/ContainerDetail.jsx:25-58`.

### R9 — `filter(Boolean)` drops legitimate blank log lines
- **Symptom.** Multi-line stack traces and aligned progress spinners
  rendered with blank lines removed, breaking alignment.
- **Fix.** Drop the `filter(Boolean)`. Blank lines stay; the
  `MAX_LOG_LINES` cap still bounds the buffer.
- **File:** `frontend/src/components/ContainerDetail.jsx:36, 43`.

### R10 — `/health` always 200
- **Symptom.** When Docker was unreachable, `/health` still returned
  200; only the body field reported failure. Most monitors key on
  HTTP status code and treated the service as healthy.
- **Fix.** Add `/health/ready` that returns 503 when
  `docker_status()["ok"]` is false. Keep `/health` as the liveness
  probe.
- **File:** `backend/app/main.py:97-105`.

### R11 — Events WebSocket has no keepalive
- **Symptom.** nginx, cloudflare, and corporate proxies commonly
  close idle WebSockets at ~60 s. The events socket had no keepalive
  and would die behind any such proxy.
- **Fix.** Send `{"type":"ping"}` every 25 s from a background
  asyncio task. The frontend ignores the frame; it just keeps the
  socket warm.
- **File:** `backend/app/main.py:118-134`.

### R12 — SSE responses missing proxy-friendly headers
- **Symptom.** Behind nginx, the "live" image-pull progress and log
  streams felt laggy because nginx was buffering the response.
- **Fix.** Pass `Cache-Control: no-store` and
  `X-Accel-Buffering: no` to the `StreamingResponse` constructors
  for both endpoints.
- **Files:**
  `backend/app/routes/containers.py:98-112`,
  `backend/app/routes/compose.py:149-158`.

### R13 — Per-entry validation is missing on container specs
- **Symptom.** A typo like `"8080:80:extra"` in `ports`, or
  `"KEY"` (no `=`) in `environment`, reached docker-py and produced
  a confusing stack-trace error from deep inside the SDK.
- **Fix.** Add Pydantic v2 `field_validator`s for `ports`,
  `environment`, `volumes`, and `extra_hosts`. Bad inputs now
  surface as a 422 with a clean message.
- **File:** `backend/app/models.py:64-103`.

### R14 — Snapshot replaces nodes/edges during drag
- **Symptom.** Every 3 s the snapshot loop called `setNodes(nextNodes)`
  with a fully replaced array. React Flow reinitialised its internal
  drag tracker, so a mid-drag node snapped back to its last
  persisted position.
- **Fix.** Track the last node-id set in a ref; only call
  `setNodes` when the topology membership actually changes. Edges
  still update on every snapshot (no drag to interrupt there, and
  the animated style reflects running state).
- **File:** `frontend/src/App.jsx:206-278`.

### R15 — Toast cleanup timer fires on unmounted tree
- **Symptom.** `setTimeout(... 5000)` was never cleared. Under
  StrictMode double-invoke + unmount, `setToasts` ran on an
  unmounted component and produced a React warning.
- **Fix.** Store the timer id on the toast record and clear it in
  `dismissToast`. The auto-dismiss path also benefits — a manually
  dismissed toast no longer resurrects itself 5 s later.
- **File:** `frontend/src/App.jsx:95-108`.

### R16 — `_image_in_use` is O(containers × tags), no label filter
- **Symptom.** `list_images()` walked every container on the host
  (regardless of label) and compared each tag individually. On a
  host with 100+ images and many containers, `/images` got slow.
- **Fix.** Filter the container list with `label=camptainer` first
  (matches the rest of the app's self-scoping), and check both
  `image.tags` intersection and short-id match in a single pass.
- **File:** `backend/app/docker_client.py:731-750`.

---

## Notes / dropped items

- **R5 (per-service error isolation in `_run_import_job`)** was
  listed for review but on re-read the per-service `try/except` is
  already in place in `import_compose`. No code change needed;
  documented here so it doesn't reappear in a future review.
- **R5 / R7 follow-up**: if compose `environment` is given as a
  mapping instead of a list (a valid YAML shape), `import_compose`
  already normalises to `KEY=value` strings. Covered.

---

## Follow-ups still open (not addressed in either pass)

These were identified during review but not in scope for either
quick-win cut:

- Per-container env / volume editing (`ContainerDetail.jsx` Config tab
  is read-only).
- Bulk multi-select on the canvas.
- Persisted metrics history (currently lost on tab switch).
- Terminal emulation (no xterm.js; ANSI colours render as garbage).
- Image auto-pull prompt when creating a container whose image is
  missing locally.
- `db._conn()` opens a fresh connection per helper call (perf).
- In-flight job cancel from the UI (only "detach" is possible
  today).
