import { useState } from "react";
import { api } from "../api.js";
import Icon from "./Icon.jsx";
import ConfirmModal from "./ConfirmModal.jsx";

export default function ImportsPanel({ imports, refresh, addToast }) {
  const [busyId, setBusyId] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const doTeardown = async (item) => {
    setBusyId(item.id);
    try {
      const r = await api.teardownImport(item.id);
      const errs = (r.errors || []).join("; ");
      addToast(errs ? `Torn down with errors: ${errs}` : "Import torn down", errs ? "err" : "ok");
      await refresh();
    } catch (e) {
      addToast(e.message, "err");
    } finally {
      setBusyId(null);
      setConfirm(null);
    }
  };

  const doForget = async (item) => {
    setBusyId(item.id);
    try {
      await api.forgetImport(item.id);
      await refresh();
      addToast("Import record removed", "ok");
    } catch (e) {
      addToast(e.message, "err");
    } finally {
      setBusyId(null);
      setConfirm(null);
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
                    onClick={() => setConfirm({ kind: "teardown", item })}
                    disabled={isBusy}
                    title={`Tear down ${total} resource${total === 1 ? "" : "s"}`}
                  >
                    <Icon name="stop" size={14} />
                  </button>
                  <button
                    onClick={() => setConfirm({ kind: "forget", item })}
                    disabled={isBusy}
                    title="Forget this record"
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <ConfirmModal
        open={!!confirm}
        title={confirm?.kind === "teardown" ? "Tear down import?" : "Forget import record?"}
        message={
          confirm?.kind === "teardown" ? (
            <p>
              <strong>{confirm.item.name}</strong> will have all
              {" "}{confirm.item.containers.length} container{confirm.item.containers.length === 1 ? "" : "s"} and{" "}
              {confirm.item.networks.length} network{confirm.item.networks.length === 1 ? "" : "s"} removed.
            </p>
          ) : confirm ? (
            <p>Remove the record for <strong>{confirm.item.name}</strong>? Live resources will not be touched.</p>
          ) : null
        }
        confirmLabel={confirm?.kind === "teardown" ? "Tear down" : "Forget"}
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={() => (confirm?.kind === "teardown" ? doTeardown(confirm.item) : doForget(confirm.item))}
      />
    </section>
  );
}
