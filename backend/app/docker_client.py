"""Thin wrapper around the Docker SDK.

Every object created through this module is labelled ``app=camptainer`` so
the UI only ever lists containers/networks that Camptainer itself owns.

The client is cached but reset on any failure so a Docker daemon restart
mid-session is recovered from automatically.
"""
import logging
import shlex
import threading
from typing import List, Optional

import docker
from docker.errors import APIError, DockerException, ImageNotFound, NotFound

from . import config

log = logging.getLogger("camptainer.docker")

_client = None
_client_lock = threading.Lock()


def get_client():
    """Return a cached Docker client, raising a clear error if Docker is down."""
    global _client
    if _client is not None:
        return _client
    with _client_lock:
        if _client is None:
            try:
                _client = docker.from_env()
                _client.ping()
            except DockerException as exc:
                raise RuntimeError(
                    "Could not connect to the Docker daemon. Is Docker Desktop "
                    "running and reachable? Original error: " + str(exc)
                )
    return _client


def reset_client() -> None:
    """Forget the cached client so the next ``get_client()`` re-pings."""
    global _client
    with _client_lock:
        _client = None


def healthcheck() -> bool:
    """Reset the cached client if Docker isn't responding anymore."""
    global _client
    if _client is None:
        return False
    try:
        _client.ping()
        return True
    except Exception:
        log.warning("Docker ping failed; resetting client")
        _client = None
        return False


def docker_status() -> dict:
    """Return a snapshot of Docker reachability + counts."""
    try:
        cli = get_client()
        info = cli.info()
        containers = cli.containers.list(all=True, filters={"label": config.LABEL_FILTER})
        networks = cli.networks.list(filters={"label": config.LABEL_FILTER})
        return {
            "ok": True,
            "server_version": info.get("ServerVersion", ""),
            "containers": len(containers),
            "networks": len(networks),
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def get_api_client():
    return get_client().api


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

def _parse_ports(ports: List[str]):
    """['8080:80', '53:53/udp'] -> {'80/tcp': 8080, '53/udp': 53}"""
    out = {}
    for p in ports or []:
        if not p:
            continue
        host, _, container = p.partition(":")
        proto = "tcp"
        if "/" in container:
            container, proto = container.split("/", 1)
        try:
            out[f"{container}/{proto}"] = int(host) if host else None
        except ValueError:
            out[f"{container}/{proto}"] = None
    return out


def _parse_volumes(volumes: List[str]):
    r"""['/host:/container:rw'] -> {'/host': {'bind': '/container', 'mode': 'rw'}}

    Splits from the LEFT on the first two ``:`` to allow Windows drive
    letters (``C:\data:/data:rw``) and Linux paths with embedded ``:``.
    Anything past the second ``:`` is the mode flag.
    """
    out = {}
    for v in volumes or []:
        if not v:
            continue
        host, sep, rest = v.partition(":")
        if not sep:
            continue  # missing the container path; skip rather than crash
        container, sep2, mode = rest.partition(":")
        if not sep2:
            mode = "rw"
        if not host or not container:
            continue
        host = host.replace("\\", "/")
        out[host] = {"bind": container, "mode": mode or "rw"}
    return out


def _ensure_image(cli, image: str, auto_pull: bool = False):
    """Return the image object; pull it first if missing and ``auto_pull``."""
    try:
        return cli.images.get(image)
    except ImageNotFound:
        if not auto_pull:
            raise
    if auto_pull:
        try:
            cli.images.pull(image)
            return cli.images.get(image)
        except ImageNotFound:
            raise
    raise ImageNotFound(f"No such image: {image}")


# ---------------------------------------------------------------------------
# Networks
# ---------------------------------------------------------------------------

def create_network(name: str, driver: str = "bridge") -> dict:
    cli = get_client()
    try:
        net = cli.networks.create(
            name, driver=driver, labels=config.LABELS, check_duplicate=True
        )
    except APIError as exc:
        if "already exists" in str(exc).lower():
            net = cli.networks.get(name)
        else:
            raise
    return {"id": net.id, "name": net.name, "driver": net.attrs.get("Driver", driver)}


def list_networks() -> List[dict]:
    cli = get_client()
    nets = cli.networks.list(filters={"label": config.LABEL_FILTER})
    out = []
    for n in nets:
        containers = [
            (c.get("Name") or "").lstrip("/")
            for c in (n.attrs.get("Containers") or {}).values()
        ]
        out.append(
            {
                "id": n.id,
                "name": n.name,
                "driver": n.attrs.get("Driver", "bridge"),
                "containers": containers,
            }
        )
    return out


def remove_network(name: str):
    cli = get_client()
    try:
        cli.networks.get(name).remove()
    except NotFound:
        pass


# ---------------------------------------------------------------------------
# Containers
# ---------------------------------------------------------------------------

def _container_summary(c) -> dict:
    attrs = c.attrs or {}
    nets = list((attrs.get("NetworkSettings", {}) or {}).get("Networks", {}).keys())
    ports = []
    ports_map = (attrs.get("NetworkSettings", {}) or {}).get("Ports", {}) or {}
    for container_port_proto, bindings in ports_map.items():
        if bindings:
            for b in bindings:
                hp = b.get("HostPort")
                if hp:
                    ports.append(f"{hp}:{container_port_proto}")
        else:
            ports.append(container_port_proto)
    env = attrs.get("Config", {}).get("Env") or []
    return {
        "id": c.id[:12],
        "name": (c.name or "").lstrip("/"),
        "image": (attrs.get("Config", {}).get("Image") or ""),
        "status": c.status,
        "networks": nets,
        "ports": ports,
        "environment": env,
        "command": attrs.get("Config", {}).get("Cmd"),
        "created": attrs.get("Created", ""),
    }


def _container_full(c) -> dict:
    """Like ``_container_summary`` but with volumes, labels, env details."""
    s = _container_summary(c)
    attrs = c.attrs or {}
    s["labels"] = attrs.get("Config", {}).get("Labels") or {}
    s["volumes"] = [
        f"{m.get('Source')}:{m.get('Target')}:{m.get('Mode') or 'rw'}"
        for m in (attrs.get("Mounts") or [])
        if m.get("Source") and m.get("Target")
    ]
    s["restart_policy"] = (attrs.get("HostConfig", {}) or {}).get("RestartPolicy", {}).get(
        "Name"
    )
    return s


def create_container(
    name: str,
    image: str,
    ports: Optional[List[str]] = None,
    environment: Optional[List[str]] = None,
    volumes: Optional[List[str]] = None,
    networks: Optional[List[str]] = None,
    command: Optional[str] = None,
    restart_policy: Optional[str] = None,
    cpu: Optional[float] = None,
    mem: Optional[str] = None,
    auto_pull: bool = False,
):
    cli = get_client()
    networks = networks or []
    ports_map = _parse_ports(ports)
    vols_map = _parse_volumes(volumes)

    run_kwargs = dict(
        image=image,
        name=name,
        detach=True,
        labels=config.LABELS,
        ports=ports_map or None,
        environment=environment or None,
        volumes=vols_map or None,
        network=networks[0] if networks else None,
        command=command,
    )
    if restart_policy:
        run_kwargs["restart_policy"] = restart_policy
    if cpu:
        try:
            run_kwargs["nano_cpus"] = int(float(cpu) * 1_000_000_000)
        except (ValueError, TypeError):
            pass
    if mem:
        run_kwargs["mem_limit"] = mem

    if auto_pull:
        _ensure_image(cli, image, auto_pull=True)

    try:
        container = cli.containers.run(**run_kwargs)
    except ImageNotFound as exc:
        raise RuntimeError(
            f"Image not found locally: {image}. "
            f"Re-submit with auto_pull=true to fetch it first."
        ) from exc

    for extra in networks[1:]:
        try:
            cli.networks.get(extra).connect(container)
        except (NotFound, APIError):
            pass
    container.reload()
    return _container_summary(container)


def list_containers() -> List[dict]:
    cli = get_client()
    containers = cli.containers.list(all=True, filters={"label": config.LABEL_FILTER})
    return [_container_summary(c) for c in containers]


def get_container(container_id: str) -> dict:
    cli = get_client()
    return _container_full(cli.containers.get(container_id))


def remove_container(container_id: str):
    cli = get_client()
    try:
        c = cli.containers.get(container_id)
        c.remove(force=True)
    except NotFound:
        pass


def connect_container(container_id: str, network: str):
    cli = get_client()
    c = cli.containers.get(container_id)
    net = cli.networks.get(network)
    try:
        net.connect(c)
    except APIError as exc:
        if "already attached" in str(exc).lower():
            return
        raise


def disconnect_container(container_id: str, network: str):
    cli = get_client()
    c = cli.containers.get(container_id)
    net = cli.networks.get(network)
    try:
        net.disconnect(c, force=True)
    except APIError as exc:
        if "not connected" in str(exc).lower():
            return
        raise


def remove_container_by_name(name: str):
    cli = get_client()
    try:
        cli.containers.get(name).remove(force=True)
    except NotFound:
        pass


# ---- lifecycle -------------------------------------------------------------

def start_container(container_id: str):
    get_client().containers.get(container_id).start()


def stop_container(container_id: str):
    get_client().containers.get(container_id).stop()


def restart_container(container_id: str):
    get_client().containers.get(container_id).restart()


def get_logs(container_id: str, tail: int = 200, timestamps: bool = True) -> str:
    cli = get_client()
    c = cli.containers.get(container_id)
    logs = c.logs(tail=tail, timestamps=timestamps, stdout=True, stderr=True)
    if isinstance(logs, bytes):
        logs = logs.decode("utf-8", errors="replace")
    return logs


def stream_logs(container_id: str, follow: bool = True, tail: int = 100):
    """Generator that yields log lines as they arrive (or last ``tail`` lines)."""
    cli = get_client()
    c = cli.containers.get(container_id)
    # ``stream=True`` + ``follow=True`` blocks; we wrap in a thread so the
    # event loop stays responsive. ``tail`` gives a replay buffer on connect.
    out = c.logs(stream=True, follow=follow, tail=tail, stdout=True, stderr=True)
    for chunk in out:
        if isinstance(chunk, bytes):
            chunk = chunk.decode("utf-8", errors="replace")
        # docker-py yields one log *line* at a time already.
        for line in chunk.splitlines() or [chunk]:
            if line:
                yield line + "\n"


def get_stats(container_id: str) -> dict:
    cli = get_client()
    c = cli.containers.get(container_id)
    s = c.stats(stream=False)
    mem = s.get("memory_stats", {}) or {}
    mem_usage = mem.get("usage", 0) or 0
    mem_limit = mem.get("limit", 0) or 0
    cpu_stats = s.get("cpu_stats", {}) or {}
    precpu = s.get("precpu_stats", {}) or {}
    cpu_delta = (
        (cpu_stats.get("cpu_usage", {}) or {}).get("total_usage", 0)
        - (precpu.get("cpu_usage", {}) or {}).get("total_usage", 0)
    )
    sys_delta = (cpu_stats.get("system_cpu_usage", 0) or 0) - (
        precpu.get("system_cpu_usage", 0) or 0
    )
    online = cpu_stats.get("online_cpus") or len(
        cpu_stats.get("cpu_usage", {}).get("percpu_usage", []) or [1]
    )
    cpu_percent = (cpu_delta / sys_delta) * online * 100 if sys_delta > 0 else 0.0
    return {
        "cpu_percent": round(cpu_percent, 2),
        "mem_usage": mem_usage,
        "mem_limit": mem_limit,
        "mem_percent": round(mem_usage / mem_limit * 100, 2) if mem_limit else 0,
        "ts": s.get("read", ""),
    }


def recreate_container(container_id: str, spec) -> dict:
    cli = get_client()
    c = cli.containers.get(container_id)
    name = (c.name or "").lstrip("/")
    c.remove(force=True)
    return create_container(
        name=name,
        image=spec.image,
        ports=spec.ports,
        environment=spec.environment,
        volumes=spec.volumes,
        networks=spec.networks,
        command=spec.command,
        restart_policy=spec.restart_policy,
        cpu=spec.cpu,
        mem=spec.mem,
        auto_pull=getattr(spec, "auto_pull", False),
    )


# ---------------------------------------------------------------------------
# Exec (interactive shell)
# ---------------------------------------------------------------------------

def exec_create(container_id: str, command: List[str], interactive: bool = True) -> dict:
    """Start a ``docker exec`` and return its id (the stream is opened on attach)."""
    cli = get_client()
    c = cli.containers.get(container_id)
    exec_id = cli.api.exec_create(
        c.id,
        cmd=command,
        stdin=interactive,
        stdout=True,
        stderr=True,
        tty=interactive,
    )["Id"]
    return {"exec_id": exec_id}


def exec_resize(exec_id: str, h: int, w: int) -> None:
    try:
        get_client().api.exec_resize(exec_id, h=h, w=w)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Snapshot
# ---------------------------------------------------------------------------

def snapshot() -> dict:
    try:
        return {"containers": list_containers(), "networks": list_networks()}
    except Exception as exc:
        return {"error": str(exc), "containers": [], "networks": []}


# ---------------------------------------------------------------------------
# Compose export/import
# ---------------------------------------------------------------------------

def build_compose() -> str:
    """Render the current Camptainer objects as a docker-compose.yml string.

    Uses ``yaml.safe_dump`` so values with ``:``, ``#`` and other YAML
    metacharacters round-trip safely.
    """
    import yaml

    cli = get_client()
    containers = cli.containers.list(all=True, filters={"label": config.LABEL_FILTER})
    nets = cli.networks.list(filters={"label": config.LABEL_FILTER})

    services = {}
    for c in containers:
        attrs = c.attrs or {}
        name = (c.name or "container").lstrip("/")
        svc = {"image": attrs.get("Config", {}).get("Image", "")}

        ports_map = (attrs.get("NetworkSettings", {}) or {}).get("Ports", {}) or {}
        port_list = []
        for cp, binds in ports_map.items():
            if binds:
                for b in binds:
                    if b.get("HostPort"):
                        port_list.append(f"{b['HostPort']}:{cp}")
            else:
                port_list.append(cp)
        if port_list:
            svc["ports"] = port_list

        env = attrs.get("Config", {}).get("Env", []) or []
        if env:
            svc["environment"] = list(env)

        cnets = list(
            (attrs.get("NetworkSettings", {}).get("Networks", {}) or {}).keys()
        )
        if cnets:
            svc["networks"] = cnets

        cmd = attrs.get("Config", {}).get("Cmd")
        if cmd:
            svc["command"] = " ".join(shlex.quote(x) for x in cmd)

        restart = (attrs.get("HostConfig", {}) or {}).get("RestartPolicy", {}).get("Name")
        if restart and restart != "no":
            svc["restart"] = restart

        services[name] = svc

    networks_out = {}
    for n in nets:
        networks_out[n.name] = {"driver": n.attrs.get("Driver", "bridge")}

    doc = {}
    if services:
        doc["services"] = services
    if networks_out:
        doc["networks"] = networks_out

    return yaml.safe_dump(doc, sort_keys=False, default_flow_style=False)


def _mounts_to_strings(attrs: dict) -> List[str]:
    out = []
    for m in attrs.get("Mounts", []) or []:
        src = m.get("Source")
        tgt = m.get("Target")
        if src and tgt:
            out.append(f"{src}:{tgt}:{m.get('Mode') or 'rw'}")
    return out


def snapshot_definition() -> dict:
    cli = get_client()
    containers = []
    for c in cli.containers.list(all=True, filters={"label": config.LABEL_FILTER}):
        attrs = c.attrs or {}
        containers.append(
            {
                "name": (c.name or "").lstrip("/"),
                "image": attrs.get("Config", {}).get("Image", ""),
                "ports": _container_summary(c)["ports"],
                "environment": attrs.get("Config", {}).get("Env", []) or [],
                "networks": list(
                    (attrs.get("NetworkSettings", {}).get("Networks", {}) or {}).keys()
                ),
                "volumes": _mounts_to_strings(attrs),
                "command": " ".join(attrs.get("Config", {}).get("Cmd", []) or [])
                or None,
            }
        )
    nets = [n.name for n in cli.networks.list(filters={"label": config.LABEL_FILTER})]
    return {
        "networks": [{"name": x} for x in nets],
        "containers": containers,
    }


def apply_definition(definition: dict) -> dict:
    created = {"networks": [], "containers": [], "errors": []}
    for n in definition.get("networks", []):
        try:
            created["networks"].append(create_network(n["name"]))
        except Exception as exc:
            created["errors"].append(f"network {n.get('name', '?')}: {exc}")
    for ct in definition.get("containers", []):
        try:
            created["containers"].append(
                create_container(
                    name=ct["name"],
                    image=ct["image"],
                    ports=ct.get("ports", []),
                    environment=ct.get("environment", []),
                    volumes=ct.get("volumes", []),
                    networks=ct.get("networks", []),
                    command=ct.get("command"),
                    restart_policy=ct.get("restart_policy"),
                )
            )
        except Exception as exc:
            created["errors"].append(f"container {ct.get('name', '?')}: {exc}")
    return created


def teardown_definition(definition: dict):
    for ct in definition.get("containers", []):
        try:
            remove_container_by_name(ct["name"])
        except Exception:
            pass
    for n in definition.get("networks", []):
        try:
            remove_network(n["name"])
        except Exception:
            pass


def import_compose(text: str, on_progress=None, auto_pull: bool = False) -> dict:
    """Create the networks + containers described by a docker-compose.yml."""
    import yaml

    doc = yaml.safe_load(text) or {}
    created: dict = {"networks": [], "containers": [], "errors": []}

    networks_def = doc.get("networks") or {}
    services = doc.get("services", {}) or {}
    total = len(networks_def) + len(services)
    current = 0

    for nname in networks_def:
        current += 1
        if on_progress:
            on_progress(f"Creating network \u201c{nname}\u201d", current, total)
        try:
            created["networks"].append(create_network(nname))
        except Exception as exc:
            created["errors"].append(f"network {nname}: {exc}")

    for sname, sdef in services.items():
        current += 1
        sdef = sdef or {}
        env = sdef.get("environment", [])
        if isinstance(env, dict):
            env = [f"{k}={v}" for k, v in env.items()]
        if on_progress:
            on_progress(f"Creating service \u201c{sname}\u201d", current, total)
        try:
            created["containers"].append(
                create_container(
                    name=sname,
                    image=sdef.get("image"),
                    ports=sdef.get("ports", []) or [],
                    environment=env or [],
                    volumes=sdef.get("volumes", []) or [],
                    networks=sdef.get("networks", []) or [],
                    restart_policy=sdef.get("restart"),
                    auto_pull=auto_pull,
                )
            )
        except Exception as exc:
            created["errors"].append(f"{sname}: {exc}")

    return created


def pull_image(image: str):
    """Pull an image, yielding human-readable progress lines (for SSE)."""
    import queue
    import threading

    q: "queue.Queue" = queue.Queue()

    def worker():
        try:
            api = get_api_client()
            for line in api.pull(image, stream=True, decode=True):
                status = line.get("status", "")
                prog = line.get("progress", "")
                q.put(f"{status} {prog}".strip() + "\n")
            q.put(f"done: pulled {image}\n")
        except Exception as e:
            q.put(f"# error: {e}\n")
        finally:
            q.put(None)

    threading.Thread(target=worker, daemon=True).start()
    while True:
        chunk = q.get()
        if chunk is None:
            break
        yield chunk


# ---------------------------------------------------------------------------
# Images
# ---------------------------------------------------------------------------

def list_images() -> List[dict]:
    cli = get_client()
    images = cli.images.list()
    out = []
    for img in images:
        tags = img.tags or []
        out.append(
            {
                "id": img.id.split(":")[1][:12] if img.id.startswith("sha256:") else img.id[:12],
                "tags": tags,
                "size": img.attrs.get("Size", 0) or 0,
                "created": img.attrs.get("Created", 0) or 0,
                "in_use": _image_in_use(cli, tags),
            }
        )
    return out


def _image_in_use(cli, tags: List[str]) -> bool:
    if not tags:
        return False
    image_id = tags[0].split(":")[0] if ":" in tags[0] else tags[0]
    try:
        containers = cli.containers.list(all=True)
        for c in containers:
            if c.image.id == image_id or image_id in (c.image.tags or []):
                return True
    except Exception:
        pass
    return False


def remove_image(image_id: str, force: bool = False) -> None:
    cli = get_client()
    try:
        cli.images.remove(image_id, force=force)
    except NotFound:
        pass


def prune_images() -> dict:
    cli = get_client()
    return cli.images.prune(filters={"dangling": True})


# ---------------------------------------------------------------------------
# Volumes
# ---------------------------------------------------------------------------

def list_volumes() -> List[dict]:
    cli = get_client()
    out = []
    for v in cli.volumes.list() or []:
        out.append(
            {
                "name": v.name,
                "driver": v.attrs.get("Driver", "local"),
                "mountpoint": v.attrs.get("Mountpoint", ""),
                "created_at": v.attrs.get("CreatedAt", ""),
            }
        )
    return out


def remove_volume(name: str, force: bool = False) -> None:
    cli = get_client()
    try:
        v = cli.volumes.get(name)
        v.remove(force=force)
    except NotFound:
        pass


def prune_volumes() -> dict:
    cli = get_client()
    return cli.volumes.prune(filters={"dangling": True})
