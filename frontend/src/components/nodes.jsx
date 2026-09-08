import { Handle, Position } from "reactflow";
import Icon from "./Icon.jsx";

export function ContainerNode({ data }) {
  const running = data.status === "running";
  return (
    <div className="flow-node flow-container-node">
      <Handle type="source" position={Position.Left} aria-label="Connect this container" />
      <div className="flow-node__topline">
        <span className="flow-node__icon flow-node__icon--container"><Icon name="cube" size={17} /></span>
        <span className={`flow-node__state ${running ? "is-running" : "is-stopped"}`}>
          <i /> {running ? "Running" : data.status}
        </span>
      </div>
      <div className="flow-node__title">{data.label}</div>
      <div className="flow-node__sub">{data.image}</div>
      <Handle type="target" position={Position.Right} aria-label="Receive network connection" />
    </div>
  );
}

export function NetworkNode({ data }) {
  return (
    <div className="flow-node flow-network-node">
      <Handle type="source" position={Position.Right} aria-label="Connect network" />
      <div className="flow-node__topline">
        <span className="flow-node__icon flow-node__icon--network"><Icon name="network" size={17} /></span>
        <span className="flow-node__network-label">NETWORK</span>
      </div>
      <div className="flow-node__title">{data.label}</div>
      <div className="flow-node__sub">{data.driver} driver</div>
      <Handle type="target" position={Position.Left} aria-label="Receive container connection" />
    </div>
  );
}
