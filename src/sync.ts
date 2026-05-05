import { normalizeGraphFile, normalizeRegistry } from "./graphFile";
import type { GraphFile, Registry } from "./types";

const generateClientId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `client-${crypto.randomUUID()}`;
  }
  return `client-${Math.random().toString(36).slice(2)}-${Date.now().toString(
    36,
  )}`;
};

export const clientId: string = generateClientId();

let connected: boolean | null = null;

export function isConnected(): boolean | null {
  return connected;
}

async function safeFetch(
  input: string,
  init?: RequestInit,
): Promise<Response | null> {
  try {
    const r = await fetch(input, init);
    connected = true;
    return r;
  } catch {
    connected = false;
    return null;
  }
}

export type DocumentEntry = {
  path: string;
  name: string;
};

export type GraphDocument = DocumentEntry & {
  file: GraphFile;
};

export type SaveAsResult = GraphDocument | "exists" | null;

function documentUrl(path: string): string {
  return `/api/document?path=${encodeURIComponent(path)}`;
}

function eventUrl(path?: string | null): string {
  return path ? `/api/events?path=${encodeURIComponent(path)}` : "/api/events";
}

async function readGraphDocument(r: Response): Promise<GraphDocument | null> {
  try {
    const parsed = (await r.json()) as Partial<GraphDocument>;
    if (typeof parsed.path !== "string" || typeof parsed.name !== "string") {
      return null;
    }
    const file = normalizeGraphFile(parsed.file);
    if (!file) return null;
    return { path: parsed.path, name: parsed.name, file };
  } catch {
    connected = false;
    return null;
  }
}

export async function listDocuments(): Promise<DocumentEntry[] | null> {
  const r = await safeFetch("/api/documents");
  if (!r || !r.ok) return null;
  try {
    const parsed = (await r.json()) as { documents?: unknown };
    if (!Array.isArray(parsed.documents)) return null;
    return parsed.documents
      .filter(
        (doc): doc is DocumentEntry =>
          !!doc &&
          typeof doc === "object" &&
          typeof (doc as DocumentEntry).path === "string" &&
          typeof (doc as DocumentEntry).name === "string",
      )
      .map((doc) => ({ path: doc.path, name: doc.name }));
  } catch {
    connected = false;
    return null;
  }
}

export async function loadDocument(path: string): Promise<GraphDocument | null> {
  const r = await safeFetch(documentUrl(path));
  if (!r || !r.ok) return null;
  return readGraphDocument(r);
}

export async function saveDocument(
  path: string,
  file: GraphFile,
): Promise<GraphDocument | null> {
  const r = await safeFetch(documentUrl(path), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ origin: clientId, payload: file }),
  });
  if (!r || !r.ok) return null;
  return readGraphDocument(r);
}

export async function createOrSaveAsDocument(
  path: string,
  file: GraphFile,
  overwrite = false,
): Promise<SaveAsResult> {
  const r = await safeFetch(`${documentUrl(path)}&overwrite=${overwrite ? "1" : "0"}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ origin: clientId, payload: file }),
  });
  if (!r) return null;
  if (r.status === 409) return "exists";
  if (!r.ok) return null;
  return readGraphDocument(r);
}

export type RegistryResponse = {
  workspace: Registry | null;
  builtIn: Registry;
};

export type WorkspaceConfig = {
  workspace: string;
  source: "env" | "config" | "default";
  envOverride: string | null;
};

export async function fetchWorkspaceConfig(): Promise<WorkspaceConfig | null> {
  const r = await safeFetch("/api/config");
  if (!r || !r.ok) return null;
  try {
    return (await r.json()) as WorkspaceConfig;
  } catch {
    return null;
  }
}

// Returns the new config on success, "env-override" if the server refuses
// because BLUEPRINT_WORKSPACE is set, or null on any other failure.
export async function saveWorkspaceConfig(
  workspace: string | null,
): Promise<WorkspaceConfig | "env-override" | null> {
  const r = await safeFetch("/api/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspace }),
  });
  if (!r) return null;
  if (r.status === 409) return "env-override";
  if (!r.ok) return null;
  try {
    return (await r.json()) as WorkspaceConfig;
  } catch {
    return null;
  }
}

export async function fetchRegistry(): Promise<RegistryResponse | null> {
  const r = await safeFetch("/api/registry");
  if (!r || !r.ok) return null;
  try {
    const parsed = (await r.json()) as {
      workspace?: unknown;
      builtIn?: unknown;
    };
    const workspace = normalizeRegistry(parsed.workspace);
    const builtIn = normalizeRegistry(parsed.builtIn);
    if (!builtIn) return null;
    return { workspace, builtIn };
  } catch {
    return null;
  }
}

export type SyncHandlers = {
  onGraphChanged?: (origin: string, path?: string) => void;
  onWorkspaceChanged?: () => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
};

export function subscribe(
  handlers: SyncHandlers,
  path?: string | null,
): () => void {
  if (typeof EventSource === "undefined") {
    connected = false;
    handlers.onDisconnect?.();
    return () => {};
  }

  let es: EventSource | null = null;
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const open = () => {
    if (stopped) return;
    es = new EventSource(eventUrl(path));

    es.onopen = () => {
      connected = true;
      handlers.onConnect?.();
    };

    es.onerror = () => {
      // EventSource auto-reconnects, but if the dev server is gone we
      // also want to surface "offline" state.
      connected = false;
      handlers.onDisconnect?.();
      // Close and retry after a delay so we don't spin in a tight reconnect loop.
      es?.close();
      es = null;
      if (!stopped) {
        reconnectTimer = setTimeout(open, 2_000);
      }
    };

    es.addEventListener("graph-changed", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as {
          origin: string;
          path?: string;
        };
        if (data.origin === clientId) return;
        handlers.onGraphChanged?.(data.origin, data.path);
      } catch {
        // ignore
      }
    });

    es.addEventListener("workspace-changed", () => {
      // No client-id filter — workspace switches are global; the same
      // client that triggered the PUT also wants to refresh its
      // document list and registry.
      handlers.onWorkspaceChanged?.();
    });
  };

  open();

  return () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    es?.close();
  };
}
