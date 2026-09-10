import { useState } from "react";
import { api } from "../api.js";
import Icon from "./Icon.jsx";
import ConfirmModal from "./ConfirmModal.jsx";

export default function StacksPanel({ stacks, refresh, addToast }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const save = async () => {
    const clean = name.trim();
    if (!clean) return;
    setBusy(true);
    try {
      await api.saveStack(clean);
      setName("");
      await refresh();
      addToast(`Saved stack "${clean}"`, "ok");
    } catch (e) {
      addToast(e.message, "err");
    } finally {
      setBusy(false);
    }
  };

  const apply = async (stack) => {
    setBusy(true);
    try {
      const r = await api.applyStack(stack.id);
      const errs = (r.errors || []).join("; ");
      addToast(errs ? `Applied with errors: ${errs}` : "Stack applied", errs ? "err" : "ok");
    } catch (e) {
      addToast(e.message, "err");
    } finally {
      setBusy(false);
    }
  };

  const teardown = async (item) => {
    setBusy(true);
    try {
      await api.teardownStack(item.id);
      addToast("Stack torn down", "ok");
    } catch (e) {
      addToast(e.message, "err");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const remove = async (item) => {
    setBusy(true);
    try {
      await api.deleteStack(item.id);
      await refresh();
      addToast("Saved stack removed", "ok");
    } catch (e) {
      addToast(e.message, "err");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <section className="sidebar-section stacks-section">
      <div className="section-heading"><span>Saved stacks</span><span className="section-count">{stacks.length}</span></div>
      <div className="stack-save">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="production" aria-label="Stack name" disabled={busy} />
        <button className="icon-button icon-button--accent" onClick={save} title="Save current workspace" aria-label="Save current workspace" disabled={busy}><Icon name="plus" size={17} /></button>
      </div>
      {stacks.length === 0 ? (
        <p className="section-empty">Save the current workspace for later.</p>
      ) : (
        <div className="stack-list">
          {stacks.map((stack) => (
            <div key={stack.id} className="stack-item">
              <div className="stack-item__identity"><Icon name="layers" size={16} /><span title={stack.created_at}>{stack.name}</span></div>
              <div className="stack-item__actions">
                <button onClick={() => apply(stack)} disabled={busy} title="Apply stack"><Icon name="play" size={14} /></button>
                <button onClick={() => setConfirm({ kind: "teardown", item: stack })} disabled={busy} title="Teardown stack"><Icon name="stop" size={14} /></button>
                <button onClick={() => setConfirm({ kind: "delete", item: stack })} disabled={busy} title="Delete saved stack"><Icon name="trash" size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      <ConfirmModal
        open={!!confirm}
        title={confirm?.kind === "teardown" ? "Tear down stack?" : "Delete saved stack?"}
        message={
          confirm ? (
            <p>
              {confirm.kind === "teardown"
                ? <>All containers and networks captured in <strong>{confirm.item.name}</strong> will be removed.</>
                : <>The record for <strong>{confirm.item.name}</strong> will be deleted. Live resources will not be touched.</>}
            </p>
          ) : null
        }
        confirmLabel={confirm?.kind === "teardown" ? "Tear down" : "Delete"}
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={() => (confirm?.kind === "teardown" ? teardown(confirm.item) : remove(confirm.item))}
      />
    </section>
  );
}
