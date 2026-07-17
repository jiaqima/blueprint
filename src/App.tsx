import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MindMap, type MindMapHandle } from "./MindMap";
import { Toolbar } from "./Toolbar";
import { NotesPanel } from "./NotesPanel";
import { Inspector } from "./Inspector";
import {
  defaultRegistry,
  defaultUi,
  graphFileJson,
  normalizeGraphFile,
  seedGraphFile,
  stripFileForPersist,
} from "./graphFile";
import { resolveRegistry } from "./registry";
import {
  debounce,
  loadActiveDocumentPath,
  loadRecovery,
  loadRecoveryDirty,
  saveActiveDocumentPath,
  saveRecovery,
} from "./storage";
import {
  createOrSaveAsDocument,
  fetchRegistry,
  isConnected,
  listDocuments,
  loadDocument,
  saveDocument,
  subscribe,
  type DocumentEntry,
  type RegistryResponse,
} from "./sync";
import type {
  Graph,
  GraphFile,
  MindEdgeData,
  MindNodeData,
  Registry,
  Selection,
  Viewport,
} from "./types";

export type SaveResult = "saved" | "needs-path" | "error";
export type SaveAsResult = "saved" | "exists" | "error";

// Content-level identity for a GraphFile: ignores `ui` (viewport /
// selection / collapse) so a recovered snapshot that differs only by
// pan/zoom doesn't count as unsaved work.
function contentJson(file: GraphFile): string {
  return graphFileJson(stripFileForPersist({ ...file, ui: defaultUi() }));
}

export default function App() {
  const recoveredFile = useMemo<GraphFile | null>(() => loadRecovery(), []);
  // Captured at startup, before the debounced recovery saves below start
  // rewriting the flag.
  const recoveredWasDirty = useMemo(() => loadRecoveryDirty(), []);
  const initialFile = useMemo<GraphFile>(
    () => recoveredFile ?? seedGraphFile(),
    [recoveredFile],
  );
  const cleanSeedJson = useMemo(() => graphFileJson(seedGraphFile()), []);

  const [graphFile, setGraphFile] = useState<GraphFile>(initialFile);
  const [activeDocumentPath, setActiveDocumentPath] = useState<string | null>(
    null,
  );
  const [documentName, setDocumentName] = useState("Untitled");
  const [dirty, setDirty] = useState(
    () => graphFileJson(initialFile) !== cleanSeedJson,
  );
  // Mirror of `dirty` for callbacks whose closures outlive a render
  // (the SSE handler below).
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  // Set when the active document changed on disk while the editor holds
  // unsaved changes; rendered as a conflict bar instead of silently
  // replacing the user's work.
  const [conflictPath, setConflictPath] = useState<string | null>(null);
  const mapRef = useRef<MindMapHandle>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [registryResp, setRegistryResp] = useState<RegistryResponse | null>(null);
  const [tab, setTab] = useState<"inspector" | "notes">("notes");

  // Hold the latest viewport from the canvas so we can include it in saves
  // without re-applying it back to the canvas while the user is interacting.
  const lastUserViewportTs = useRef(0);
  const lastSavedJsonRef = useRef<string>(cleanSeedJson);

  const replaceEditorFile = useCallback(
    (file: GraphFile, options: { applyViewport?: boolean } = {}) => {
      const next = normalizeGraphFile(file) ?? seedGraphFile();
      setGraphFile(next);
      mapRef.current?.loadGraph(
        { nodes: next.nodes, edges: next.edges },
        { relayout: false, selection: next.ui.selection },
      );
      if (options.applyViewport !== false) {
        requestAnimationFrame(() => {
          mapRef.current?.setViewport(next.ui.viewport);
        });
      }
    },
    [],
  );

  const currentGraphFile = useCallback((): GraphFile => {
    const graph = mapRef.current?.exportGraph();
    return stripFileForPersist({
      ...graphFile,
      nodes: graph?.nodes ?? graphFile.nodes,
      edges: graph?.edges ?? graphFile.edges,
    });
  }, [graphFile]);

  const debouncedRecoverySave = useMemo(
    () =>
      debounce((file: GraphFile, isDirty: boolean) => {
        saveRecovery(file, isDirty);
      }, 250),
    [],
  );

  useEffect(() => {
    const clean = stripFileForPersist(graphFile);
    const nextDirty = graphFileJson(clean) !== lastSavedJsonRef.current;
    debouncedRecoverySave(clean, nextDirty);
    setDirty(nextDirty);
  }, [graphFile, debouncedRecoverySave]);

  useEffect(() => {
    let alive = true;

    (async () => {
      const documents = await listDocuments();
      if (!alive) return;
      setOnline(isConnected());

      if (!documents) return;

      const lastPath = loadActiveDocumentPath();
      const canLoadLast =
        lastPath && documents.some((document) => document.path === lastPath);

      if (canLoadLast) {
        const document = await loadDocument(lastPath);
        if (!document || !alive) return;
        // If the recovery snapshot holds unsaved work that differs from
        // the on-disk document, ask before discarding it. A snapshot
        // taken while clean is just a stale copy — never prompt for it.
        const restoreRecovered =
          recoveredFile !== null &&
          recoveredWasDirty &&
          contentJson(recoveredFile) !== contentJson(document.file) &&
          confirm(
            `Restore unsaved changes recovered from your last session of "${document.name}"?\n\n` +
              "OK — keep the recovered version in the editor (unsaved).\n" +
              "Cancel — load the saved file and discard the recovered changes.",
          );
        lastSavedJsonRef.current = graphFileJson(document.file);
        setActiveDocumentPath(document.path);
        setDocumentName(document.name);
        if (restoreRecovered) {
          // The editor already shows the recovered snapshot; leave it in
          // place, marked unsaved against the on-disk version.
          setDirty(true);
        } else {
          setDirty(false);
          replaceEditorFile(document.file);
        }
        return;
      }

      saveActiveDocumentPath(null);
    })();

    return () => {
      alive = false;
    };
  }, [cleanSeedJson, recoveredFile, recoveredWasDirty, replaceEditorFile]);

  useEffect(() => {
    let alive = true;
    const stop = subscribe(
      {
        onConnect: () => setOnline(true),
        onDisconnect: () => setOnline(false),
        onGraphChanged: async (_origin, path) => {
          if (!path || path !== activeDocumentPath) return;
          if (dirtyRef.current) {
            // Unsaved editor changes — don't clobber them. Surface a
            // conflict bar and let the user pick a side.
            setConflictPath(path);
            return;
          }
          const document = await loadDocument(path);
          if (!document || !alive) return;

          lastSavedJsonRef.current = graphFileJson(document.file);
          setActiveDocumentPath(document.path);
          setDocumentName(document.name);
          setDirty(false);
          replaceEditorFile(document.file, {
            applyViewport: Date.now() - lastUserViewportTs.current > 5000,
          });
        },
        onWorkspaceChanged: async () => {
          setConflictPath(null);
          // Refresh registry (the new workspace may have a different
          // blueprint.types.toml or none at all).
          const reg = await fetchRegistry();
          if (alive && reg) setRegistryResp(reg);

          // Re-evaluate the active document against the new workspace.
          const documents = await listDocuments();
          setOnline(isConnected());
          if (!alive) return;
          const stillThere =
            activeDocumentPath !== null &&
            documents !== null &&
            documents.some((d) => d.path === activeDocumentPath);
          if (stillThere && activeDocumentPath) {
            const doc = await loadDocument(activeDocumentPath);
            if (!doc || !alive) return;
            lastSavedJsonRef.current = graphFileJson(doc.file);
            setActiveDocumentPath(doc.path);
            setDocumentName(doc.name);
            setDirty(false);
            replaceEditorFile(doc.file);
          } else {
            // Active doc isn't in the new workspace — clear and reset.
            saveActiveDocumentPath(null);
            setActiveDocumentPath(null);
            setDocumentName("Untitled");
            const seed = seedGraphFile();
            lastSavedJsonRef.current = graphFileJson(seed);
            setDirty(false);
            replaceEditorFile(seed);
          }
        },
      },
      activeDocumentPath,
    );

    return () => {
      alive = false;
      stop();
    };
  }, [activeDocumentPath, replaceEditorFile]);

  const confirmDiscardIfDirty = useCallback(() => {
    return (
      !dirty ||
      confirm("Discard unsaved changes in the current blueprint?")
    );
  }, [dirty]);

  // Conflict-bar actions: load the on-disk version (discarding local
  // edits), or keep editing (the next Save overwrites the file).
  const handleConflictReload = useCallback(async () => {
    if (!conflictPath) return;
    const document = await loadDocument(conflictPath);
    setConflictPath(null);
    if (!document) return;
    lastSavedJsonRef.current = graphFileJson(document.file);
    setActiveDocumentPath(document.path);
    setDocumentName(document.name);
    setDirty(false);
    replaceEditorFile(document.file);
  }, [conflictPath, replaceEditorFile]);

  const handleConflictKeep = useCallback(() => {
    setConflictPath(null);
  }, []);

  const handleListDocuments = useCallback(async (): Promise<
    DocumentEntry[] | null
  > => {
    const documents = await listDocuments();
    setOnline(isConnected());
    return documents;
  }, []);

  const handleOpenDocument = useCallback(
    async (path: string): Promise<boolean> => {
      if (path === activeDocumentPath && !dirty) return true;
      if (!confirmDiscardIfDirty()) return false;

      const document = await loadDocument(path);
      setOnline(isConnected());
      if (!document) return false;

      lastSavedJsonRef.current = graphFileJson(document.file);
      setActiveDocumentPath(document.path);
      setDocumentName(document.name);
      saveActiveDocumentPath(document.path);
      setDirty(false);
      setConflictPath(null);
      replaceEditorFile(document.file);
      return true;
    },
    [activeDocumentPath, confirmDiscardIfDirty, dirty, replaceEditorFile],
  );

  const handleNewDocument = useCallback(() => {
    if (!confirmDiscardIfDirty()) return;
    const next = seedGraphFile();
    lastSavedJsonRef.current = graphFileJson(next);
    setActiveDocumentPath(null);
    setDocumentName("Untitled");
    saveActiveDocumentPath(null);
    setDirty(false);
    setConflictPath(null);
    replaceEditorFile(next);
  }, [confirmDiscardIfDirty, replaceEditorFile]);

  const handleSave = useCallback(async (): Promise<SaveResult> => {
    if (!activeDocumentPath) return "needs-path";
    const file = currentGraphFile();
    const saved = await saveDocument(activeDocumentPath, file);
    setOnline(isConnected());
    if (!saved) return "error";

    lastSavedJsonRef.current = graphFileJson(saved.file);
    setActiveDocumentPath(saved.path);
    setDocumentName(saved.name);
    saveActiveDocumentPath(saved.path);
    setGraphFile(saved.file);
    saveRecovery(saved.file);
    setDirty(false);
    setConflictPath(null);
    return "saved";
  }, [activeDocumentPath, currentGraphFile]);

  const handleSaveAs = useCallback(
    async (path: string, overwrite: boolean): Promise<SaveAsResult> => {
      const file = currentGraphFile();
      const saved = await createOrSaveAsDocument(path, file, overwrite);
      setOnline(isConnected());
      if (saved === "exists") return "exists";
      if (!saved) return "error";

      lastSavedJsonRef.current = graphFileJson(saved.file);
      setActiveDocumentPath(saved.path);
      setDocumentName(saved.name);
      saveActiveDocumentPath(saved.path);
      setGraphFile(saved.file);
      saveRecovery(saved.file);
      setDirty(false);
      setConflictPath(null);
      return "saved";
    },
    [currentGraphFile],
  );

  const handleReset = useCallback(() => {
    const message = dirty
      ? "Discard unsaved changes and reset to a fresh blueprint?"
      : "Reset to a fresh blueprint? This clears the current graph.";
    if (!confirm(message)) return;

    const next = seedGraphFile();
    if (!activeDocumentPath) {
      lastSavedJsonRef.current = graphFileJson(next);
    }
    replaceEditorFile(next);
  }, [activeDocumentPath, dirty, replaceEditorFile]);

  const handleImportFile = useCallback(
    (value: unknown): boolean => {
      const file = normalizeGraphFile(value);
      if (!file) return false;
      replaceEditorFile(file);
      return true;
    },
    [replaceEditorFile],
  );

  const onGraphSnapshot = useCallback((g: Graph) => {
    setGraphFile((prev) => ({ ...prev, nodes: g.nodes, edges: g.edges }));
  }, []);

  const onSelectionSnapshot = useCallback((s: Selection) => {
    setGraphFile((prev) => ({
      ...prev,
      ui: { ...prev.ui, selection: s },
    }));
  }, []);

  const onViewportSnapshot = useCallback((v: Viewport) => {
    lastUserViewportTs.current = Date.now();
    setGraphFile((prev) => ({
      ...prev,
      ui: { ...prev.ui, viewport: v },
    }));
  }, []);

  const onNotesChange = useCallback((notes: string) => {
    setGraphFile((prev) => ({ ...prev, notes }));
  }, []);

  const onToggleCollapse = useCallback((id: string) => {
    setGraphFile((prev) => {
      const cur = prev.ui.collapsed;
      const next = cur.includes(id)
        ? cur.filter((x) => x !== id)
        : [...cur, id];
      return { ...prev, ui: { ...prev.ui, collapsed: next } };
    });
  }, []);

  // Fetch the registry (workspace + built-in) once on mount. If no dev
  // server, fall back to the built-in default compiled into the client.
  useEffect(() => {
    let alive = true;
    fetchRegistry().then((r) => {
      if (!alive) return;
      setRegistryResp(r ?? { workspace: null, builtIn: defaultRegistry() });
    });
    return () => {
      alive = false;
    };
  }, []);

  const effectiveRegistry: Registry = useMemo(() => {
    const builtIn = registryResp?.builtIn ?? defaultRegistry();
    const workspace = registryResp?.workspace ?? null;
    return resolveRegistry(builtIn, workspace, graphFile.registry);
  }, [registryResp, graphFile.registry]);

  // Derive the current single-selected node / edge from graphFile.
  const selectedNodeId =
    graphFile.ui.selection.nodeIds.length === 1 &&
    graphFile.ui.selection.edgeIds.length === 0
      ? graphFile.ui.selection.nodeIds[0]
      : null;
  const selectedEdgeId =
    graphFile.ui.selection.edgeIds.length === 1 &&
    graphFile.ui.selection.nodeIds.length === 0
      ? graphFile.ui.selection.edgeIds[0]
      : null;
  const selectionCount =
    graphFile.ui.selection.nodeIds.length +
    graphFile.ui.selection.edgeIds.length;
  const selectedNode =
    selectedNodeId
      ? graphFile.nodes.find((n) => n.id === selectedNodeId) ?? null
      : null;
  const selectedEdge =
    selectedEdgeId
      ? graphFile.edges.find((e) => e.id === selectedEdgeId) ?? null
      : null;

  // Auto-switch tab on selection: 1 selected → Inspector, 0 → Notes,
  // 2+ → leave alone (user is doing multi-select).
  useEffect(() => {
    if (selectionCount === 1) setTab("inspector");
    else if (selectionCount === 0) setTab("notes");
  }, [selectionCount]);

  // Setters that go through MindMap's imperative handle so the canvas
  // updates immediately; the snapshot loop carries the change back into
  // graphFile for persistence.
  const setNodeData = useCallback(
    (id: string, patch: Partial<MindNodeData>) => {
      mapRef.current?.updateNodeData(id, patch);
    },
    [],
  );
  const setEdgeData = useCallback(
    (id: string, patch: Partial<MindEdgeData>) => {
      mapRef.current?.updateEdgeData(id, patch);
    },
    [],
  );

  const onSetNodeLabel = useCallback(
    (id: string, label: string) => setNodeData(id, { label }),
    [setNodeData],
  );

  const onSetNodeBody = useCallback(
    (id: string, body: string) => setNodeData(id, { body }),
    [setNodeData],
  );

  const onSetNodeType = useCallback(
    (id: string, typeId: string | undefined) => {
      const patch: Partial<MindNodeData> = { typeId };
      if (typeId) {
        // If the node's current status isn't valid for the new type, fall
        // back to the type's defaultStatus (or first status).
        const type = effectiveRegistry.nodeTypes[typeId];
        if (type) {
          const node = graphFile.nodes.find((n) => n.id === id);
          const cur = node?.data.statusId;
          const valid = cur && type.statuses.some((s) => s.id === cur);
          if (!valid) {
            patch.statusId = type.defaultStatus ?? type.statuses[0]?.id;
          }
        }
      } else {
        patch.statusId = undefined;
      }
      setNodeData(id, patch);
    },
    [effectiveRegistry, graphFile.nodes, setNodeData],
  );

  const onSetNodeStatus = useCallback(
    (id: string, statusId: string | undefined) =>
      setNodeData(id, { statusId }),
    [setNodeData],
  );

  const onSetEdgeType = useCallback(
    (id: string, typeId: string | undefined) => setEdgeData(id, { typeId }),
    [setEdgeData],
  );

  const onSetEdgeBody = useCallback(
    (id: string, body: string) => setEdgeData(id, { body }),
    [setEdgeData],
  );

  const nodeLabel = useCallback(
    (id: string): string =>
      graphFile.nodes.find((n) => n.id === id)?.data.label ?? id,
    [graphFile.nodes],
  );

  return (
    <div className="app">
      <Toolbar
        mapRef={mapRef}
        documentName={documentName}
        documentPath={activeDocumentPath}
        dirty={dirty}
        workspaceAvailable={online === true}
        onNewDocument={handleNewDocument}
        onListDocuments={handleListDocuments}
        onOpenDocument={handleOpenDocument}
        onSave={handleSave}
        onSaveAs={handleSaveAs}
        onReset={handleReset}
        onImportFile={handleImportFile}
        getCurrentFile={currentGraphFile}
      />
      {conflictPath !== null && (
        <div className="conflict-bar" role="alert">
          <span className="conflict-bar__text">
            "{documentName}" changed on disk while you have unsaved changes
            here.
          </span>
          <button onClick={handleConflictReload}>
            Load latest (discard my edits)
          </button>
          <button
            onClick={handleConflictKeep}
            title="Keep editing; your next Save overwrites the on-disk version"
          >
            Keep my edits
          </button>
        </div>
      )}
      <div className="app__body">
        <div className="canvas">
          <MindMap
            ref={mapRef}
            initialGraph={{
              nodes: initialFile.nodes,
              edges: initialFile.edges,
            }}
            onGraphSnapshot={onGraphSnapshot}
            onSelectionSnapshot={onSelectionSnapshot}
            onViewportSnapshot={onViewportSnapshot}
            collapsed={graphFile.ui.collapsed}
            onToggleCollapse={onToggleCollapse}
            registry={effectiveRegistry}
          />
        </div>
        <aside className="side">
          <div className="side__header">
            <div className="side__tabs">
              <button
                className={`side__tab${tab === "inspector" ? " side__tab--active" : ""}`}
                onClick={() => setTab("inspector")}
              >
                Inspector
              </button>
              <button
                className={`side__tab${tab === "notes" ? " side__tab--active" : ""}`}
                onClick={() => setTab("notes")}
              >
                Notes
              </button>
            </div>
            <div
              className={`side__status${
                online === false ? " side__status--off" : ""
              }`}
              title={
                online === true
                  ? "Connected to dev server - workspace files available"
                  : online === false
                    ? "No dev server file API - local-only"
                    : "Connecting..."
              }
            >
              {online === true ? "● live" : online === false ? "○ offline" : "..."}
            </div>
          </div>
          <div className="side__body">
            {tab === "inspector" ? (
              <Inspector
                selectedNode={selectedNode}
                selectedEdge={selectedEdge}
                selectionCount={selectionCount}
                registry={effectiveRegistry}
                nodeLabel={nodeLabel}
                onSetNodeLabel={onSetNodeLabel}
                onSetNodeType={onSetNodeType}
                onSetNodeStatus={onSetNodeStatus}
                onSetNodeBody={onSetNodeBody}
                onSetEdgeType={onSetEdgeType}
                onSetEdgeBody={onSetEdgeBody}
              />
            ) : (
              <NotesPanel notes={graphFile.notes} onChange={onNotesChange} />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
