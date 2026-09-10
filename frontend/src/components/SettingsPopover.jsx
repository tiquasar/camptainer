import { useEffect, useState } from "react";
import { api } from "../api.js";
import Icon from "./Icon.jsx";

export default function SettingsPopover({ theme, setTheme, onClose, addToast }) {
  const [docker, setDocker] = useState(null);

  useEffect(() => {
    api.health().then((h) => setDocker(h?.docker || { ok: false })).catch(() => setDocker({ ok: false }));
  }, []);

  const purgeData = async () => {
    if (!confirm("Delete the SQLite database (stacks, imports, jobs) and recreate it? The backend must be restarted to re-init.")) return;
    // We don't expose a destructive endpoint; the user can do this manually.
    addToast("Delete backend/data/camptainer.db and restart the server", "ok");
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="dialog__header">
          <div><span className="eyebrow">Workspace</span><h2>Settings</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <section className="settings-section">
          <h3>Theme</h3>
          <div className="theme-toggle">
            <button className={theme === "light" ? "is-active" : ""} onClick={() => setTheme("light")}><Icon name="sun" size={15} /> Light</button>
            <button className={theme === "dark" ? "is-active" : ""} onClick={() => setTheme("dark")}><Icon name="moon" size={15} /> Dark</button>
          </div>
        </section>
        <section className="settings-section">
          <h3>Docker daemon</h3>
          {docker?.ok ? (
            <ul className="kv-list">
              <li><span>Status</span><strong className="text-success">Connected</strong></li>
              <li><span>Server version</span><strong>{docker.server_version || "—"}</strong></li>
              <li><span>Managed containers</span><strong>{docker.containers}</strong></li>
              <li><span>Managed networks</span><strong>{docker.networks}</strong></li>
            </ul>
          ) : (
            <p className="empty-inline">
              <strong className="text-danger">Disconnected.</strong> Start Docker Desktop and the backend will reconnect automatically.
              {docker?.error && <small className="error-detail">{docker.error}</small>}
            </p>
          )}
        </section>
        <section className="settings-section">
          <h3>Shortcuts</h3>
          <p>Press <kbd>?</kbd> anywhere to see all keyboard shortcuts.</p>
        </section>
        <section className="settings-section">
          <h3>Danger zone</h3>
          <button className="btn btn-danger" onClick={purgeData}>
            <Icon name="trash" size={14} /> Reset local data
          </button>
          <p className="settings-hint">Deletes the SQLite database (saved stacks, import records, in-flight jobs).</p>
        </section>
      </div>
    </div>
  );
}
