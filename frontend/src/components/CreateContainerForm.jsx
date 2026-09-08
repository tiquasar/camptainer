import { useState } from "react";
import { api } from "../api.js";
import Icon from "./Icon.jsx";

export default function CreateContainerForm({ networks, addToast, onCreated }) {
  const [name, setName] = useState("");
  const [image, setImage] = useState("nginx:latest");
  const [ports, setPorts] = useState("8080:80");
  const [env, setEnv] = useState("");
  const [volumes, setVolumes] = useState("");
  const [restart, setRestart] = useState("unless-stopped");
  const [cpu, setCpu] = useState("");
  const [mem, setMem] = useState("");
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);

  const toggle = (net) =>
    setSelected((s) => (s.includes(net) ? s.filter((n) => n !== net) : [...s, net]));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const body = {
      name,
      image,
      ports: ports.split(",").map((s) => s.trim()).filter(Boolean),
      environment: env.split(",").map((s) => s.trim()).filter(Boolean),
      volumes: volumes.split("\n").map((s) => s.trim()).filter(Boolean),
      networks: selected,
      restart_policy: restart || null,
      cpu: cpu ? parseFloat(cpu) : null,
      mem: mem || null,
    };
    try {
      await api.createContainer(body);
      setName("");
      addToast(`Container “${body.name}” created`, "ok");
      onCreated?.();
    } catch (e2) {
      addToast(e2.message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="create-form" onSubmit={submit}>
      <div className="form-section">
        <div className="form-section__label">Container</div>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="web-api" required />
        </label>
        <label className="field">
          <span>Image</span>
          <input value={image} onChange={(e) => setImage(e.target.value)} placeholder="nginx:latest" required />
        </label>
      </div>

      <details className="advanced-form">
        <summary>Runtime configuration <Icon name="chevron" size={15} /></summary>
        <div className="advanced-form__body">
          <label className="field">
            <span>Ports <em>host:container, comma-separated</em></span>
            <input value={ports} onChange={(e) => setPorts(e.target.value)} placeholder="8080:80" />
          </label>
          <label className="field">
            <span>Environment <em>KEY=value, comma-separated</em></span>
            <input value={env} onChange={(e) => setEnv(e.target.value)} placeholder="APP_ENV=production" />
          </label>
          <label className="field">
            <span>Volumes <em>one per line</em></span>
            <textarea value={volumes} onChange={(e) => setVolumes(e.target.value)} placeholder={"C:\\data:/data:rw"} rows={2} />
          </label>
          <div className="form-grid">
            <label className="field">
              <span>Restart policy</span>
              <select value={restart} onChange={(e) => setRestart(e.target.value)}>
                <option value="">No policy</option>
                <option value="unless-stopped">Unless stopped</option>
                <option value="always">Always</option>
                <option value="on-failure">On failure</option>
              </select>
            </label>
            <label className="field">
              <span>CPU cores</span>
              <input value={cpu} onChange={(e) => setCpu(e.target.value)} placeholder="0.5" />
            </label>
            <label className="field">
              <span>Memory</span>
              <input value={mem} onChange={(e) => setMem(e.target.value)} placeholder="512m" />
            </label>
          </div>
        </div>
      </details>

      <div className="form-section network-picker">
        <div className="form-section__label">Attach to networks</div>
        {networks.length === 0 ? (
          <div className="form-empty">Create a network first, or launch without one.</div>
        ) : (
          <div className="network-chips">
            {networks.map((n) => (
              <label key={n.name} className={`network-chip ${selected.includes(n.name) ? "is-selected" : ""}`}>
                <input type="checkbox" checked={selected.includes(n.name)} onChange={() => toggle(n.name)} />
                <Icon name="network" size={14} />
                {n.name}
              </label>
            ))}
          </div>
        )}
      </div>

      <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
        <Icon name="plus" size={17} />
        {busy ? "Creating container…" : "Create container"}
      </button>
    </form>
  );
}
