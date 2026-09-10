import Icon from "./Icon.jsx";

const MAX_VISIBLE = 5;

export default function Toasts({ toasts, onDismiss }) {
  const visible = toasts.slice(-MAX_VISIBLE);
  const overflow = toasts.length - visible.length;
  return (
    <div className="toasts" aria-live="polite">
      {overflow > 0 && (
        <div className="toast toast-overflow">+{overflow} more notification{overflow === 1 ? "" : "s"}</div>
      )}
      {visible.map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>
          <span className="toast__msg">{t.msg}</span>
          <button className="toast__dismiss" onClick={() => onDismiss?.(t.id)} aria-label="Dismiss">
            <Icon name="close" size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
