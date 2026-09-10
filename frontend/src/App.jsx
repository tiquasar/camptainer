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
import NetworkDetail from "./components/NetworkDetail.jsx";
import StacksPanel from "./components/StacksPanel.jsx";
import ImportsPanel from "./components/ImportsPanel.jsx";
import ImagesPanel from "./components/ImagesPanel.jsx";
import VolumesPanel from "./components/VolumesPanel.jsx";
import ComposeImport from "./components/ComposeImport.jsx";
import ShellPanel from "./components/ShellPanel.jsx";
import Toasts from "./components/Toasts.jsx";
import SettingsPopover from "./components/SettingsPopover.jsx";
import Icon from "./components/Icon.jsx";

const nodeTypes = { container: ContainerNode, network: NetworkNode };
const POS_KEY = "camptainer:positions";
const THEME_KEY = "camptainer:theme";
const POS_DEBOUNCE_MS = 200;

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

let _saveTimer = null;
function savePositionsDebounced(positions) {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(positions));
    } catch {
      /* ignore */
    }
  }, POS_DEBOUNCE_MS);
}

export default function App() {
  const [networks, setNetworks] = useState([]);
  const [containers, setContainers] = useState([]);
  const [wsStatus, setWsStatus] = useState("Connecting");
  const [selectedContainerId, setSelectedContainerId] = useState(null);
  const [selectedNetworkName, setSelectedNetworkName] = useState(null);
  const [shellContainerId, setShellContainerId] = useState(null);
  const [stacks, setStacks] = useState([]);
  const [imports, setImports] = useState([]);
  const [activeJobs, setActiveJobs] = useState([]);
  const [sidebarTab, setSidebarTab] = useState("create");
  const [query, setQuery] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [pullOpen, setPullOpen] = useState(false);
  const [pullImageName, setPullImageName] = useState("nginx:latest");
  const [pulling, setPulling] = useState(false);
  const [newNetworkName, setNewNetworkName] = useState("");
  const [toasts, setToasts] = useState([]);
  const [theme, setTheme] = useState(loadTheme);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const bumpRefresh = () => setRefreshTick((n) => n + 1);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const addToast = useCallback((msg, type = "ok") => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((items) => [...items, { id, msg, type }]);
    setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 5000);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((items) => items.filter((item) => item.id !== id));
  }, []);

  const loadStacks = useCallback(async () => {
    try {
      setStacks(await api.getStacks());
    } catch {
      /* non-fatal */
    }
  }, []);

  const loadImports = useCallback(async () => {
    try {
      setImports(await api.listImports());
    } catch {
      /* non-fatal */
    }
  }, []);

  const loadActiveJobs = useCallback(async () => {
    try {
      setActiveJobs(await api.activeImports());
    } catch {
      /* non-fatal */
    }
  }, []);

  // WebSocket
  useEffect(() => {
    let ws;
    let retryTimer = null;
    let backoff = 1000;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      ws = new WebSocket(`ws://${location.host}/events`);
      ws.onopen = () => {
        setWsStatus("Live");
        backoff = 1000;
      };
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "snapshot") {
            setNetworks(message.data.networks || []);
            setContainers(message.data.containers || []);
          }
        } catch {
          /* ignore malformed */
        }
      };
      ws.onclose = () => {
        if (disposed) return;
        setWsStatus("Reconnecting");
        retryTimer = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 15000);
      };
    };

    connect();
    loadStacks();
    loadImports();
    loadActiveJobs();
    const jobPoll = setInterval(loadActiveJobs, 2000);

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      clearInterval(jobPoll);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, [loadStacks, loadImports, loadActiveJobs]);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleContainers = useMemo(
    () => containers.filter((c) => {
      if (!normalizedQuery) return true;
      return [c.name, c.image, c.status, ...(c.networks || [])]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    }),
    [containers, normalizedQuery]
  );

  const visibleNetworkNames = useMemo(() => {
    if (!normalizedQuery) return new Set(networks.map((n) => n.name));
    const direct = networks
      .filter((n) => n.name.toLowerCase().includes(normalizedQuery))
      .map((n) => n.name);
    const attached = visibleContainers.flatMap((c) => c.networks || []);
    return new Set([...direct, ...attached]);
  }, [networks, normalizedQuery, visibleContainers]);

  const visibleNetworks = useMemo(
    () => networks.filter((n) => visibleNetworkNames.has(n.name)),
    [networks, visibleNetworkNames]
  );

  const positions = useRef(loadPositions());
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const handleNodesChange = useCallback((changes) => {
    onNodesChange(changes);
    let dirty = false;
    changes.forEach((change) => {
      if (change.type === "position" && change.position) {
        positions.current[change.id] = change.position;
        dirty = true;
      }
    });
    if (dirty) savePositionsDebounced(positions.current);
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
        data: { label: network.name, driver: network.driver, containerCount: (network.containers || []).length },
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
    if (node.type === "container") setSelectedContainerId(node.id.slice(3));
    else if (node.type === "network") setSelectedNetworkName(node.data.label);
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
    // Optimistic add so the user gets instant feedback; the next snapshot
    // (≤ 3s, or immediate via broadcast_change) will reconcile.
    setEdges((items) => addEdge({ ...params, animated: true }, items));
    try {
      await api.connect(containerId, network);
      addToast(`Connected to ${network}`, "ok");
    } catch (error) {
      setEdges((items) => items.filter((e) => e.id !== params.id));
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
      addToast(`Network "${name}" created`, "ok");
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
      addToast(`Image "${image}" pulled`, "ok");
      setPullOpen(false);
      bumpRefresh();
    } catch (error) {
      addToast(error.message, "err");
    } finally {
      setPulling(false);
      if (output.includes("# error")) addToast(output.split("\n").at(-2) || "Image pull failed", "err");
    }
  };

  const selectedContainer = useMemo(
    () => containers.find((c) => c.id === selectedContainerId) || null,
    [containers, selectedContainerId]
  );
  // Fetch the full container (with env/volumes/labels) when selected.
  const [containerFull, setContainerFull] = useState(null);
  useEffect(() => {
    if (!selectedContainerId) {
      setContainerFull(null);
      return;
    }
    let alive = true;
    api.container(selectedContainerId)
      .then((c) => { if (alive) setContainerFull(c); })
      .catch(() => { if (alive) setContainerFull(null); });
    return () => { alive = false; };
  }, [selectedContainerId, refreshTick]);

  const selectedNetwork = useMemo(
    () => networks.find((n) => n.name === selectedNetworkName) || null,
    [networks, selectedNetworkName]
  );

  const runningCount = containers.filter((c) => c.status === "running").length;
  const activeJobCount = activeJobs.length;

  // --- keyboard shortcuts ---
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.metaKey || e.ctrlKey) {
        if (e.key === "i" || e.key === "I") { e.preventDefault(); setComposeOpen(true); }
        else if (e.key === "e" || e.key === "E") { e.preventDefault(); exportCompose(); }
        else if (e.key === "k" || e.key === "K") { e.preventDefault(); setSettingsOpen((s) => !s); }
        return;
      }
      if (e.key === "/") { e.preventDefault(); document.getElementById("camptainer-search")?.focus(); }
      else if (e.key === "?") { e.preventDefault(); setHelpOpen(true); }
      else if (e.key === "Escape") {
        setSettingsOpen(false);
        setHelpOpen(false);
        setComposeOpen(false);
        setPullOpen(false);
        setSelectedContainerId(null);
        setSelectedNetworkName(null);
        setShellContainerId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exportCompose]);

  return (
    <div className="product-shell">
      <aside className="nav-rail" aria-label="Primary navigation">
        <div className="nav-rail__brand" title="Camptainer"><Icon name="cube" size={21} /></div>
        <div className="nav-rail__items">
          <button className="nav-item is-active" title="Workspace" aria-label="Workspace" onClick={() => setSidebarTab("create")}><Icon name="layers" size={20} /></button>
          <button className="nav-item" title="Resources" aria-label="Resources" onClick={() => setSidebarTab("resources")}>
            <Icon name="package" size={20} />
            {activeJobCount > 0 && <span className="nav-badge" title={`${activeJobCount} import${activeJobCount === 1 ? "" : "s"} running`}>{activeJobCount}</span>}
          </button>
          <button className="nav-item" title="Import compose" aria-label="Import compose" onClick={() => setComposeOpen(true)}><Icon name="compose" size={20} /></button>
          <button className="nav-item" title="Pull image" aria-label="Pull image" onClick={() => setPullOpen(true)}><Icon name="download" size={20} /></button>
        </div>
        <button className="nav-item nav-item--bottom" title="Settings (Ctrl+K)" aria-label="Settings" onClick={() => setSettingsOpen((s) => !s)}>
          <Icon name="settings" size={20} />
        </button>
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
          {activeJobCount > 0 && (
            <span className="engine-status is-live" title="Imports in progress">
              <i />{activeJobCount} importing
            </span>
          )}
          <button className="btn btn-ghost" onClick={() => setComposeOpen(true)} title="Ctrl+I"><Icon name="upload" size={16} /> Import</button>
          <button className="btn btn-ghost" onClick={exportCompose} title="Ctrl+E"><Icon name="download" size={16} /> Export</button>
          <button className="btn btn-ghost" onClick={() => setPullOpen(true)}><Icon name="package" size={16} /> Pull image</button>
        </header>

        <div className="workspace-shell">
          <aside className="control-drawer">
            <div className="drawer-heading">
              <div><span className="eyebrow">Build</span><h1>Compose your stack</h1></div>
            </div>
            <div className="drawer-tabs" role="tablist">
              <button className={sidebarTab === "create" ? "is-active" : ""} onClick={() => setSidebarTab("create")}><Icon name="plus" size={15} /> Create</button>
              <button className={sidebarTab === "resources" ? "is-active" : ""} onClick={() => setSidebarTab("resources")}><Icon name="layers" size={15} /> Resources</button>
            </div>

            <div className="drawer-scroll">
              {sidebarTab === "create" ? (
                <CreateContainerForm networks={networks} addToast={addToast} onCreated={() => setSidebarTab("resources")} onImported={bumpRefresh} />
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
                            <button className="row-icon-button is-danger" onClick={() => setSelectedNetworkName(network.name)} title="View network"><Icon name="network" size={15} /></button>
                          </div>
                        ))}
                      </div>
                    ) : <p className="section-empty">No managed networks yet.</p>}
                  </section>

                  <StacksPanel stacks={stacks} refresh={loadStacks} addToast={addToast} />
                  <ImportsPanel imports={imports} refresh={loadImports} addToast={addToast} />
                  <ImagesPanel refreshTick={refreshTick} addToast={addToast} />
                  <VolumesPanel refreshTick={refreshTick} addToast={addToast} />

                  <section className="sidebar-section">
                    <div className="section-heading"><span>Containers</span><span className="section-count">{containers.length}</span></div>
                    {containers.length ? (
                      <div className="resource-list">
                        {containers.map((container) => (
                          <button key={container.id} className={`resource-item resource-item--button ${selectedContainerId === container.id ? "is-selected" : ""}`} onClick={() => setSelectedContainerId(container.id)}>
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
                <button className="btn btn-primary" onClick={() => setSidebarTab("create")}><Icon name="plus" size={17} /> New container</button>
              </div>
            </header>

            <div className="canvas-toolbar">
              <label className="search-field">
                <Icon name="search" size={16} />
                <input
                  id="camptainer-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setSearchFocused(false)}
                  placeholder="Filter containers and networks  (press / to focus)"
                />
                {searchFocused && query && (
                  <button type="button" className="search-clear" onClick={() => setQuery("")} aria-label="Clear search">
                    <Icon name="close" size={12} />
                  </button>
                )}
              </label>
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
                <EmptyTopology onCreate={() => setSidebarTab("create")} onImport={() => setComposeOpen(true)} />
              )}
              {nodes.length > 0 && <div className="stage-hint"><Icon name="link" size={14} /> Click a container to inspect it, or a network to manage it. Press <kbd>?</kbd> for shortcuts.</div>}
            </section>
          </main>

          {containerFull && !shellContainerId && (
            <ContainerDetail
              container={containerFull}
              onClose={() => setSelectedContainerId(null)}
              onShell={() => setShellContainerId(containerFull.id)}
              onUpdated={bumpRefresh}
              addToast={addToast}
            />
          )}
          {shellContainerId && (
            <ShellPanel
              container={containers.find((c) => c.id === shellContainerId) || containerFull || { id: shellContainerId, name: "container" }}
              onClose={() => setShellContainerId(null)}
              addToast={addToast}
            />
          )}
        </div>
      </div>

      {selectedNetwork && <NetworkDetail network={selectedNetwork} onClose={() => setSelectedNetworkName(null)} addToast={addToast} />}
      {composeOpen && <ComposeImport onClose={() => setComposeOpen(false)} addToast={addToast} onImported={() => { loadImports(); bumpRefresh(); }} />}
      {pullOpen && <PullImageModal image={pullImageName} setImage={setPullImageName} onSubmit={pullImage} loading={pulling} onClose={() => setPullOpen(false)} />}
      {settingsOpen && <SettingsPopover theme={theme} setTheme={setTheme} onClose={() => setSettingsOpen(false)} addToast={addToast} />}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
      <Toasts toasts={toasts} onDismiss={dismissToast} />
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

function HelpModal({ onClose }) {
  const shortcuts = [
    { keys: ["Ctrl", "I"], action: "Open import dialog" },
    { keys: ["Ctrl", "E"], action: "Export current setup as compose" },
    { keys: ["Ctrl", "K"], action: "Toggle settings" },
    { keys: ["/"], action: "Focus the search field" },
    { keys: ["?"], action: "Show this help" },
    { keys: ["Esc"], action: "Close any open panel" },
    { keys: ["Delete"], action: "Disconnect the selected edge" },
  ];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="dialog__header">
          <div><span className="eyebrow">Reference</span><h2>Keyboard shortcuts</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <ul className="shortcut-list">
          {shortcuts.map((s) => (
            <li key={s.action}>
              <span className="shortcut-keys">
                {s.keys.map((k, i) => <kbd key={i}>{k}</kbd>).reduce((acc, el, i) => i === 0 ? [el] : [...acc, <span key={`plus-${i}`}>+</span>, el], [])}
              </span>
              <span className="shortcut-action">{s.action}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
