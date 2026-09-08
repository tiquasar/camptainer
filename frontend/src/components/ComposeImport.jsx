import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import Icon from "./Icon.jsx";

const STARTER = `services:
  web:
    image: nginx:latest
    ports:
      - "8080:80"
    networks:
      - app
networks:
  app:
    driver: bridge
`;

const POLL_MS = 500;

export default function ComposeImport({ onClose, addToast, onImported }) {
  const [yaml, setYaml] = useState(STARTER);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // {current, total, message}
  const stopRef = useRef(false);

  // Let the worker finish in the background even if the dialog closes.
  useEffect(() => () => { stopRef.current = true; }, []);

  const doImport = async () => {
    setBusy(true);
    setProgress({ current: 0, total: 0, message: "Queueing\u2026" });
    stopRef.current = false;
    try {
      const { job_id } = await api.importCompose(yaml, name.trim() || undefined);
      const result = await pollJob(job_id, stopRef, setProgress);
      const errors = result.errors ? result.errors.join("; ") : "";
      if (errors) {
        addToast(`Imported with errors: ${errors}`, "err");
      } else {
        addToast(`Imported “${result.import_name || "stack"}”`, "ok");
      }
      onImported?.();
      if (!errors) onClose();
    } catch (error) {
      addToast(error.message, "err");
    } finally {
      setBusy(false);
    }
  };

  const handleClose = () => {
    if (busy) stopRef.current = true; // detach polling; import keeps running
    onClose();
  };

  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.current / progress.total) * 100))
      : busy
      ? 5
      : 0;

  return (
    <div className="modal-backdrop" onClick={handleClose}>
      <section className="compose-dialog" role="dialog" aria-modal="true" aria-labelledby="compose-dialog-title" onClick={(event) => event.stopPropagation()}>
        <header className="compose-dialog__header">
          <div>
            <span className="eyebrow">Compose</span>
            <h2 id="compose-dialog-title">Import a compose file</h2>
          </div>
          <button className="icon-button" onClick={handleClose} aria-label="Close import dialog"><Icon name="close" size={18} /></button>
        </header>
        <div className="field-row">
          <label className="field field--grow">
            <span>Stack name (optional)</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="auto-generated from timestamp"
              disabled={busy}
            />
          </label>
        </div>
        <label className="field">
          <span>docker-compose.yml</span>
          <textarea
            value={yaml}
            onChange={(event) => setYaml(event.target.value)}
            spellCheck={false}
            aria-label="Compose YAML"
            disabled={busy}
          />
        </label>
        {busy && (
          <div className="import-progress" aria-live="polite">
            <div className="import-progress__bar"><div className="import-progress__fill" style={{ width: `${pct}%` }} /></div>
            <div className="import-progress__text">
              <strong>{progress?.message || "Working\u2026"}</strong>
              {progress?.total > 0 && (
                <span> &middot; {progress.current}/{progress.total}</span>
              )}
            </div>
          </div>
        )}
        <div className="compose-dialog__actions">
          <span className="dialog__hint">
            {busy
              ? "You can close this dialog; the import will keep running in the background."
              : "Services and managed networks will be created locally."}
          </span>
          <div>
            <button type="button" className="btn btn-ghost" onClick={handleClose}>{busy ? "Hide" : "Cancel"}</button>
            <button className="btn btn-primary" onClick={doImport} disabled={busy || !yaml.trim()}>
              <Icon name="upload" size={16} />
              {busy ? "Importing\u2026" : "Import stack"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function pollJob(jobId, stopRef, onUpdate) {
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (stopRef.current) {
        // Caller walked away; stop polling but don't reject.
        resolve({ errors: ["Dialog closed before import finished"] });
        return;
      }
      try {
        const status = await api.getImportStatus(jobId);
        onUpdate?.(status.progress);
        if (status.status === "done") {
          resolve(status.result || {});
        } else if (status.status === "failed") {
          reject(new Error(status.error || "Import failed"));
        } else {
          setTimeout(tick, POLL_MS);
        }
      } catch (err) {
        reject(err);
      }
    };
    tick();
  });
}
