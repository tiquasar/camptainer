// API client. In dev, Vite proxies these paths to the FastAPI backend (see
// vite.config.js), so we can use relative URLs.
const BASE = "";

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json()).detail || "";
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return res.json();
}

export const api = {
  networks: () => req("GET", "/networks"),
  containers: () => req("GET", "/containers"),

  createNetwork: (name, driver = "bridge") =>
    req("POST", "/networks", { name, driver }),
  deleteNetwork: (name) => req("DELETE", `/networks/${name}`),

  createContainer: (body) => req("POST", "/containers", body),
  deleteContainer: (id) => req("DELETE", `/containers/${id}`),
  recreate: (id, body) => req("POST", `/containers/${id}/recreate`, body),
  getLogs: (id, tail = 300) => fetch(`/containers/${id}/logs?tail=${tail}`).then((r) => r.text()),
  getStats: (id) => req("GET", `/containers/${id}/stats`),
  startContainer: (id) => req("POST", `/containers/${id}/start`),
  stopContainer: (id) => req("POST", `/containers/${id}/stop`),
  restartContainer: (id) => req("POST", `/containers/${id}/restart`),
  connect: (id, network) => req("POST", `/containers/${id}/connect`, { network }),
  disconnect: (id, network) =>
    req("POST", `/containers/${id}/disconnect`, { network }),

  saveStack: (name) => req("POST", "/stacks/save", { name }),
  getStacks: () => req("GET", "/stacks"),
  applyStack: (id) => req("POST", `/stacks/${id}/apply`),
  teardownStack: (id) => req("POST", `/stacks/${id}/teardown`),
  deleteStack: (id) => req("DELETE", `/stacks/${id}`),

  importCompose: (yaml, name) => req("POST", "/compose/import", { yaml, name }),
  getImportStatus: (jobId) => req("GET", `/compose/import/${jobId}`),

  listImports: () => req("GET", "/compose/imports"),
  teardownImport: (id) => req("POST", `/compose/imports/${id}/teardown`),
  forgetImport: (id) => req("DELETE", `/compose/imports/${id}`),

  getCompose: () => fetch("/compose").then((r) => r.text()),
};

// --- streaming (read from fetch body) ---
function readStream(url, onChunk) {
  return fetch(url).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    if (!res.body) throw new Error("No response stream was returned");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const pump = () =>
      reader.read().then(({ value, done }) => {
        if (done) return;
        onChunk(decoder.decode(value, { stream: true }));
        return pump();
      });
    return pump();
  });
}

export function streamPull(image, onChunk) {
  return readStream(`/compose/pull?image=${encodeURIComponent(image)}`, onChunk);
}
