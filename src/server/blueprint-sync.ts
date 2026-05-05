import { existsSync, watch as fsWatch, type FSWatcher } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ViteDevServer } from "vite";
import { defaultRegistry, normalizeGraphFile } from "../graphFile";
import type { GraphFile } from "../types";
import {
  describeWorkspaceSource,
  documentFsPath as resolveFsPath,
  envWorkspaceOverride,
  getWorkspaceDir,
  getWorkspaceRegistry,
  isWorkspaceToolFile,
  setWorkspaceConfig,
} from "./workspace";

type Options = Record<string, never>;

type SseClient = { id: number; res: ServerResponse; path?: string };

type DocumentEntry = {
  path: string;
  name: string;
};

type DocumentResponse = DocumentEntry & {
  file: GraphFile;
};

type EventPayload = {
  origin: string;
  path?: string;
};

const DOCUMENTS_DIR = "blueprints";

// How long after a server write to suppress matching fs.watch echoes.
const ECHO_WINDOW_MS = 5_000;

function documentName(documentPath: string): string {
  return path.posix.basename(documentPath, ".json");
}

function normalizeDocumentPath(raw: string | null): string | null {
  const value = raw?.trim().replace(/\\/g, "/") ?? "";
  if (!value) return null;
  if (value.includes("\0") || value.includes("..")) return null;
  if (path.posix.isAbsolute(value)) return null;

  const normalized = path.posix.normalize(value);
  if (normalized !== value) return null;
  if (path.posix.dirname(normalized) !== DOCUMENTS_DIR) return null;

  const basename = path.posix.basename(normalized);
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]*\.json$/.test(basename)) return null;
  if (isWorkspaceToolFile(basename)) return null;
  return normalized;
}

function documentAbsolutePath(
  workspaceDir: string,
  documentPath: string,
): string | null {
  const absolute = resolveFsPath(workspaceDir, documentPath);
  const root = path.resolve(workspaceDir);
  if (
    absolute !== root &&
    !absolute.startsWith(`${root}${path.sep}`)
  ) {
    return null;
  }
  return absolute;
}

function documentResponse(documentPath: string, file: GraphFile): DocumentResponse {
  return {
    path: documentPath,
    name: documentName(documentPath),
    file,
  };
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(data));
}

export function blueprintSync(_opts: Options = {}): Plugin {
  let root = "";
  let documentsPath = "";
  let documentsWatcher: FSWatcher | null = null;
  let documentsPoller: ReturnType<typeof setInterval> | null = null;
  const sseClients = new Map<number, SseClient>();
  let nextClientId = 1;
  const fileSnapshots = new Map<string, string>();

  // Track recent server writes per file so their fs.watch echoes do not come
  // back as "external" edits after the HTTP response.
  const recentWrites = new Map<string, { content: string; expires: number }>();

  function broadcast(event: string, data: EventPayload) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients.values()) {
      if (data.path && client.path !== data.path) continue;
      try {
        client.res.write(payload);
      } catch {
        // Connection probably dead; will be cleaned up on next request.
      }
    }
  }

  async function isServerWriteEcho(file: string): Promise<boolean> {
    const entry = recentWrites.get(file);
    if (!entry) return false;
    if (entry.expires <= Date.now()) {
      recentWrites.delete(file);
      return false;
    }
    try {
      const text = await readFile(file, "utf8");
      if (text === entry.content) return true;
      recentWrites.delete(file);
      return false;
    } catch {
      return false;
    }
  }

  function rememberWrite(file: string, content: string) {
    recentWrites.set(file, {
      content,
      expires: Date.now() + ECHO_WINDOW_MS,
    });
  }

  async function readBody(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString("utf8");
  }

  async function ensureDocumentsDir() {
    await mkdir(documentsPath, { recursive: true });
  }

  function documentPathFromWatchedFile(filename: string): string | null {
    if (!filename.endsWith(".json")) return null;
    return normalizeDocumentPath(`${DOCUMENTS_DIR}/${filename}`);
  }

  async function scanDocumentsForChanges() {
    if (!existsSync(documentsPath)) return;
    const entries = await readdir(documentsPath, { withFileTypes: true });
    const seen = new Set<string>();

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const documentPath = documentPathFromWatchedFile(entry.name);
      if (!documentPath) continue;

      const absolute = documentAbsolutePath(documentsPath, documentPath);
      if (!absolute) continue;

      seen.add(absolute);
      let text = "";
      try {
        text = await readFile(absolute, "utf8");
      } catch {
        continue;
      }

      const previous = fileSnapshots.get(absolute);
      fileSnapshots.set(absolute, text);
      if (previous === undefined || previous === text) continue;
      if (await isServerWriteEcho(absolute)) continue;

      broadcast("graph-changed", {
        origin: "external",
        path: documentPath,
      });
    }

    for (const absolute of fileSnapshots.keys()) {
      if (!seen.has(absolute)) fileSnapshots.delete(absolute);
    }
  }

  function startDocumentsPolling() {
    if (documentsPoller) return;
    void scanDocumentsForChanges();
    documentsPoller = setInterval(() => {
      void scanDocumentsForChanges().catch((err) => {
        console.warn("[blueprint-sync] polling scan failed:", err);
      });
    }, 1_500);
  }

  function startDocumentsWatch(): FSWatcher | null {
    if (!existsSync(documentsPath)) return null;
    const watcher = fsWatch(documentsPath, { persistent: false }, async (_event, file) => {
      if (!file) return;
      const filename = String(file);
      const documentPath = documentPathFromWatchedFile(filename);
      if (!documentPath) return;

      const absolute = documentAbsolutePath(documentsPath, documentPath);
      if (!absolute) return;
      if (await isServerWriteEcho(absolute)) return;

      broadcast("graph-changed", {
        origin: "external",
        path: documentPath,
      });
    });
    watcher.on("error", (err) => {
      console.warn("[blueprint-sync] file watcher disabled, using polling:", err);
      documentsWatcher = null;
      watcher.close();
      startDocumentsPolling();
    });
    return watcher;
  }

  function ensureWatching() {
    if (!documentsWatcher && !documentsPoller) {
      documentsWatcher = startDocumentsWatch();
    }
  }

  // Re-read the workspace location from env / config / default and rebind
  // the file watcher to the new dir. Called from PUT /api/config so the
  // browser can switch workspaces without restarting `npm run dev`.
  async function reinitWorkspace() {
    documentsWatcher?.close();
    documentsWatcher = null;
    if (documentsPoller) {
      clearInterval(documentsPoller);
      documentsPoller = null;
    }
    fileSnapshots.clear();
    documentsPath = getWorkspaceDir(root);
    const ws = describeWorkspaceSource(root);
    // eslint-disable-next-line no-console
    console.log(
      `[blueprint-sync] workspace switched to: ${ws.dir} (from ${ws.source})`,
    );
    await ensureDocumentsDir();
    ensureWatching();
  }

  async function listDocuments(): Promise<DocumentEntry[]> {
    await ensureDocumentsDir();
    ensureWatching();
    const entries = await readdir(documentsPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => normalizeDocumentPath(`${DOCUMENTS_DIR}/${entry.name}`))
      .filter((documentPath): documentPath is string => documentPath !== null)
      .map((documentPath) => ({
        path: documentPath,
        name: documentName(documentPath),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async function readDocument(documentPath: string): Promise<GraphFile | null> {
    const absolute = documentAbsolutePath(documentsPath, documentPath);
    if (!absolute || !existsSync(absolute)) return null;
    const text = await readFile(absolute, "utf8");
    return normalizeGraphFile(JSON.parse(text));
  }

  async function writeDocument(
    documentPath: string,
    file: GraphFile,
    origin: string,
  ): Promise<DocumentResponse | null> {
    const absolute = documentAbsolutePath(documentsPath, documentPath);
    if (!absolute) return null;
    const clean = normalizeGraphFile(file);
    if (!clean) return null;
    const text = JSON.stringify(clean, null, 2);
    await ensureDocumentsDir();
    rememberWrite(absolute, text);
    await writeFile(absolute, text, "utf8");
    ensureWatching();
    broadcast("graph-changed", { origin, path: documentPath });
    return documentResponse(documentPath, clean);
  }

  async function readJsonPayload(
    req: IncomingMessage,
  ): Promise<{ origin: string; payload: unknown } | null> {
    const body = await readBody(req);
    try {
      const parsed = JSON.parse(body) as { origin?: unknown; payload?: unknown };
      return {
        origin: typeof parsed.origin === "string" ? parsed.origin : "external",
        payload: parsed.payload,
      };
    } catch {
      return null;
    }
  }

  return {
    name: "blueprint-sync",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      root = server.config.root;
      documentsPath = getWorkspaceDir(root);
      const ws = describeWorkspaceSource(root);
      // eslint-disable-next-line no-console
      console.log(
        `[blueprint-sync] workspace: ${ws.dir} (from ${ws.source})`,
      );

      void ensureDocumentsDir()
        .then(() => {
          ensureWatching();
        })
        .catch((err) => {
          console.error("[blueprint-sync] could not prepare blueprints dir:", err);
        });

      server.httpServer?.on("close", () => {
        documentsWatcher?.close();
        if (documentsPoller) clearInterval(documentsPoller);
        for (const c of sseClients.values()) {
          try {
            c.res.end();
          } catch {
            // ignore
          }
        }
      });

      server.middlewares.use(async (req, res, next) => {
        const reqUrl = new URL(req.url ?? "", "http://blueprint.local");
        if (!reqUrl.pathname.startsWith("/api/")) return next();

        try {
          // ----- GET /api/documents -----
          if (reqUrl.pathname === "/api/documents" && req.method === "GET") {
            sendJson(res, 200, { documents: await listDocuments() });
            return;
          }

          // ----- GET /api/registry -----
          // Returns the workspace-level registry (or null if absent) plus
          // the built-in default. The browser merges with any per-doc
          // override via resolveRegistry().
          if (reqUrl.pathname === "/api/registry" && req.method === "GET") {
            sendJson(res, 200, {
              workspace: getWorkspaceRegistry(documentsPath),
              builtIn: defaultRegistry(),
            });
            return;
          }

          // ----- GET /api/config -----
          // Returns the resolved workspace dir, where it came from, and
          // the env override (if any). The browser uses this to render
          // the Settings modal.
          if (reqUrl.pathname === "/api/config" && req.method === "GET") {
            const ws = describeWorkspaceSource(root);
            sendJson(res, 200, {
              workspace: ws.dir,
              source: ws.source,
              envOverride: envWorkspaceOverride(),
            });
            return;
          }

          // ----- PUT /api/config -----
          // Body: { workspace: string | null }. Writes (or removes)
          // blueprint.config.json, then re-init the watcher and broadcast
          // workspace-changed so all clients refresh. Refuses with 409
          // when BLUEPRINT_WORKSPACE is set in the shell.
          if (reqUrl.pathname === "/api/config" && req.method === "PUT") {
            if (envWorkspaceOverride()) {
              sendJson(res, 409, {
                error:
                  "BLUEPRINT_WORKSPACE env var is set; unset it to use UI config.",
              });
              return;
            }
            const body = await readBody(req);
            let parsed: { workspace?: unknown };
            try {
              parsed = JSON.parse(body);
            } catch {
              res.statusCode = 400;
              res.end("invalid json");
              return;
            }
            const next =
              typeof parsed.workspace === "string" ? parsed.workspace : null;
            try {
              setWorkspaceConfig(root, next);
            } catch (err) {
              // eslint-disable-next-line no-console
              console.error("[blueprint-sync] setWorkspaceConfig failed:", err);
              res.statusCode = 500;
              res.end("failed to write config");
              return;
            }
            await reinitWorkspace();
            broadcast("workspace-changed", { origin: "external" });
            const ws = describeWorkspaceSource(root);
            sendJson(res, 200, {
              workspace: ws.dir,
              source: ws.source,
              envOverride: null,
            });
            return;
          }

          // ----- GET /api/document?path=blueprints/name.json -----
          if (reqUrl.pathname === "/api/document" && req.method === "GET") {
            const documentPath = normalizeDocumentPath(reqUrl.searchParams.get("path"));
            if (!documentPath) {
              res.statusCode = 400;
              res.end("invalid path");
              return;
            }
            const file = await readDocument(documentPath);
            if (!file) {
              res.statusCode = 404;
              res.end("not found");
              return;
            }
            sendJson(res, 200, documentResponse(documentPath, file));
            return;
          }

          // ----- PUT /api/document?path=blueprints/name.json -----
          if (reqUrl.pathname === "/api/document" && req.method === "PUT") {
            const documentPath = normalizeDocumentPath(reqUrl.searchParams.get("path"));
            if (!documentPath) {
              res.statusCode = 400;
              res.end("invalid path");
              return;
            }
            const parsed = await readJsonPayload(req);
            const file = normalizeGraphFile(parsed?.payload);
            if (!parsed || !file) {
              res.statusCode = 400;
              res.end("invalid graph file");
              return;
            }
            const saved = await writeDocument(documentPath, file, parsed.origin);
            if (!saved) {
              res.statusCode = 400;
              res.end("invalid graph file");
              return;
            }
            sendJson(res, 200, saved);
            return;
          }

          // ----- POST /api/document?path=blueprints/name.json&overwrite=0 -----
          if (reqUrl.pathname === "/api/document" && req.method === "POST") {
            const documentPath = normalizeDocumentPath(reqUrl.searchParams.get("path"));
            if (!documentPath) {
              res.statusCode = 400;
              res.end("invalid path");
              return;
            }
            const absolute = documentAbsolutePath(documentsPath, documentPath);
            const overwrite = reqUrl.searchParams.get("overwrite") === "1";
            if (!absolute) {
              res.statusCode = 400;
              res.end("invalid path");
              return;
            }
            if (!overwrite && existsSync(absolute)) {
              res.statusCode = 409;
              res.end("already exists");
              return;
            }
            const parsed = await readJsonPayload(req);
            const file = normalizeGraphFile(parsed?.payload);
            if (!parsed || !file) {
              res.statusCode = 400;
              res.end("invalid graph file");
              return;
            }
            const saved = await writeDocument(documentPath, file, parsed.origin);
            if (!saved) {
              res.statusCode = 400;
              res.end("invalid graph file");
              return;
            }
            sendJson(res, 200, saved);
            return;
          }

          // ----- GET /api/events?path=blueprints/name.json (SSE) -----
          if (reqUrl.pathname === "/api/events" && req.method === "GET") {
            const rawPath = reqUrl.searchParams.get("path");
            const normalizedPath = rawPath ? normalizeDocumentPath(rawPath) : null;
            if (rawPath && !normalizedPath) {
              res.statusCode = 400;
              res.end("invalid path");
              return;
            }
            const documentPath = normalizedPath ?? undefined;

            res.statusCode = 200;
            res.setHeader("content-type", "text/event-stream");
            res.setHeader("cache-control", "no-cache, no-transform");
            res.setHeader("connection", "keep-alive");
            res.setHeader("x-accel-buffering", "no");
            res.write(": connected\n\n");

            const id = nextClientId++;
            const client: SseClient = { id, res, path: documentPath };
            sseClients.set(id, client);

            const ka = setInterval(() => {
              try {
                res.write(": ka\n\n");
              } catch {
                // ignore
              }
            }, 25_000);

            req.on("close", () => {
              clearInterval(ka);
              sseClients.delete(id);
            });
            return;
          }

          res.statusCode = 404;
          res.end("not found");
        } catch (err) {
          console.error("[blueprint-sync] error:", err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.end("internal error");
          } else {
            res.end();
          }
        }
      });
    },
  };
}
