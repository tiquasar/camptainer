import { useEffect, useRef, useState } from "react";
import { api, streamLogs } from "../api.js";
import Icon from "./Icon.jsx";
import ConfirmModal from "./ConfirmModal.jsx";

const TABS = [
  { id: "overview", label: "Overview", icon: "cube" },
  { id: "logs", label: "Logs", icon: "logs" },
  { id: "stats", label: "Metrics", icon: "activity" },
  { id: "config", label: "Config", icon: "settings" },
];

const MAX_LOG_LINES = 2000;
const MAX_STATS_POINTS = 60;

export default function ContainerDetail({ container, onClose, onShell, onUpdated, addToast }) {
  const [tab, setTab] = useState("overview");
  const [logLines, setLogLines] = useState([]); // append-only ring buffer
  const [stats, setStats] = useState(null);
  const [history, setHistory] = useState([]); // {ts, cpu, mem_percent}
  const [confirm, setConfirm] = useState(null);
  const [copied, setCopied] = useState(false);
  const logRef = useRef(null);

  // Live logs (SSE-style stream).
  useEffect(() => {
    if (tab !== "logs") return;
    let cancel = false;
    let pump = null;
    setLogLines([]);
    (async () => {
      try {
        // Replay last 100 lines first.
        const initial = await api.getLogs(container.id, 100);
        if (cancel) return;
        setLogLines(initial.split("\n").filter(Boolean).slice(-MAX_LOG_LINES));
        await streamLogs(
          container.id,
          (chunk) => {
            setLogLines((prev) => {
              const next = prev.concat(chunk.split("\n").filter(Boolean));
              return next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next;
            });
          },
          { tail: 0 },
        );
      } catch (e) {
        addToast(e.message, "err");
      }
    })();
    return () => {
      cancel = true;
      // The streamLogs promise resolves when the server closes; we can't
      // cancel the underlying fetch in the browser, so the next reconnect
      // will replace the chunks. Acceptable for now.
    };
  }, [tab, container.id, addToast]);

  // Auto-scroll logs to bottom on new lines (unless user has scrolled up).
  useEffect(() => {
    if (tab !== "logs" || !logRef.current) return;
    const el = logRef.current;
    const isPinned = el.scrollHeight - el.clientHeight - el.scrollTop < 20;
    if (isPinned) el.scrollTop = el.scrollHeight;
  }, [logLines, tab]);

  // Stats polling (paused on hidden tab).
  useEffect(() => {
    if (tab !== "stats") return;
    let alive = true;
    let timer = null;
    const tick = async () => {
      if (!alive) return;
      if (document.hidden) {
        timer = setTimeout(tick, 2000);
        return;
      }
      try {
        const s = await api.getStats(container.id);
        if (alive) {
          setStats(s);
          setHistory((h) => {
            const next = h.concat([{ cpu: s.cpu_percent, mem: s.mem_percent }]);
            return next.length > MAX_STATS_POINTS ? next.slice(-MAX_STATS_POINTS) : next;
          });
        }
      } catch {
        if (alive) setStats(null);
      }
      timer = setTimeout(tick, 2000);
    };
    tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [tab, container.id]);

  const lifecycle = async (action) => {
    try {
      await api[action](container.id);
      onUpdated?.();
      addToast(`${container.name}: ${action.replace("Container", "")}`, "ok");
    } catch (e) {
      addToast(e.message, "err");
    }
  };

  const leave = async (net) => {
    try {
      await api.disconnect(container.id, net);
      onUpdated?.();
      addToast(`Disconnected from ${net}`, "ok");
    } catch (e) {
      addToast(e.message, "err");
    }
  };

  const remove = async () => {
    try {
      await api.deleteContainer(container.id);
      onUpdated?.();
      onClose();
    } catch (e) {
      addToast(e.message, "err");
    } finally {
      setConfirm(null);
    }
  };

  const recreate = async () => {
    try {
      const spec = {
        name: container.name,
        image: container.image,
        ports: (container.ports || []).map((p) => p.split(":").slice(0, 2).join(":")),
        environment: container.environment || [],
        volumes: container.volumes || [],
        networks: container.networks || [],
        command: container.command ? (Array.isArray(container.command) ? container.command.join(" ") : container.command) : null,
        restart_policy: container.restart_policy || null,
        auto_pull: false,
      };
      await api.recreate(container.id, spec);
      onUpdated?.();
      addToast("Container recreated", "ok");
    } catch (e) {
      addToast(e.message, "err");
    }
  };

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(container.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      addToast("Clipboard unavailable", "err");
    }
  };

  return (
    <aside className="inspector">
      <div className="inspector__header">
        <div className="inspector__identity">
          <div className="inspector__icon"><Icon name="cube" size={21} /></div>
          <div>
            <h2>{container.name}</h2>
            <p>
              <button className="link-button" onClick={copyId} title="Copy full ID">
                {container.id} {copied ? "✓" : <Icon name="link" size={11} />}
              </button>
            </p>
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
              <KeyValue label="Ports" value={(container.ports || []).join(", ") || "No mapped ports"} />
              <KeyValue label="Command" value={Array.isArray(container.command) ? container.command.join(" ") : container.command || "—"} />
            </section>
            <section className="inspector-section">
              <h3>Networks</h3>
              {(container.networks || []).length ? (
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
                <button className="btn btn-soft" onClick={recreate}><Icon name="restart" size={15} /> Recreate</button>
                {container.status === "running" && (
                  <button className="btn btn-soft" onClick={onShell}><Icon name="terminal" size={15} /> Shell</button>
                )}
                <button className="btn btn-danger" onClick={() => setConfirm("remove")}><Icon name="trash" size={15} /> Remove</button>
              </div>
            </section>
          </>
        )}

        {tab === "logs" && (
          <section className="console-panel">
            <div className="console-panel__bar">
              <span><i /> Live stream</span>
              <span>{logLines.length} line{logLines.length === 1 ? "" : "s"}</span>
            </div>
            <div className="console-output" ref={logRef}>
              <pre>{logLines.map((line, i) => <div key={i} className="console-line">{line}</div>)}</pre>
            </div>
          </section>
        )}

        {tab === "stats" && (
          <section className="metric-stack">
            <Metric icon="cpu" label="CPU usage" value={stats ? `${stats.cpu_percent}%` : "—"} tone="blue" sparkline={history.map((p) => p.cpu)} />
            <Metric icon="activity" label="Memory usage" value={stats ? `${stats.mem_percent}%` : "—"} tone="green" detail={stats ? `${fmt(stats.mem_usage)} / ${fmt(stats.mem_limit)}` : "Waiting for stats"} sparkline={history.map((p) => p.mem)} />
          </section>
        )}

        {tab === "config" && (
          <ConfigTab container={container} />
        )}
      </div>

      <ConfirmModal
        open={confirm === "remove"}
        title="Remove container?"
        message={<p><strong>{container.name}</strong> will be stopped and removed. Attached networks are unaffected.</p>}
        confirmLabel="Remove"
        danger
        requireText={container.name}
        onCancel={() => setConfirm(null)}
        onConfirm={remove}
      />
    </aside>
  );
}

function ConfigTab({ container }) {
  return (
    <>
      <section className="inspector-section">
        <h3>Environment</h3>
        {(container.environment || []).length ? (
          <ul className="kv-list">
            {container.environment.map((env, i) => {
              const [k, ...rest] = env.split("=");
              return (
                <li key={i}><code>{k}</code><span>{rest.join("=")}</span></li>
              );
            })}
          </ul>
        ) : <p className="empty-inline">No environment variables.</p>}
      </section>
      <section className="inspector-section">
        <h3>Volumes</h3>
        {(container.volumes || []).length ? (
          <ul className="kv-list">
            {container.volumes.map((v, i) => (
              <li key={i}><code>{v.split(":")[0]}</code><span>→ {v.split(":").slice(1).join(":") || "/"}</span></li>
            ))}
          </ul>
        ) : <p className="empty-inline">No volume mounts.</p>}
      </section>
      <section className="inspector-section">
        <h3>Labels</h3>
        {container.labels && Object.keys(container.labels).length ? (
          <ul className="kv-list">
            {Object.entries(container.labels).map(([k, v]) => (
              <li key={k}><code>{k}</code><span>{String(v)}</span></li>
            ))}
          </ul>
        ) : <p className="empty-inline">No labels.</p>}
      </section>
    </>
  );
}

function KeyValue({ label, value }) {
  return <div className="key-value"><span>{label}</span><strong>{value}</strong></div>;
}

function Metric({ icon, label, value, detail, tone, sparkline }) {
  return (
    <div className={`metric-card metric-card--${tone}`}>
      <div className="metric-card__icon"><Icon name={icon} size={19} /></div>
      <div className="metric-card__body">
        <span>{label}</span>
        <strong>{value}</strong>
        {detail && <small>{detail}</small>}
        {sparkline && sparkline.length > 1 && <Sparkline values={sparkline} />}
      </div>
    </div>
  );
}

function Sparkline({ values, width = 160, height = 28 }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const step = width / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - (v / max) * height).toFixed(1)}`)
    .join(" ");
  return (
    <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
