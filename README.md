# Camptainer

> A local, single-user web UI to **define, create, and visually manage Docker
> containers and their networks** — drag-and-drop wiring, live logs & stats,
> stacks, and round-trip compose import/export.

```
┌────────────┐     REST + WebSocket      ┌──────────────────────┐
│  React UI  │ ───────────────────────▶ │  FastAPI backend     │
│ (Vite)     │ ◀─────────────────────── │  + Docker SDK        │
└────────────┘     live snapshot feed    └──────────┬───────────┘
                                                     │
                                             ┌───────▼────────┐
                                             │  local Docker  │
                                             │  daemon        │
                                             └────────────────┘
```

---

## Why Camptainer?

- **One canvas for everything.** Create networks, create containers, and
  wire them together with drag-and-drop. No YAML, no CLI juggling.
- **Round-trip compose.** Paste a `docker-compose.yml` and Camptainer
  materialises it; export the live setup back to a file at any time.
- **Self-scoped.** Everything Camptainer creates is labelled
  `app=camptainer`, so your other Docker objects stay invisible and
  untouched.
- **Resilient.** Background jobs with live progress, idempotent teardown,
  auto-reconnecting WebSocket — never stuck on a spinner.

---

## Features

### Topology & wiring
- Drag from a **container node** to a **network node** to connect them
- Click an edge and press <kbd>Delete</kbd> to disconnect
- Click a container to open a detail panel (overview, **live logs**,
  **CPU/memory stats**)
- Node positions persist in `localStorage` across reloads
- MiniMap, zoom, pan, search filter

### Lifecycle
- Create networks, create containers (image, name, ports, env, volumes,
  networks, restart policy, CPU/memory limits)
- Start / stop / restart / remove individual containers
- Recreate a container with a new spec
- Pull images with streaming progress (SSE)
- Export the current canvas as a `docker-compose.yml`

### Compose
- **Import** any `docker-compose.yml` (services, networks, ports, env,
  volumes, restart policy)
- Imports run as **background jobs** with a real progress bar — the
  dialog stays responsive and you can hide it while the work continues
- Every import is **persisted**, so a single click can later **tear down
  the entire stack** the import created (containers + networks, leaving
  the rest of Docker alone)
- A separate **Compose imports** panel in the sidebar lists past imports
  with per-row teardown / forget buttons

### Images & volumes
- **Images** panel — list local images with sizes, remove unused, prune
  dangling, see which are in use by a container.
- **Volumes** panel — list named volumes, remove, prune dangling.

### Container details
- **Overview** — image, ports, command, attached networks, lifecycle buttons
- **Logs** — live SSE stream with line counter and auto-scroll
- **Metrics** — current CPU/memory + a 60-point sparkline so you can see
  the trend (polling pauses when the tab is hidden)
- **Config** — environment variables, volume mounts, labels
- **Shell** — interactive `docker exec` PTY; type a command, hit
  <kbd>Enter</kbd>, see output stream back
- **Recreate** — stop + remove + recreate with the current spec (handy
  when you tweak a label or env var and want to re-apply)

### Stacks
- Snapshot the current live objects as a named stack (SQLite-backed)
- **Apply** / **Teardown** / **Delete** saved stacks
- Useful for "save what I have right now" workflows that aren't tied to
  a compose file

### Stacks
- Snapshot the current live objects as a named stack (SQLite-backed)
- **Apply** / **Teardown** / **Delete** saved stacks
- Useful for "save what I have right now" workflows that aren't tied to
  a compose file

### Quality-of-life
- Light / dark theme (auto-detected, persisted, switchable from Settings)
- Toasts for success / error feedback (with manual dismiss and a 5-visible cap)
- Real-time UI updates via WebSocket with exponential-backoff reconnect
- WebSocket failures don't break the app — manual refresh always works
- **Keyboard shortcuts** — <kbd>Ctrl</kbd>+<kbd>I</kbd> import, <kbd>Ctrl</kbd>+<kbd>E</kbd> export,
  <kbd>Ctrl</kbd>+<kbd>K</kbd> settings, <kbd>/</kbd> focus search, <kbd>?</kbd> help
- **Network detail popover** — click a network node to see driver and attached containers
- **In-flight import badge** — the nav-rail Resources icon shows a count
  when imports are running
- **Optimistic connect/disconnect** — drag-drop is instant; rolls back on error
- **Pydantic-validated inputs** — names, CPU, memory, image refs all
  checked server-side so the user gets a real error instead of a Docker
  daemon cryptic one
- **SQLite-backed jobs** — in-flight imports survive a backend restart

---

## Tech stack

| Layer        | Choice                                            |
|--------------|---------------------------------------------------|
| Backend      | [FastAPI](https://fastapi.tiangolo.com) 0.111     |
| ASGI server  | [Uvicorn](https://www.uvicorn.org)                |
| Docker API   | [docker-py](https://docker-py.readthedocs.io) 7.1 |
| Validation   | [Pydantic](https://docs.pydantic.dev) 2.13        |
| Real-time    | WebSockets (`/events`, `/containers/{id}/exec/{eid}/attach`) + SSE for image pulls and log streaming |
| Persistence  | SQLite (built-in `sqlite3`, WAL mode) for stacks, imports, and jobs |
| Frontend     | [React](https://react.dev) 18 + [Vite](https://vitejs.dev) 5 |
| Canvas       | [React Flow](https://reactflow.dev) 11            |
| Styling      | Hand-rolled CSS with CSS variables for theming   |

No build step beyond `npm install` / `vite build`. No state-management
library — a handful of `useState` / `useReducer` hooks is enough at this
size.

---

## Prerequisites

- **Python 3.11+** (3.13 / 3.14 work)
- **Node.js 18+**
- **Docker Desktop** (or any Docker daemon) running and reachable from
  your shell (`docker version` should succeed)
- Linux / macOS / Windows (WSL2 recommended on Windows)

---

## Quick start

### One command (Windows)
Double-click **`start.bat`** — it creates the venv, installs deps, and
opens the backend and frontend in their own terminal windows.

### One command (Linux / macOS)
```bash
./run.sh
```

### Manual
```bash
# 1. backend
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 9096

# 2. frontend (new terminal)
cd frontend
npm install
npm run dev -- --host 0.0.0.0 --port 9095
```

Then open:
- **UI:** http://localhost:9095
- **API docs:** http://localhost:9096/docs
- **WebSocket:** ws://localhost:9096/events

> The Vite dev server proxies `/containers`, `/networks`, `/stacks`,
> `/compose`, `/compose/imports` and `/events` to the backend on port
> 9096, so no CORS setup is needed. Override the backend URL with
> `VITE_BACKEND_URL=http://host:port npm run dev` if you run them on
> different machines.

---

## Configuration

| Variable           | Default                  | Purpose                                      |
|--------------------|--------------------------|----------------------------------------------|
| `VITE_BACKEND_URL` | `http://localhost:9096`  | Where the Vite dev proxy forwards API calls. |
| `backend/requirements.txt` pins the Python deps. SQLite DB is auto-created at `backend/data/camptainer.db` on first run. |

The Docker socket location follows the standard `docker-py` rules — set
`DOCKER_HOST` if your daemon isn't on the default socket.

---

## How to use it

1. **Create a network** — sidebar → *Resources* → *Networks* → enter a
   name → <kbd>+</kbd>. Repeat for any others.
2. **Create a container** — *Create* tab → fill in name, image, ports,
   env, volumes, tick the networks it should join → *Create container*.
3. **Wire them up** — in the canvas, **drag from a container node onto
   a network node** to connect. Click an edge and press
   <kbd>Delete</kbd> to disconnect.
4. **Inspect a container** — click any container node → right-side
   *Detail* panel shows state, recent logs (live tail), and CPU/mem
   stats.
5. **Import a compose file** — top bar → *Import* → paste YAML → *Import
   stack*. Watch the progress bar; you can hide the dialog and the
   import keeps running. The new stack shows up under *Compose imports*
   in the sidebar with a teardown button.
6. **Export to compose** — top bar → *Export* downloads a
   `docker-compose.yml` reflecting every Camptainer-managed container
   and network.
7. **Save / apply / teardown stacks** — *Resources* → *Saved stacks* →
   save the current workspace, re-apply it later, or tear it down.

---

## Project structure

```
camptainer/
├── backend/
│   ├── app/
│   │   ├── main.py              ← FastAPI app + WebSocket /events
│   │   ├── config.py            ← labels, DB path
│   │   ├── db.py                ← SQLite (stacks + compose imports)
│   │   ├── docker_client.py     ← thin wrapper around docker-py
│   │   ├── events.py            ← WS connection manager + snapshot loop
│   │   ├── jobs.py              ← in-memory job manager for long imports
│   │   ├── models.py            ← Pydantic request/response models
│   │   └── routes/
│   │       ├── compose.py       ← /compose, /compose/import*, /compose/pull
│   │       ├── containers.py    ← /containers + lifecycle + logs + stats
│   │       ├── networks.py      ← /networks
│   │       └── stacks.py        ← /stacks
│   ├── data/                    ← SQLite DB (auto-created, gitignored)
│   └── requirements.txt
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js           ← dev proxy + bind config
│   └── src/
│       ├── main.jsx
│       ├── App.jsx              ← canvas, sidebar, toasts
│       ├── api.js               ← fetch client
│       ├── styles.css
│       └── components/
│           ├── ComposeImport.jsx     ← import dialog + progress
│           ├── ContainerDetail.jsx   ← right-rail inspector
│           ├── CreateContainerForm.jsx
│           ├── Icon.jsx
│           ├── ImportsPanel.jsx      ← teardown list
│           ├── nodes.jsx             ← React Flow node renderers
│           ├── StacksPanel.jsx
│           └── Toasts.jsx
├── run.sh
├── start.bat
├── .gitignore
├── LICENSE
└── README.md
```

---

## API reference

### Networks
| Method | Endpoint             | Purpose                            |
|--------|----------------------|------------------------------------|
| POST   | `/networks`          | create a network                   |
| GET    | `/networks`          | list Camptainer networks           |
| DELETE | `/networks/{name}`   | remove a network                   |

### Containers
| Method | Endpoint                                | Purpose                                  |
|--------|-----------------------------------------|------------------------------------------|
| POST   | `/containers`                           | create a container                       |
| GET    | `/containers`                           | list Camptainer containers               |
| GET    | `/containers/{id}`                      | full details (env, volumes, labels)     |
| DELETE | `/containers/{id}`                      | remove a container                       |
| POST   | `/containers/{id}/start`                | start a stopped container                |
| POST   | `/containers/{id}/stop`                 | stop a running container                 |
| POST   | `/containers/{id}/restart`              | restart a container                      |
| POST   | `/containers/{id}/recreate`             | stop + remove + recreate with new spec   |
| GET    | `/containers/{id}/logs?tail=300&follow=true` | one-shot tail or SSE stream          |
| GET    | `/containers/{id}/stats`                | live CPU/memory stats                    |
| POST   | `/containers/{id}/connect`              | join a network (drag-drop)               |
| POST   | `/containers/{id}/disconnect`           | leave a network                          |

### Compose
| Method | Endpoint                            | Purpose                                                                  |
|--------|-------------------------------------|--------------------------------------------------------------------------|
| GET    | `/compose`                          | export current setup as `docker-compose.yml` (text/yaml)                 |
| POST   | `/compose/import`                   | enqueue a compose import → returns `{job_id, status, total}` immediately |
| GET    | `/compose/import/{job_id}`          | poll job status + result                                                 |
| GET    | `/compose/imports`                  | list past imports (with their live resources)                            |
| POST   | `/compose/imports/{id}/teardown`    | remove every container + network from one import (idempotent)            |
| DELETE | `/compose/imports/{id}`             | forget an import record (resources untouched)                            |
| POST   | `/compose/pull?image=…`             | pull an image, streaming progress (text/plain)                           |

### Stacks
| Method | Endpoint                            | Purpose                                  |
|--------|-------------------------------------|------------------------------------------|
| POST   | `/stacks`                           | create a full stack at once              |
| POST   | `/stacks/save`                      | snapshot current live objects            |
| GET    | `/stacks`                           | list saved stacks                        |
| POST   | `/stacks/{id}/apply`                | re-create a saved stack                  |
| POST   | `/stacks/{id}/teardown`             | remove a stack's containers/networks     |
| DELETE | `/stacks/{id}`                      | delete a saved stack record              |

### Images, volumes, exec
| Method | Endpoint                                          | Purpose                                          |
|--------|---------------------------------------------------|--------------------------------------------------|
| GET    | `/images`                                         | list local images with size + in-use flag        |
| DELETE | `/images/{id}?force=true`                         | remove an image                                  |
| POST   | `/images/prune`                                   | prune dangling images                            |
| GET    | `/volumes`                                        | list named volumes                               |
| DELETE | `/volumes/{name}?force=true`                      | remove a volume                                  |
| POST   | `/volumes/prune`                                  | prune dangling volumes                           |
| POST   | `/containers/{id}/exec`                           | create an interactive exec                       |
| WS     | `/containers/{id}/exec/{exec_id}/attach`          | bidirectional stream (browser ↔ container PTY)   |

### Other
| Method | Endpoint    | Purpose                                       |
|--------|-------------|-----------------------------------------------|
| GET    | `/health`   | liveness + Docker daemon status               |
| WS     | `/events`   | live snapshot feed (pushes full state every 3s) |

---

## Development

### Hot reload
- Backend: add `--reload` to your `uvicorn` command
- Frontend: Vite already HMRs on save

### Re-creating the venv
```bash
cd backend
rm -rf .venv
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Production-ish build
```bash
cd frontend
npm run build
# serve frontend/dist/ with any static host; point it at the backend
# (remember to set the API base URL in api.js, or rebuild with VITE_BACKEND_URL)
cd ../backend
uvicorn app.main:app --host 0.0.0.0 --port 9096
```

> This project is designed as a local single-user tool. It binds to
> `0.0.0.0` so it can be reached across your LAN / Tailscale / SSH
> tunnel, but it has **no authentication**. Don't expose it to the
> public internet without putting it behind a reverse proxy with auth.

---

## Troubleshooting

| Symptom                                                       | Fix                                                                                              |
|---------------------------------------------------------------|--------------------------------------------------------------------------------------------------|
| `Could not connect to the Docker daemon`                      | Start Docker Desktop (or `sudo systemctl start docker` on Linux).                                 |
| Import button returns 404                                     | Vite proxy is missing `/compose` — make sure you're on the latest `vite.config.js`.              |
| Import dialog hangs on "Queued…"                              | The worker thread crashed. Check the backend logs (the `uvicorn` terminal).                      |
| Container detail panel is empty                               | The container isn't labelled `app=camptainer` — Camptainer filters those out.                    |
| `pydantic-core` build fails on Python 3.14                    | Make sure `requirements.txt` pins `pydantic>=2.13.5` (it has prebuilt cp314 wheels).             |
| `address already in use` when importing `8080:80`             | Something on the host is already bound to that port. Change the host port or stop the conflict. |
| `cd backend && uvicorn …` complains about `app/main`          | Run with `--app-dir backend` or `cd backend && uvicorn app.main:app`.                            |

---

## Contributing

PRs welcome. A few ground rules:

- Keep the **no-build** philosophy on the backend. No `setup.py`
  rewrite, no migration framework, no ORM.
- Frontend: prefer small, focused components over prop-drilling the
  whole app. Stick to React + Vite + plain CSS.
- New endpoints should land under `backend/app/routes/` and be wired
  into `main.py`. Add a row to the **API reference** above.
- Anything user-facing that touches a Docker object should filter on
  the `app=camptainer` label.

---

## License

**PolyForm Noncommercial License 1.0.0** — see [`LICENSE`](./LICENSE).

In short: you can read, copy, modify, and self-host this for personal,
educational, or research use, **but you may not build commercial
software on top of it**. If you want to use it commercially, please
reach out for a separate licence.

```
Required Notice: Camptainer contributors
```

---

## Acknowledgments

- [FastAPI](https://fastapi.tiangolo.com) and [Pydantic](https://docs.pydantic.dev)
  for making the backend ~300 lines instead of ~3000.
- [React Flow](https://reactflow.dev) for the drag-and-drop canvas —
  Camptainer's entire topology view is a few hundred lines on top of it.
- [PolyForm Project](https://polyformproject.org) for the license
  template.
