import { useState } from "react";
import { api } from "../api.js";
import Icon from "./Icon.jsx";

export default function ImportsPanel({ imports, refresh, addToast }) {
  const [busyId, setBusyId] = useState(null);

  const teardown = async (id) => {
    if (!confirm("Tear down this import? Its containers and networks will be removed.")) return;
    setBusyId(id);
    try {
      await api.teardownImport(id);
      addToast("Import torn down", "ok");
      await refresh();
    } catch (e) {
      addToast(e.message, "err");
    } finally {
      setBusyId(null);
    }
  };

  const forget = async (id) => {
    if (!confirm("Remove this import record? Live resources will not be touched.")) return;
    setBusyId(id);
    try {
      await api.forgetImport(id);
      await refresh();
      addToast("Import record removed", "ok");
    } catch (e) {
      addToast(e.message, "err");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="sidebar-section imports-section">
      <div className="section-heading">
        <span>Compose imports</span>
        <span className="section-count">{imports.length}</span>
      </div>
      {imports.length === 0 ? (
        <p className="section-empty">Imported stacks appear here so you can tear them down later.</p>
      ) : (
        <div className="stack-list">
          {imports.map((item) => {
            const total = item.containers.length + item.networks.length;
            const isBusy = busyId === item.id;
            return (
              <div key={item.id} className="stack-item">
                <div className="stack-item__identity">
                  <Icon name="compose" size={16} />
                  <span title={item.created_at}>{item.name}</span>
                </div>
                <div className="stack-item__meta">
                  <span>{item.containers.length} ct</span>
                  <span>{item.networks.length} net</span>
                </div>
                <div className="stack-item__actions">
                  <button
                    onClick={() => teardown(item.id)}
                    disabled={isBusy}
                    title={`Tear down ${total} resource${total === 1 ? "" : "s"}`}
                  >
                    <Icon name="stop" size={14} />
                  </button>
                  <button onClick={() => forget(item.id)} disabled={isBusy} title="Forget this record">
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
