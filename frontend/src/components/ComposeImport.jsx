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
  const [result, setResult] = useState(null);     // last successful import result
  const [errorMsg, setErrorMsg] = useState(null);
  const stopRef = useRef(false);

  // Let the worker finish in the background even if the dialog closes.
  useEffect(() => () => { stopRef.current = true; }, []);

  const doImport = async () => {
    setBusy(true);
    setProgress({ current: 0, total: 0, message: "Queueing\u2026" });
    setResult(null);
    setErrorMsg(null);
    stopRef.current = false;
    try {
      const { job_id } = await api.importCompose(yaml, name.trim() || undefined);
      const r = await pollJob(job_id, stopRef, setProgress);
      const errors = r.errors || [];
      setResult(r);
      if (errors.length) {
        setErrorMsg(errors.join("; "));
        addToast(`Imported with errors: ${errors.join("; ")}`, "err");
      } else {
        addToast(`Imported "${r.import_name || "stack"}"`, "ok");
      }
      onImported?.();
    } catch (error) {
      setErrorMsg(error.message);
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

        {result && (
          <div className={`import-result ${errorMsg ? "is-error" : ""}`}>
            <h3>
              {errorMsg ? "Imported with errors" : "Imported"}
              {result.import_name && <span className="import-result__name"> — {result.import_name}</span>}
            </h3>
            {result.containers?.length > 0 && (
              <p>
                <strong>Containers ({result.containers.length}):</strong>{" "}
                {result.containers.map((c) => c.name).join(", ")}
              </p>
            )}
            {result.networks?.length > 0 && (
              <p>
                <strong>Networks ({result.networks.length}):</strong>{" "}
                {result.networks.map((n) => n.name).join(", ")}
              </p>
            )}
            {errorMsg && <p className="import-result__err">{errorMsg}</p>}
          </div>
        )}
        <div className="compose-dialog__actions">
          <span className="dialog__hint">
            {busy
              ? "You can close this dialog; the import will keep running in the background."
              : result
              ? "Done. You can dismiss this dialog or import another file."
              : "Services and managed networks will be created locally."}
          </span>
          <div>
            <button type="button" className="btn btn-ghost" onClick={handleClose}>{busy ? "Hide" : "Close"}</button>
            {!busy && !result && (
              <button className="btn btn-primary" onClick={doImport} disabled={!yaml.trim()}>
                <Icon name="upload" size={16} />
                Import stack
              </button>
            )}
            {!busy && result && (
              <button className="btn btn-primary" onClick={() => { setResult(null); setErrorMsg(null); }}>
                <Icon name="upload" size={16} />
                Import another
              </button>
            )}
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
