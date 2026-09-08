import { useState } from "react";
import { api } from "../api.js";
import Icon from "./Icon.jsx";

export default function StacksPanel({ stacks, refresh, addToast }) {
  const [name, setName] = useState("");

  const save = async () => {
    const clean = name.trim();
    if (!clean) return;
    try {
      await api.saveStack(clean);
      setName("");
      await refresh();
      addToast(`Saved stack “${clean}”`, "ok");
    } catch (e) {
      addToast(e.message, "err");
    }
  };

  const apply = async (id) => {
    try {
      await api.applyStack(id);
      addToast("Stack applied", "ok");
    } catch (e) {
      addToast(e.message, "err");
    }
  };

  const teardown = async (id) => {
    if (!confirm("Tear down this stack? Its containers and networks will be removed.")) return;
    try {
      await api.teardownStack(id);
      addToast("Stack torn down", "ok");
    } catch (e) {
      addToast(e.message, "err");
    }
  };

  const remove = async (id) => {
    try {
      await api.deleteStack(id);
      await refresh();
      addToast("Saved stack removed", "ok");
    } catch (e) {
      addToast(e.message, "err");
    }
  };

  return (
    <section className="sidebar-section stacks-section">
      <div className="section-heading"><span>Saved stacks</span><span className="section-count">{stacks.length}</span></div>
      <div className="stack-save">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="production" aria-label="Stack name" />
        <button className="icon-button icon-button--accent" onClick={save} title="Save current workspace" aria-label="Save current workspace"><Icon name="plus" size={17} /></button>
      </div>
      {stacks.length === 0 ? (
        <p className="section-empty">Save the current workspace for later.</p>
      ) : (
        <div className="stack-list">
          {stacks.map((stack) => (
            <div key={stack.id} className="stack-item">
              <div className="stack-item__identity"><Icon name="layers" size={16} /><span>{stack.name}</span></div>
              <div className="stack-item__actions">
                <button onClick={() => apply(stack.id)} title="Apply stack"><Icon name="play" size={14} /></button>
                <button onClick={() => teardown(stack.id)} title="Teardown stack"><Icon name="stop" size={14} /></button>
                <button onClick={() => remove(stack.id)} title="Delete saved stack"><Icon name="trash" size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
