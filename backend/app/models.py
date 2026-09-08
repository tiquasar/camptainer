from typing import List, Optional
from pydantic import BaseModel, Field


class NetworkCreate(BaseModel):
    name: str = Field(..., min_length=1)
    driver: str = "bridge"


class ContainerCreate(BaseModel):
    name: str = Field(..., min_length=1)
    image: str = Field(..., min_length=1)
    # e.g. ["8080:80", "53:53/udp"]
    ports: List[str] = []
    # e.g. ["KEY=value", "FOO=bar"]
    environment: List[str] = []
    # e.g. ["/host/path:/container/path:rw"]
    volumes: List[str] = []
    # network names this container should join at creation time
    networks: List[str] = []
    command: Optional[str] = None
    restart_policy: Optional[str] = None  # e.g. "unless-stopped"
    cpu: Optional[float] = None  # CPU cores (e.g. 0.5, 2)
    mem: Optional[str] = None  # memory limit, e.g. "512m", "1g"


class ComposeImport(BaseModel):
    yaml: str
    name: Optional[str] = None  # optional friendly name for the import record


class StackSave(BaseModel):
    name: str = Field(..., min_length=1)


class ConnectRequest(BaseModel):
    network: str


class StackCreate(BaseModel):
    name: str = Field(..., min_length=1)
    networks: List[NetworkCreate] = []
    containers: List[ContainerCreate] = []


# ---- responses -------------------------------------------------------------

class NetworkOut(BaseModel):
    id: str
    name: str
    driver: str


class ContainerOut(BaseModel):
    id: str
    name: str
    image: str
    status: str
    networks: List[str] = []
    ports: List[str] = []
