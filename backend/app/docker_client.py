"""Thin wrapper around the Docker SDK.

Every object created through this module is labelled ``app=camptainer`` so the
UI only ever lists containers/networks that Camptainer itself owns.
"""
from typing import List, Optional

import docker
from docker.errors import DockerException, NotFound, APIError

from . import config

_client = None


def get_client():
    """Return a cached Docker client, raising a clear error if Docker is down."""
    global _client
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


def get_api_client():
    """Low-level APIClient (for exec streaming)."""
    return get_client().api


# ---------------------------------------------------------------------------
# Parsing helpers (turn friendly UI strings into Docker SDK shapes)
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
            # host part may be empty -> random port
            out[f"{container}/{proto}"] = None
    return out


def _parse_volumes(volumes: List[str]):
    """['C:\\\\host:/container:rw'] -> {'C:/host': {'bind': '/container', 'mode': 'rw'}}

    The Docker SDK's ``volumes`` dict is keyed by the HOST (source) path, with
    ``bind`` = the container (target) path. Split from the RIGHT so Windows
    drive-letter colons (``C:``) in the host are not mistaken for the separator.
    """
    out = {}
    for v in volumes or []:
        if not v:
            continue
        parts = v.rsplit(":", 2)
        if len(parts) == 3:
            host, container, mode = parts
        elif len(parts) == 2:
            host, container, mode = parts[0], parts[1], "rw"
        else:
            continue
        # Docker on Windows prefers forward slashes for bind mounts
        host = host.replace("\\", "/")
        out[host] = {"bind": container, "mode": mode}
    return out


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
        out.append(
            {"id": n.id, "name": n.name, "driver": n.attrs.get("Driver", "bridge")}
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
    return {
        "id": c.id[:12],
        "name": (c.name or "").lstrip("/"),
        "image": (attrs.get("Config", {}).get("Image") or ""),
        "status": c.status,
        "networks": nets,
        "ports": ports,
    }


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

    # Create attached to the first network; join the rest afterwards.
    container = cli.containers.run(**run_kwargs)
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


def remove_container(container_id: str):
    cli = get_client()
    try:
        c = cli.containers.get(container_id)
        c.remove(force=True)
    except NotFound:
        pass


def connect_container(container_id: str, network: str):
    """Join a container to a network. Idempotent: already-attached is OK."""
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
    """Leave a network. Idempotent: not-connected is OK."""
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
    cli = get_client()
    cli.containers.get(container_id).start()


def stop_container(container_id: str):
    cli = get_client()
    cli.containers.get(container_id).stop()


def restart_container(container_id: str):
    cli = get_client()
    cli.containers.get(container_id).restart()


def get_logs(container_id: str, tail: int = 200, timestamps: bool = True) -> str:
    cli = get_client()
    c = cli.containers.get(container_id)
    logs = c.logs(tail=tail, timestamps=timestamps, stdout=True, stderr=True)
    if isinstance(logs, bytes):
        logs = logs.decode("utf-8", errors="replace")
    return logs


def get_stats(container_id: str) -> dict:
    cli = get_client()
    c = cli.containers.get(container_id)
    s = c.stats(stream=False)
    mem = s.get("memory_stats", {})
    mem_usage = mem.get("usage", 0)
    mem_limit = mem.get("limit", 0)
    cpu_stats = s.get("cpu_stats", {}) or {}
    precpu = s.get("precpu_stats", {}) or {}
    cpu_delta = (
        cpu_stats.get("cpu_usage", {}).get("total_usage", 0)
        - precpu.get("cpu_usage", {}).get("total_usage", 0)
    )
    sys_delta = cpu_stats.get("system_cpu_usage", 0) - precpu.get("system_cpu_usage", 0)
    online = cpu_stats.get("online_cpus") or len(
        cpu_stats.get("cpu_usage", {}).get("percpu_usage", []) or [1]
    )
    cpu_percent = (cpu_delta / sys_delta) * online * 100 if sys_delta > 0 else 0.0
    return {
        "cpu_percent": round(cpu_percent, 2),
        "mem_usage": mem_usage,
        "mem_limit": mem_limit,
        "mem_percent": round(mem_usage / mem_limit * 100, 2) if mem_limit else 0,
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
    )


# ---------------------------------------------------------------------------
# Snapshot (used by the WebSocket live feed)
# ---------------------------------------------------------------------------

def snapshot() -> dict:
    return {"containers": list_containers(), "networks": list_networks()}


def build_compose() -> str:
    """Render the current Camptainer objects as a docker-compose.yml string."""
    cli = get_client()
    containers = cli.containers.list(
        all=True, filters={"label": config.LABEL_FILTER}
    )
    nets = cli.networks.list(filters={"label": config.LABEL_FILTER})

    lines = ['version: "3.8"', "services:"]
    for c in containers:
        attrs = c.attrs or {}
        name = (c.name or "container").lstrip("/")
        image = attrs.get("Config", {}).get("Image", "")
        lines.append(f"  {name}:")
        lines.append(f"    image: {image}")

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
            lines.append("    ports:")
            for p in port_list:
                lines.append(f'      - "{p}"')

        env = attrs.get("Config", {}).get("Env", []) or []
        if env:
            lines.append("    environment:")
            for e in env:
                lines.append(f"      - {e}")

        cnets = list((attrs.get("NetworkSettings", {}).get("Networks", {}) or {}).keys())
        if cnets:
            lines.append("    networks:")
            for n in cnets:
                lines.append(f"      - {n}")

    if nets:
        lines.append("networks:")
        for n in nets:
            lines.append(f"  {n.name}:")
            lines.append(f"    driver: {n.attrs.get('Driver', 'bridge')}")

    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Stacks (save current live state, re-apply, tear down) + compose import
# ---------------------------------------------------------------------------

def _mounts_to_strings(attrs: dict) -> List[str]:
    out = []
    for m in attrs.get("Mounts", []) or []:
        src = m.get("Source")
        tgt = m.get("Target")
        if src and tgt:
            out.append(f"{src}:{tgt}:{m.get('Mode') or 'rw'}")
    return out


def snapshot_definition() -> dict:
    """Build a stack definition dict from the current live Camptainer objects."""
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
    nets = [
        n.name
        for n in cli.networks.list(filters={"label": config.LABEL_FILTER})
    ]
    return {
        "networks": [{"name": x} for x in nets],
        "containers": containers,
    }


def apply_definition(definition: dict) -> dict:
    created = {"networks": [], "containers": []}
    for n in definition.get("networks", []):
        try:
            created["networks"].append(create_network(n["name"]))
        except Exception:
            pass
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
                )
            )
        except Exception:
            pass
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


def import_compose(text: str, on_progress=None) -> dict:
    """Create the networks + containers described by a docker-compose.yml.

    If ``on_progress`` is provided it is called as
    ``on_progress(message: str, current: int, total: int)`` after each
    network and each service has been processed.
    """
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
        q.put(None)

    threading.Thread(target=worker, daemon=True).start()
    while True:
        chunk = q.get()
        if chunk is None:
            break
        yield chunk
