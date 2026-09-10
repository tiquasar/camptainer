// API client. In dev, Vite proxies these paths to the FastAPI backend (see
// vite.config.js), so we can use relative URLs.
const BASE = "";
const DEFAULT_TIMEOUT_MS = 30000;

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ApiError(`${label} timed out after ${ms / 1000}s`, 0)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function req(method, path, body, { timeoutMs = DEFAULT_TIMEOUT_MS, raw = false } = {}) {
  const init = {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  };
  const res = await withTimeout(fetch(BASE + path, init), timeoutMs, `${method} ${path}`);
  if (!res.ok) {
    let detail = "";
    try {
      const data = await res.json();
      detail = data.detail || data.message || "";
    } catch {
      /* not JSON */
    }
    throw new ApiError(detail || `Request failed (${res.status})`, res.status);
  }
  if (raw) return res;
  if (res.status === 204) return null;
  return res.json();
}

export { ApiError };

export const api = {
  // Health
  health: () => req("GET", "/health"),

  // Networks
  networks: () => req("GET", "/networks"),
  createNetwork: (name, driver = "bridge") =>
    req("POST", "/networks", { name, driver }),
  deleteNetwork: (name) => req("DELETE", `/networks/${encodeURIComponent(name)}`),

  // Containers
  containers: () => req("GET", "/containers"),
  container: (id) => req("GET", `/containers/${id}`),
  createContainer: (body) => req("POST", "/containers", body),
  deleteContainer: (id) => req("DELETE", `/containers/${id}`),
  recreate: (id, body) => req("POST", `/containers/${id}/recreate`, body),
  startContainer: (id) => req("POST", `/containers/${id}/start`),
  stopContainer: (id) => req("POST", `/containers/${id}/stop`),
  restartContainer: (id) => req("POST", `/containers/${id}/restart`),
  connect: (id, network) => req("POST", `/containers/${id}/connect`, { network }),
  disconnect: (id, network) => req("POST", `/containers/${id}/disconnect`, { network }),

  // Logs: snapshot (one-shot)
  getLogs: (id, tail = 300) =>
    fetch(`/containers/${id}/logs?tail=${tail}`).then(async (r) => {
      if (!r.ok) throw new ApiError(`Logs request failed (${r.status})`, r.status);
      return r.text();
    }),

  // Stats
  getStats: (id) => req("GET", `/containers/${id}/stats`),

  // Exec shell
  createExec: (id, command, interactive = true) =>
    req("POST", `/containers/${id}/exec`, { command, interactive }),

  // Stacks
  saveStack: (name) => req("POST", "/stacks/save", { name }),
  getStacks: () => req("GET", "/stacks"),
  getStack: (id) => req("GET", `/stacks/${id}`),
  applyStack: (id) => req("POST", `/stacks/${id}/apply`),
  teardownStack: (id) => req("POST", `/stacks/${id}/teardown`),
  deleteStack: (id) => req("DELETE", `/stacks/${id}`),

  // Compose
  importCompose: (yaml, name) => req("POST", "/compose/import", { yaml, name }),
  getImportStatus: (jobId) => req("GET", `/compose/import/${jobId}`),
  activeImports: () => req("GET", "/compose/jobs/active"),
  listImports: () => req("GET", "/compose/imports"),
  getImport: (id) => req("GET", `/compose/imports/${id}`),
  teardownImport: (id) => req("POST", `/compose/imports/${id}/teardown`),
  forgetImport: (id) => req("DELETE", `/compose/imports/${id}`),
  getCompose: () => fetch("/compose").then(async (r) => {
    if (!r.ok) throw new ApiError(`Export failed (${r.status})`, r.status);
    return r.text();
  }),

  // Images
  listImages: () => req("GET", "/images"),
  removeImage: (id, force = false) =>
    req("DELETE", `/images/${encodeURIComponent(id)}?force=${force}`),
  pruneImages: () => req("POST", "/images/prune"),

  // Volumes
  listVolumes: () => req("GET", "/volumes"),
  removeVolume: (name, force = false) =>
    req("DELETE", `/volumes/${encodeURIComponent(name)}?force=${force}`),
  pruneVolumes: () => req("POST", "/volumes/prune"),
};

// --- streaming ---

function readStream(url, onChunk, { timeoutMs = 5 * 60_000 } = {}) {
  return withTimeout(fetch(url), timeoutMs, `stream ${url}`).then((res) => {
    if (!res.ok) throw new ApiError(`Request failed (${res.status})`, res.status);
    if (!res.body) throw new ApiError("No response stream was returned", 0);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    return (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) return;
          onChunk(decoder.decode(value, { stream: true }));
        }
      } finally {
        try {
          reader.releaseLock();
        } catch {
          /* ignore */
        }
      }
    })();
  });
}

export function streamPull(image, onChunk) {
  return readStream(`/compose/pull?image=${encodeURIComponent(image)}`, onChunk);
}

export function streamLogs(id, onChunk, { tail = 100 } = {}) {
  return readStream(
    `/containers/${id}/logs?follow=true&tail=${tail}`,
    onChunk,
    { timeoutMs: 0 }, // logs are long-lived
  );
}
