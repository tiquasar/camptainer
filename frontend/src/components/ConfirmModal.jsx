import { useEffect, useState } from "react";
import Icon from "./Icon.jsx";

export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  requireText, // if set, user must type this string to confirm
  onConfirm,
  onCancel,
}) {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;
  const ok = !requireText || typed === requireText;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="dialog__header">
          <div>
            <span className="eyebrow">{danger ? "Destructive" : "Please confirm"}</span>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" onClick={onCancel} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <div className="confirm-modal__body">
          {typeof message === "string" ? <p>{message}</p> : message}
        </div>
        {requireText && (
          <label className="field">
            <span>Type <code>{requireText}</code> to confirm</span>
            <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} />
          </label>
        )}
        <div className="dialog__actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>{cancelLabel}</button>
          <button
            type="button"
            className={danger ? "btn btn-danger" : "btn btn-primary"}
            disabled={!ok}
            onClick={onConfirm}
            autoFocus={!requireText}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
