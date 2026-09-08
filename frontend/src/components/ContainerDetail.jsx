import { useEffect, useState } from "react";
import { api } from "../api.js";
import Icon from "./Icon.jsx";

const TABS = [
  { id: "overview", label: "Overview", icon: "cube" },
  { id: "logs", label: "Logs", icon: "logs" },
  { id: "stats", label: "Metrics", icon: "activity" },
];

export default function ContainerDetail({ container, onClose, addToast }) {
  const [tab, setTab] = useState("overview");
  const [logs, setLogs] = useState("");
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (tab !== "logs") return;
    let alive = true;
    const load = async () => {
      try {
        if (alive) setLogs(await api.getLogs(container.id));
      } catch {
        if (alive) setLogs("Unable to retrieve logs.");
      }
    };
    load();
    const timer = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [tab, container.id]);

  useEffect(() => {
    if (tab !== "stats") return;
    let alive = true;
    const load = async () => {
      try {
        if (alive) setStats(await api.getStats(container.id));
      } catch {
        if (alive) setStats(null);
      }
    };
    load();
    const timer = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [tab, container.id]);

  const lifecycle = async (action) => {
    try {
      await api[action](container.id);
      addToast(`${container.name}: ${action.replace("Container", "")}`, "ok");
    } catch (e) {
      addToast(e.message, "err");
    }
  };

  const leave = async (net) => {
    try {
      await api.disconnect(container.id, net);
      addToast(`Disconnected from ${net}`, "ok");
    } catch (e) {
      addToast(e.message, "err");
    }
  };

  const remove = async () => {
    if (!confirm(`Remove ${container.name}?`)) return;
    try {
      await api.deleteContainer(container.id);
      onClose();
    } catch (e) {
      addToast(e.message, "err");
    }
  };

  return (
    <aside className="inspector">
      <div className="inspector__header">
        <div className="inspector__identity">
          <div className="inspector__icon"><Icon name="cube" size={21} /></div>
          <div>
            <h2>{container.name}</h2>
            <p>{container.id}</p>
          </div>
        </div>
        <button className="icon-button" onClick={onClose} title="Close inspector" aria-label="Close inspector">
          <Icon name="close" size={18} />
        </button>
      </div>

      <div className="inspector__status-row">
        <span className={`status-chip ${container.status === "running" ? "is-running" : "is-stopped"}`}>
          <i /> {container.status}
        </span>
        <span className="inspector__image">{container.image}</span>
      </div>

      <nav className="inspector__tabs" aria-label="Container inspector tabs">
        {TABS.map((item) => (
          <button key={item.id} className={tab === item.id ? "is-active" : ""} onClick={() => setTab(item.id)}>
            <Icon name={item.icon} size={15} /> {item.label}
          </button>
        ))}
      </nav>

      <div className="inspector__body">
        {tab === "overview" && (
          <>
            <section className="inspector-section">
              <h3>Configuration</h3>
              <KeyValue label="Image" value={container.image} />
              <KeyValue label="Ports" value={container.ports.join(", ") || "No mapped ports"} />
            </section>
            <section className="inspector-section">
              <h3>Networks</h3>
              {container.networks.length ? (
                <div className="attached-networks">
                  {container.networks.map((net) => (
                    <button key={net} className="attached-network" onClick={() => leave(net)} title="Disconnect network">
                      <Icon name="network" size={14} />
                      {net}
                      <Icon name="close" size={13} />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="empty-inline">No network attached</p>
              )}
            </section>
            <section className="inspector-section">
              <h3>Actions</h3>
              <div className="action-grid">
                {container.status === "running" ? (
                  <button className="btn btn-soft" onClick={() => lifecycle("stopContainer")}><Icon name="stop" size={15} /> Stop</button>
                ) : (
                  <button className="btn btn-soft" onClick={() => lifecycle("startContainer")}><Icon name="play" size={15} /> Start</button>
                )}
                <button className="btn btn-soft" onClick={() => lifecycle("restartContainer")}><Icon name="restart" size={15} /> Restart</button>
                <button className="btn btn-danger" onClick={remove}><Icon name="trash" size={15} /> Remove</button>
              </div>
            </section>
          </>
        )}

        {tab === "logs" && (
          <section className="console-panel">
            <div className="console-panel__bar"><span><i /> Live stream</span><span>refreshes every 3s</span></div>
            <pre>{logs || "No log output has been emitted."}</pre>
          </section>
        )}

        {tab === "stats" && (
          <section className="metric-stack">
            <Metric icon="cpu" label="CPU usage" value={stats ? `${stats.cpu_percent}%` : "—"} tone="blue" />
            <Metric icon="activity" label="Memory usage" value={stats ? `${stats.mem_percent}%` : "—"} tone="green" detail={stats ? `${fmt(stats.mem_usage)} / ${fmt(stats.mem_limit)}` : "Waiting for stats"} />
          </section>
        )}
      </div>
    </aside>
  );
}

function KeyValue({ label, value }) {
  return <div className="key-value"><span>{label}</span><strong>{value}</strong></div>;
}

function Metric({ icon, label, value, detail, tone }) {
  return (
    <div className={`metric-card metric-card--${tone}`}>
      <div className="metric-card__icon"><Icon name={icon} size={19} /></div>
      <div><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>
    </div>
  );
}

function fmt(n) {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(1)} ${units[i]}`;
}
