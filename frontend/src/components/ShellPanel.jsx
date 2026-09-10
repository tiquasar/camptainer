import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import Icon from "./Icon.jsx";

const DEFAULT_CMD = ["/bin/sh", "-c", "sh"];

export default function ShellPanel({ container, onClose, addToast }) {
  const wsRef = useRef(null);
  const scrollRef = useRef(null);
  const [status, setStatus] = useState("Connecting");
  const [chunks, setChunks] = useState([]); // each chunk is a string
  const [input, setInput] = useState("");

  useEffect(() => {
    let cancelled = false;
    let ws = null;

    const open = async () => {
      try {
        const { ws: wsPath } = await api.createExec(container.id, DEFAULT_CMD, true);
        if (cancelled) return;
        const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${wsPath}`;
        ws = new WebSocket(url);
        wsRef.current = ws;
        ws.onopen = () => {
          setStatus("Connected");
          sendResize();
          setChunks((c) => [...c, "# Connected. Type a command and press Enter.\n"]);
        };
        ws.onmessage = (ev) => setChunks((c) => [...c, ev.data]);
        ws.onerror = () => setStatus("Error");
        ws.onclose = () => setStatus("Disconnected");
      } catch (e) {
        addToast(e.message, "err");
        setStatus("Error");
      }
    };

    const sendResize = () => {
      if (!ws || ws.readyState !== ws.OPEN) return;
      try {
        ws.send(JSON.stringify({ type: "resize", rows: 24, cols: 80 }));
      } catch {
        /* ignore */
      }
    };

    open();
    return () => {
      cancelled = true;
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, [container.id, addToast]);

  // Auto-scroll to bottom on new output.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chunks]);

  const submit = (e) => {
    e.preventDefault();
    if (!input || !wsRef.current || wsRef.current.readyState !== wsRef.current.OPEN) return;
    wsRef.current.send(input + "\n");
    setChunks((c) => [...c, `$ ${input}\n`]);
    setInput("");
  };

  return (
    <aside className="inspector">
      <div className="inspector__header">
        <div className="inspector__identity">
          <div className="inspector__icon"><Icon name="terminal" size={21} /></div>
          <div>
            <h2>{container.name}</h2>
            <p>Interactive shell &middot; <span className={`status-chip ${status === "Connected" ? "is-running" : "is-stopped"}`}><i />{status}</span></p>
          </div>
        </div>
        <button className="icon-button" onClick={onClose} title="Close shell" aria-label="Close shell">
          <Icon name="close" size={18} />
        </button>
      </div>
      <div className="terminal-panel">
        <div className="terminal-output" ref={scrollRef}>
          <pre>{chunks.map((c, i) => <span key={i}>{c}</span>)}</pre>
        </div>
        <form className="terminal-input" onSubmit={submit}>
          <span className="terminal-prompt">$</span>
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="type a command…"
            spellCheck={false}
            disabled={status !== "Connected"}
          />
        </form>
      </div>
    </aside>
  );
}
