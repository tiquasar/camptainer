import { useEffect, useState } from "react";
import { api } from "../api.js";
import Icon from "./Icon.jsx";
import ConfirmModal from "./ConfirmModal.jsx";

export default function VolumesPanel({ refreshTick = 0, addToast }) {
  const [volumes, setVolumes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const load = async () => {
    try {
      const data = await api.listVolumes();
      setVolumes(Array.isArray(data) ? data : []);
    } catch {
      setVolumes([]);
    }
  };

  useEffect(() => {
    load();
  }, [refreshTick]);

  const remove = async (vol) => {
    setBusy(true);
    try {
      await api.removeVolume(vol.name, true);
      addToast(`Volume ${vol.name} removed`, "ok");
      await load();
    } catch (e) {
      addToast(e.message, "err");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const prune = async () => {
    setBusy(true);
    try {
      const r = await api.pruneVolumes();
      addToast(`Pruned ${(r?.VolumesDeleted || []).length} volumes`, "ok");
      await load();
    } catch (e) {
      addToast(e.message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="sidebar-section volumes-section">
      <div className="section-heading">
        <span>Volumes</span>
        <span className="section-count">{volumes.length}</span>
      </div>
      {volumes.length === 0 ? (
        <p className="section-empty">No local volumes. Add a volume mount when creating a container.</p>
      ) : (
        <>
          <div className="image-list">
            {volumes.slice(0, 12).map((v) => (
              <div key={v.name} className="image-item" title={v.mountpoint}>
                <div className="image-item__identity">
                  <span className="image-symbol"><Icon name="package" size={14} /></span>
                  <div>
                    <strong>{v.name}</strong>
                    <small>{v.driver}</small>
                  </div>
                </div>
                <button
                  className="row-icon-button is-danger"
                  onClick={() => setConfirm({ kind: "remove", vol })}
                  disabled={busy}
                  title="Remove volume"
                >
                  <Icon name="trash" size={13} />
                </button>
              </div>
            ))}
            {volumes.length > 12 && (
              <p className="section-empty">{volumes.length - 12} more not shown.</p>
            )}
          </div>
          <button className="btn btn-soft btn-block" onClick={prune} disabled={busy}>
            <Icon name="trash" size={14} /> Prune dangling
          </button>
        </>
      )}
      <ConfirmModal
        open={!!confirm}
        title="Remove volume?"
        message={confirm?.vol ? <p>Volume <strong>{confirm.vol.name}</strong> and any data it contains will be removed.</p> : null}
        confirmLabel="Remove"
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={() => remove(confirm.vol)}
      />
    </section>
  );
}
