import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState,
} from "reactflow";
import { api, streamPull } from "./api.js";
import { ContainerNode, NetworkNode } from "./components/nodes.jsx";
import CreateContainerForm from "./components/CreateContainerForm.jsx";
import ContainerDetail from "./components/ContainerDetail.jsx";
import StacksPanel from "./components/StacksPanel.jsx";
import ImportsPanel from "./components/ImportsPanel.jsx";
import ComposeImport from "./components/ComposeImport.jsx";
import Toasts from "./components/Toasts.jsx";
import Icon from "./components/Icon.jsx";

const nodeTypes = { container: ContainerNode, network: NetworkNode };
const POS_KEY = "camptainer:positions";
const THEME_KEY = "camptainer:theme";

function loadTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

function loadPositions() {
  try {
    return JSON.parse(localStorage.getItem(POS_KEY) || "{}");
  } catch {
    return {};
  }
}

function savePositions(positions) {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(positions));
  } catch {
    // Local persistence is a convenience, never a blocker.
  }
}

export default function App() {
  const [networks, setNetworks] = useState([]);
  const [containers, setContainers] = useState([]);
  const [wsStatus, setWsStatus] = useState("Connecting");
  const [selectedId, setSelectedId] = useState(null);
  const [stacks, setStacks] = useState([]);
  const [imports, setImports] = useState([]);
  const [composerTab, setComposerTab] = useState("create");
  const [query, setQuery] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [pullOpen, setPullOpen] = useState(false);
  const [pullImageName, setPullImageName] = useState("nginx:latest");
  const [pulling, setPulling] = useState(false);
  const [newNetworkName, setNewNetworkName] = useState("");
  const [toasts, setToasts] = useState([]);
  const [theme, setTheme] = useState(loadTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Theme persistence is optional; rendering should still work normally.
    }
  }, [theme]);

  const addToast = useCallback((msg, type = "ok") => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((items) => [...items, { id, msg, type }]);
    setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 4000);
  }, []);

  const loadStacks = useCallback(async () => {
    try {
      setStacks(await api.getStacks());
    } catch {
      // Docker functionality remains available even if saved stacks cannot load.
    }
  }, []);

  const loadImports = useCallback(async () => {
    try {
      setImports(await api.listImports());
    } catch {
      // Non-fatal; the panel just shows the empty state.
    }
  }, []);

  useEffect(() => {
    let ws;
    let retry;
    let disposed = false;

    const connect = () => {
      ws = new WebSocket(`ws://${location.host}/events`);
      ws.onopen = () => setWsStatus("Live");
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "snapshot") {
            setNetworks(message.data.networks || []);
            setContainers(message.data.containers || []);
          }
        } catch {
          // Ignore malformed status messages; the next snapshot will repair state.
        }
      };
      ws.onclose = () => {
        if (!disposed) {
          setWsStatus("Reconnecting");
          retry = setTimeout(connect, 2000);
        }
      };
    };

    connect();
    loadStacks();
    loadImports();
    return () => {
      disposed = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, [loadStacks, loadImports]);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleContainers = useMemo(
    () => containers.filter((container) => {
      if (!normalizedQuery) return true;
      return [container.name, container.image, container.status, ...container.networks]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    }),
    [containers, normalizedQuery]
  );

  const visibleNetworkNames = useMemo(() => {
    if (!normalizedQuery) return new Set(networks.map((network) => network.name));
    const direct = networks
      .filter((network) => network.name.toLowerCase().includes(normalizedQuery))
      .map((network) => network.name);
    const attached = visibleContainers.flatMap((container) => container.networks || []);
    return new Set([...direct, ...attached]);
  }, [networks, normalizedQuery, visibleContainers]);

  const visibleNetworks = useMemo(
    () => networks.filter((network) => visibleNetworkNames.has(network.name)),
    [networks, visibleNetworkNames]
  );

  const positions = useRef(loadPositions());
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const handleNodesChange = useCallback((changes) => {
    onNodesChange(changes);
    changes.forEach((change) => {
      if (change.type === "position" && change.position) {
        positions.current[change.id] = change.position;
        savePositions(positions.current);
      }
    });
  }, [onNodesChange]);

  useEffect(() => {
    const nextNodes = [];
    visibleNetworks.forEach((network, index) => {
      const id = `net:${network.name}`;
      const position = positions.current[id] || { x: 96, y: 88 + index * 146 };
      positions.current[id] = position;
      nextNodes.push({
        id,
        type: "network",
        position,
        data: { label: network.name, driver: network.driver },
      });
    });

    visibleContainers.forEach((container, index) => {
      const id = `ct:${container.id}`;
      const position = positions.current[id] || { x: 510, y: 88 + index * 146 };
      positions.current[id] = position;
      nextNodes.push({
        id,
        type: "container",
        position,
        data: { label: container.name, image: container.image, status: container.status },
      });
    });
    setNodes(nextNodes);

    const nextEdges = [];
    visibleContainers.forEach((container) => {
      (container.networks || []).forEach((network) => {
        if (visibleNetworkNames.has(network)) {
          nextEdges.push({
            id: `e:${container.id}:${network}`,
            source: `ct:${container.id}`,
            target: `net:${network}`,
            animated: container.status === "running",
          });
        }
      });
    });
    setEdges(nextEdges);
  }, [visibleNetworks, visibleContainers, visibleNetworkNames, setNodes, setEdges]);

  const onNodeClick = useCallback((_event, node) => {
    if (node.type === "container") setSelectedId(node.id.slice(3));
  }, []);

  const onEdgesDelete = useCallback(async (deletedEdges) => {
    for (const edge of deletedEdges) {
      const containerId = edge.source.startsWith("ct:") ? edge.source.slice(3) : edge.target.slice(3);
      const network = edge.source.startsWith("net:") ? edge.source.slice(4) : edge.target.slice(4);
      try {
        await api.disconnect(containerId, network);
        addToast(`Disconnected from ${network}`, "ok");
      } catch (error) {
        addToast(error.message, "err");
      }
    }
  }, [addToast]);

  const onConnect = useCallback(async (params) => {
    const containerId = params.source.startsWith("ct:") ? params.source.slice(3) : params.target.slice(3);
    const network = params.source.startsWith("net:") ? params.source.slice(4) : params.target.slice(4);
    try {
      await api.connect(containerId, network);
      setEdges((items) => addEdge({ ...params, animated: true }, items));
      addToast(`Connected to ${network}`, "ok");
    } catch (error) {
      addToast(error.message, "err");
    }
  }, [addToast, setEdges]);

  const createNetwork = async (event) => {
    event.preventDefault();
    const name = newNetworkName.trim();
    if (!name) return;
    try {
      await api.createNetwork(name);
      setNewNetworkName("");
      addToast(`Network “${name}” created`, "ok");
    } catch (error) {
      addToast(error.message, "err");
    }
  };

  const removeNetwork = async (name) => {
    if (!confirm(`Remove network “${name}”? Connected containers will be detached.`)) return;
    try {
      await api.deleteNetwork(name);
      addToast(`Network “${name}” removed`, "ok");
    } catch (error) {
      addToast(error.message, "err");
    }
  };

  const removeContainer = async (id) => {
    if (!confirm("Remove this container?")) return;
    try {
      await api.deleteContainer(id);
      if (selectedId === id) setSelectedId(null);
      addToast("Container removed", "ok");
    } catch (error) {
      addToast(error.message, "err");
    }
  };

  const lifecycle = async (id, action) => {
    try {
      await api[action](id);
      addToast(action === "stopContainer" ? "Container stopped" : "Container started", "ok");
    } catch (error) {
      addToast(error.message, "err");
    }
  };

  const exportCompose = async () => {
    try {
      const yaml = await api.getCompose();
      const blob = new Blob([yaml], { type: "text/yaml" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "docker-compose.yml";
      anchor.click();
      URL.revokeObjectURL(url);
      addToast("Compose file downloaded", "ok");
    } catch (error) {
      addToast(error.message, "err");
    }
  };

  const pullImage = async (event) => {
    event.preventDefault();
    const image = pullImageName.trim();
    if (!image) return;
    setPulling(true);
    let output = "";
    try {
      await streamPull(image, (chunk) => { output += chunk; });
      addToast(`Image “${image}” pulled`, "ok");
      setPullOpen(false);
    } catch (error) {
      addToast(error.message, "err");
    } finally {
      setPulling(false);
      if (output.includes("# error")) addToast(output.split("\n").at(-2) || "Image pull failed", "err");
    }
  };

  const selected = useMemo(
    () => containers.find((container) => container.id === selectedId) || null,
    [containers, selectedId]
  );
  const runningCount = containers.filter((container) => container.status === "running").length;

  return (
    <div className="product-shell">
      <aside className="nav-rail" aria-label="Primary navigation">
        <div className="nav-rail__brand"><Icon name="cube" size={21} /></div>
        <div className="nav-rail__items">
          <button className="nav-item is-active" title="Workspace" aria-label="Workspace"><Icon name="layers" size={20} /></button>
          <button className="nav-item" title="Containers" aria-label="Containers" onClick={() => setComposerTab("resources")}><Icon name="package" size={20} /></button>
          <button className="nav-item" title="Networks" aria-label="Networks" onClick={() => setComposerTab("resources")}><Icon name="network" size={20} /></button>
          <button className="nav-item" title="Compose" aria-label="Compose" onClick={() => setComposeOpen(true)}><Icon name="compose" size={20} /></button>
        </div>
        <button className="nav-item nav-item--bottom" title="Settings" aria-label="Settings"><Icon name="settings" size={20} /></button>
      </aside>

      <div className="app-canvas">
        <header className="app-topbar">
          <div className="topbar-title">
            <span className="eyebrow">Local Docker</span>
            <span className="topbar-divider" />
            <strong>Workspace</strong>
          </div>
          <div className="topbar-spacer" />
          <span className={`engine-status ${wsStatus === "Live" ? "is-live" : ""}`}><i />{wsStatus}</span>
          <button className="btn btn-ghost" onClick={() => setComposeOpen(true)}><Icon name="upload" size={16} /> Import</button>
          <button className="btn btn-ghost" onClick={exportCompose}><Icon name="download" size={16} /> Export</button>
          <button className="btn btn-ghost" onClick={() => setPullOpen(true)}><Icon name="package" size={16} /> Pull image</button>
        </header>

        <div className="workspace-shell">
          <aside className="control-drawer">
            <div className="drawer-heading">
              <div><span className="eyebrow">Build</span><h1>Compose your stack</h1></div>
            </div>
            <div className="drawer-tabs" role="tablist">
              <button className={composerTab === "create" ? "is-active" : ""} onClick={() => setComposerTab("create")}><Icon name="plus" size={15} /> Create</button>
              <button className={composerTab === "resources" ? "is-active" : ""} onClick={() => setComposerTab("resources")}><Icon name="layers" size={15} /> Resources</button>
            </div>

            <div className="drawer-scroll">
              {composerTab === "create" ? (
                <CreateContainerForm networks={networks} addToast={addToast} onCreated={() => setComposerTab("resources")} />
              ) : (
                <div className="resource-drawer">
                  <section className="sidebar-section">
                    <div className="section-heading"><span>Networks</span><span className="section-count">{networks.length}</span></div>
                    <form className="inline-create" onSubmit={createNetwork}>
                      <input value={newNetworkName} onChange={(e) => setNewNetworkName(e.target.value)} placeholder="network name" aria-label="Network name" />
                      <button className="icon-button icon-button--accent" type="submit" title="Create network" aria-label="Create network"><Icon name="plus" size={17} /></button>
                    </form>
                    {networks.length ? (
                      <div className="resource-list">
                        {networks.map((network) => (
                          <div key={network.name} className="resource-item">
                            <div className="resource-item__identity"><span className="resource-symbol network-symbol"><Icon name="network" size={15} /></span><div><strong>{network.name}</strong><small>{network.driver}</small></div></div>
                            <button className="row-icon-button is-danger" onClick={() => removeNetwork(network.name)} title="Remove network"><Icon name="trash" size={15} /></button>
                          </div>
                        ))}
                      </div>
                    ) : <p className="section-empty">No managed networks yet.</p>}
                  </section>

                  <StacksPanel stacks={stacks} refresh={loadStacks} addToast={addToast} />
                  <ImportsPanel imports={imports} refresh={loadImports} addToast={addToast} />

                  <section className="sidebar-section">
                    <div className="section-heading"><span>Containers</span><span className="section-count">{containers.length}</span></div>
                    {containers.length ? (
                      <div className="resource-list">
                        {containers.map((container) => (
                          <button key={container.id} className={`resource-item resource-item--button ${selectedId === container.id ? "is-selected" : ""}`} onClick={() => setSelectedId(container.id)}>
                            <span className="resource-item__identity"><span className="resource-symbol container-symbol"><Icon name="cube" size={15} /></span><span><strong>{container.name}</strong><small className={container.status === "running" ? "is-running-text" : ""}>{container.status}</small></span></span>
                            <Icon name="chevron" size={15} />
                          </button>
                        ))}
                      </div>
                    ) : <p className="section-empty">No managed containers yet.</p>}
                  </section>
                </div>
              )}
            </div>
          </aside>

          <main className="topology-workspace">
            <header className="workspace-header">
              <div>
                <span className="eyebrow">Topology</span>
                <h2>Container topology</h2>
                <p>Map connections across your local Docker networks.</p>
              </div>
              <div className="workspace-header__actions">
                <div className="summary-strip">
                  <div><strong>{runningCount}</strong><span>running</span></div>
                  <div><strong>{containers.length}</strong><span>containers</span></div>
                  <div><strong>{networks.length}</strong><span>networks</span></div>
                </div>
                <button className="btn btn-primary" onClick={() => setComposerTab("create")}><Icon name="plus" size={17} /> New container</button>
              </div>
            </header>

            <div className="canvas-toolbar">
              <label className="search-field"><Icon name="search" size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter containers and networks" /></label>
              <span className="canvas-toolbar__tip"><Icon name="link" size={15} /> Drag between nodes to connect</span>
            </div>

            <section className="topology-stage">
              {nodes.length ? (
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  onNodesChange={handleNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  onNodeClick={onNodeClick}
                  onEdgesDelete={onEdgesDelete}
                  nodeTypes={nodeTypes}
                  fitView
                  deleteKeyCode={["Backspace", "Delete"]}
                  minZoom={0.35}
                >
                  <Background color="rgba(154, 170, 189, 0.14)" gap={24} size={1} />
                  <MiniMap pannable zoomable nodeColor={(node) => node.type === "network" ? "#cd8d3f" : "#4e8c79"} />
                  <Controls showInteractive={false} />
                </ReactFlow>
              ) : (
                <EmptyTopology onCreate={() => setComposerTab("create")} onImport={() => setComposeOpen(true)} />
              )}
              {nodes.length > 0 && <div className="stage-hint"><Icon name="link" size={14} /> Select an edge and press Delete to disconnect it.</div>}
            </section>
          </main>

          {selected && <ContainerDetail container={selected} onClose={() => setSelectedId(null)} addToast={addToast} />}
        </div>
      </div>

      {composeOpen && <ComposeImport onClose={() => setComposeOpen(false)} addToast={addToast} onImported={loadImports} />}
      {pullOpen && <PullImageModal image={pullImageName} setImage={setPullImageName} onSubmit={pullImage} loading={pulling} onClose={() => setPullOpen(false)} />}
      <Toasts toasts={toasts} />
    </div>
  );
}

function EmptyTopology({ onCreate, onImport }) {
  return (
    <div className="empty-topology">
      <div className="empty-topology__mark"><Icon name="layers" size={30} /></div>
      <h3>Your topology is empty</h3>
      <p>Launch a container or import a compose file to start mapping your local environment.</p>
      <div><button className="btn btn-primary" onClick={onCreate}><Icon name="plus" size={17} /> Create container</button><button className="btn btn-ghost" onClick={onImport}><Icon name="upload" size={16} /> Import compose</button></div>
    </div>
  );
}

function PullImageModal({ image, setImage, onSubmit, loading, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="dialog" onClick={(e) => e.stopPropagation()} onSubmit={onSubmit}>
        <div className="dialog__header"><div><span className="eyebrow">Registry</span><h2>Pull an image</h2></div><button type="button" className="icon-button" onClick={onClose}><Icon name="close" size={18} /></button></div>
        <label className="field"><span>Image reference</span><input autoFocus value={image} onChange={(e) => setImage(e.target.value)} placeholder="nginx:latest" /></label>
        <p className="dialog__hint">The image will be downloaded from the configured Docker registry.</p>
        <div className="dialog__actions"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={loading}><Icon name="download" size={16} /> {loading ? "Pulling image…" : "Pull image"}</button></div>
      </form>
    </div>
  );
}
