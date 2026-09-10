import { useState } from "react";
import { api } from "../api.js";
import Icon from "./Icon.jsx";

export default function NetworkDetail({ network, onClose, onDeleted, addToast }) {
  const [busy, setBusy] = useState(false);
  const containerCount = (network.containers || []).length;

  const remove = async () => {
    if (!confirm(`Remove network "${network.name}"? Connected containers will be detached.`)) return;
    setBusy(true);
    try {
      await api.deleteNetwork(network.name);
      addToast(`Network "${network.name}" removed`, "ok");
      onDeleted?.();
      onClose();
    } catch (e) {
      addToast(e.message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <aside className="inspector" onClick={(e) => e.stopPropagation()}>
        <div className="inspector__header">
          <div className="inspector__identity">
            <div className="inspector__icon"><Icon name="network" size={21} /></div>
            <div>
              <h2>{network.name}</h2>
              <p>{network.driver} driver &middot; {containerCount} container{containerCount === 1 ? "" : "s"}</p>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} title="Close" aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <div className="inspector__body">
          <section className="inspector-section">
            <h3>Attached containers</h3>
            {containerCount === 0 ? (
              <p className="empty-inline">No containers attached. Drag a container onto this network to connect it.</p>
            ) : (
              <div className="attached-networks">
                {network.containers.map((name) => (
                  <span key={name} className="attached-network attached-network--static">
                    <Icon name="cube" size={13} /> {name}
                  </span>
                ))}
              </div>
            )}
          </section>
          <section className="inspector-section">
            <h3>Actions</h3>
            <div className="action-grid">
              <button className="btn btn-danger" onClick={remove} disabled={busy}>
                <Icon name="trash" size={15} /> Remove network
              </button>
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
