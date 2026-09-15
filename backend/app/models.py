import re
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

# Docker requires container/network names to match this pattern.
_NAME_RE = r"^[a-zA-Z0-9][a-zA-Z0-9_.-]*$"

# Docker memory spec: 0, 123, 123b, 123k, 123m, 123g (case-insensitive).
_MEM_RE = r"^\d+(\.\d+)?[bBkKmMgG]?$"

_IMAGE_RE = r"^[a-zA-Z0-9_./:@\-]+(?::[a-zA-Z0-9_.\-]+)?$"


def _name(v: str) -> str:
    """Strip and return the value; Pydantic's pattern does the rest."""
    return v.strip()


class NetworkCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=63, pattern=_NAME_RE)
    driver: str = Field("bridge", pattern=r"^(bridge|host|overlay|macvlan|ipvlan|none)$")


class ContainerCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=63, pattern=_NAME_RE)
    image: str = Field(..., min_length=1, max_length=512, pattern=_IMAGE_RE)
    # e.g. ["8080:80", "53:53/udp"]
    ports: List[str] = []
    # e.g. ["KEY=value", "FOO=bar"]
    environment: List[str] = []
    # e.g. ["/host/path:/container/path:rw"]
    volumes: List[str] = []
    # network names this container should join at creation time
    networks: List[str] = []
    command: Optional[str] = None
    restart_policy: Optional[str] = Field(
        None, pattern=r"^(no|always|unless-stopped|on-failure)$"
    )
    cpu: Optional[float] = Field(None, ge=0, le=1024)
    mem: Optional[str] = Field(None, pattern=_MEM_RE)
    # Optional Docker run-config bits preserved across build_compose round-trip.
    user: Optional[str] = Field(None, max_length=128)
    working_dir: Optional[str] = Field(None, max_length=512)
    extra_hosts: List[str] = []  # e.g. ["db:10.0.0.1"]
    dns: List[str] = []  # e.g. ["1.1.1.1"]
    cap_add: List[str] = []  # e.g. ["NET_ADMIN"]
    cap_drop: List[str] = []  # e.g. ["MKNOD"]
    healthcheck: Optional[dict] = None  # {"test": [...], "interval": 30s, ...}
    # If True and the image is not local, the backend will pull it before
    # creating the container. Defaults to False to preserve old behaviour.
    auto_pull: bool = False

    @field_validator("ports")
    @classmethod
    def _ports_format(cls, v: List[str]) -> List[str]:
        for p in v:
            if not p or ":" not in p:
                raise ValueError(
                    f"Invalid port mapping: {p!r} (expected 'host:container[/proto]')"
                )
            host, _, container = p.partition(":")
            if "/" in container:
                container = container.split("/", 1)[0]
            if not host.isdigit() or not container.isdigit():
                raise ValueError(f"Invalid port mapping: {p!r} (ports must be numeric)")
        return v

    @field_validator("environment")
    @classmethod
    def _env_format(cls, v: List[str]) -> List[str]:
        for e in v:
            if "=" not in e:
                raise ValueError(f"Invalid env entry: {e!r} (expected KEY=value)")
        return v

    @field_validator("volumes")
    @classmethod
    def _volumes_format(cls, v: List[str]) -> List[str]:
        for vol in v:
            if ":" not in vol:
                raise ValueError(
                    f"Invalid volume: {vol!r} (expected host:container[:mode])"
                )
        return v

    @field_validator("extra_hosts")
    @classmethod
    def _hosts_format(cls, v: List[str]) -> List[str]:
        for h in v:
            if ":" not in h:
                raise ValueError(f"Invalid extra_host: {h!r} (expected 'host:ip')")
        return v


class ComposeImport(BaseModel):
    yaml: str = Field(..., max_length=10 * 1024 * 1024)  # 10 MB cap
    name: Optional[str] = Field(None, max_length=200)


class StackSave(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)


class ConnectRequest(BaseModel):
    network: str = Field(..., min_length=1, max_length=63, pattern=_NAME_RE)


class StackCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    networks: List[NetworkCreate] = []
    containers: List[ContainerCreate] = []


class ExecRequest(BaseModel):
    command: List[str] = Field(..., min_length=1, max_length=64)
    interactive: bool = True


# ---- responses -------------------------------------------------------------

class NetworkOut(BaseModel):
    id: str
    name: str
    driver: str
    containers: List[str] = []  # names of containers attached


class ContainerOut(BaseModel):
    id: str
    name: str
    image: str
    status: str
    networks: List[str] = []
    ports: List[str] = []


class ImageOut(BaseModel):
    id: str
    tags: List[str] = []
    size: int = 0
    created: int = 0
    in_use: bool = False  # best-effort: True if any container references it


class VolumeOut(BaseModel):
    name: str
    driver: str = "local"
    mountpoint: str = ""
    created_at: str = ""
