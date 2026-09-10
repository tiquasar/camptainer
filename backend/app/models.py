import re
from typing import List, Optional

from pydantic import BaseModel, Field

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
    # If True and the image is not local, the backend will pull it before
    # creating the container. Defaults to False to preserve old behaviour.
    auto_pull: bool = False


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
