import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type RefObject,
} from "react";
import type { MindMapHandle } from "./MindMap";
import { parseMarkdownOutline } from "./markdown";
import { SettingsModal } from "./SettingsModal";
import type { DocumentEntry } from "./sync";
import type { GraphFile } from "./types";

type Props = {
  mapRef: RefObject<MindMapHandle | null>;
  documentName: string;
  documentPath: string | null;
  dirty: boolean;
  workspaceAvailable: boolean;
  onNewDocument: () => void;
  onListDocuments: () => Promise<DocumentEntry[] | null>;
  onOpenDocument: (path: string) => Promise<boolean>;
  onSave: () => Promise<"saved" | "needs-path" | "error">;
  onSaveAs: (
    path: string,
    overwrite: boolean,
  ) => Promise<"saved" | "exists" | "error">;
  onReset: () => void;
  onImportFile: (value: unknown) => boolean;
  getCurrentFile: () => GraphFile;
};

function normalizeSaveAsPath(value: string): string | null {
  let filename = value.trim();
  if (!filename) return null;
  if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
    return null;
  }
  if (!filename.endsWith(".json")) filename = `${filename}.json`;
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]*\.json$/.test(filename)) {
    return null;
  }
  return `blueprints/${filename}`;
}

export function Toolbar({
  mapRef,
  documentName,
  documentPath,
  dirty,
  workspaceAvailable,
  onNewDocument,
  onListDocuments,
  onOpenDocument,
  onSave,
  onSaveAs,
  onReset,
  onImportFile,
  getCurrentFile,
}: Props) {
  const [showImport, setShowImport] = useState(false);
  const [showOpen, setShowOpen] = useState(false);
  const [showSaveAs, setShowSaveAs] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [documents, setDocuments] = useState<DocumentEntry[]>([]);
  const [openLoading, setOpenLoading] = useState(false);
  const [openError, setOpenError] = useState("");
  const [saveAsName, setSaveAsName] = useState("");
  const [saveAsError, setSaveAsError] = useState("");
  const [saving, setSaving] = useState(false);
  const [mdText, setMdText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const workspaceTitle = workspaceAvailable
    ? undefined
    : "Start the Vite dev server to use workspace files.";

  const openSaveAsModal = useCallback(() => {
    setSaveAsName(documentName === "Untitled" ? "" : `${documentName}.json`);
    setSaveAsError("");
    setShowSaveAs(true);
  }, [documentName]);

  const openDocumentsModal = async () => {
    if (!workspaceAvailable) return;
    setShowOpen(true);
    setOpenLoading(true);
    setOpenError("");
    const list = await onListDocuments();
    setOpenLoading(false);
    if (!list) {
      setOpenError("Could not read blueprints/ from the dev server.");
      setDocuments([]);
      return;
    }
    setDocuments(list);
  };

  const save = useCallback(async () => {
    if (!workspaceAvailable || saving) return;
    setSaving(true);
    const result = await onSave();
    setSaving(false);
    if (result === "needs-path") {
      openSaveAsModal();
    } else if (result === "error") {
      alert("Could not save the active blueprint.");
    }
  }, [onSave, openSaveAsModal, saving, workspaceAvailable]);

  const saveAs = useCallback(async (overwrite = false) => {
    if (!workspaceAvailable || saving) return;
    const path = normalizeSaveAsPath(saveAsName);
    if (!path) {
      setSaveAsError(
        "Use a simple JSON filename, for example alpha.json.",
      );
      return;
    }

    const runSaveAs = async (shouldOverwrite: boolean) => {
      setSaving(true);
      try {
        return await onSaveAs(path, shouldOverwrite);
      } finally {
        setSaving(false);
      }
    };

    const result = await runSaveAs(overwrite);

    if (result === "exists") {
      if (confirm(`${path} already exists. Overwrite it?`)) {
        const overwriteResult = await runSaveAs(true);
        if (overwriteResult === "error" || overwriteResult === "exists") {
          setSaveAsError("Could not save that file.");
          return;
        }
        setShowSaveAs(false);
      }
      return;
    }
    if (result === "error") {
      setSaveAsError("Could not save that file.");
      return;
    }
    setShowSaveAs(false);
  }, [onSaveAs, saveAsName, saving, workspaceAvailable]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isSaveShortcut =
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "s";

      if (!isSaveShortcut) return;

      event.preventDefault();
      if (showSaveAs) {
        void saveAs(false);
      } else {
        void save();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [save, saveAs, showSaveAs]);

  const exportJson = () => {
    const file = getCurrentFile();
    const blob = new Blob([JSON.stringify(file, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = documentName === "Untitled" ? "blueprint.json" : `${documentName}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onFileChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!onImportFile(parsed)) throw new Error("invalid graph");
    } catch {
      alert("Could not load that file as a blueprint JSON.");
    }
  };

  const importMarkdown = () => {
    const graph = parseMarkdownOutline(mdText);
    if (graph.nodes.length === 0) {
      alert("No headings or bullets found in that text.");
      return;
    }
    mapRef.current?.loadGraph(graph);
    setShowImport(false);
    setMdText("");
  };

  const openDocument = async (path: string) => {
    const ok = await onOpenDocument(path);
    if (ok) {
      setShowOpen(false);
    } else {
      alert("Could not open that blueprint.");
    }
  };

  return (
    <div className="toolbar">
      <div className="toolbar__group toolbar__group--file">
        <button onClick={onNewDocument}>New</button>
        <button
          onClick={openDocumentsModal}
          disabled={!workspaceAvailable}
          title={workspaceTitle}
        >
          Open
        </button>
        <button onClick={save} disabled={!workspaceAvailable || saving} title={workspaceTitle}>
          Save
        </button>
        <button
          onClick={openSaveAsModal}
          disabled={!workspaceAvailable || saving}
          title={workspaceTitle}
        >
          Save As
        </button>
        <button
          className="toolbar__icon"
          onClick={() => setShowSettings(true)}
          title="Workspace settings"
          aria-label="Workspace settings"
        >
          ⚙
        </button>
        <div className="toolbar__document" title={documentPath ?? "Not saved"}>
          <span className="toolbar__document-name">{documentName}</span>
          <span
            className={`toolbar__document-state${
              dirty || !documentPath ? " toolbar__document-state--dirty" : ""
            }`}
          >
            {documentPath ? (dirty ? "unsaved" : "saved") : "not saved"}
          </span>
        </div>
      </div>

      <div className="toolbar__group">
        <button onClick={() => mapRef.current?.addChild()}>
          + Child <kbd>Tab</kbd>
        </button>
        <button onClick={() => mapRef.current?.addSibling()}>
          + Sibling <kbd>Enter</kbd>
        </button>
        <button
          onClick={() => mapRef.current?.addRoot()}
          title="Add an unconnected node (no parent edge)"
        >
          + Root
        </button>
        <button onClick={() => mapRef.current?.deleteSelected()}>
          Delete <kbd>Del</kbd>
        </button>
        <button onClick={() => mapRef.current?.deleteSubtreeSelected()}>
          Delete subtree <kbd>Shift</kbd>+<kbd>Del</kbd>
        </button>
        <button onClick={() => mapRef.current?.renameSelected()}>
          Rename <kbd>F2</kbd>
        </button>
        <button onClick={() => mapRef.current?.relayout()}>Re-layout</button>
      </div>
      <div className="toolbar__group">
        <button onClick={() => setShowImport(true)}>Import Markdown</button>
        <button onClick={() => fileInputRef.current?.click()}>
          Import JSON
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={onFileChosen}
        />
        <button onClick={exportJson}>Export JSON</button>
        <button onClick={onReset}>Reset</button>
      </div>

      {showOpen && (
        <div className="modal" onClick={() => setShowOpen(false)}>
          <div className="modal__panel" onClick={(e) => e.stopPropagation()}>
            <h3>Open a blueprint</h3>
            <p className="modal__hint">
              Choose a JSON document from <code>blueprints/</code>.
            </p>
            <div className="modal__list">
              {openLoading && <div className="modal__empty">Loading...</div>}
              {!openLoading && openError && (
                <div className="modal__empty">{openError}</div>
              )}
              {!openLoading && !openError && documents.length === 0 && (
                <div className="modal__empty">No blueprints saved yet.</div>
              )}
              {!openLoading &&
                !openError &&
                documents.map((document) => (
                  <button
                    key={document.path}
                    className={`modal__list-item${
                      document.path === documentPath
                        ? " modal__list-item--active"
                        : ""
                    }`}
                    onClick={() => openDocument(document.path)}
                  >
                    <span>{document.name}</span>
                    <code>{document.path}</code>
                  </button>
                ))}
            </div>
            <div className="modal__actions">
              <button onClick={() => setShowOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {showSaveAs && (
        <div className="modal" onClick={() => setShowSaveAs(false)}>
          <div className="modal__panel" onClick={(e) => e.stopPropagation()}>
            <h3>Save blueprint as</h3>
            <p className="modal__hint">
              Files are written to <code>blueprints/</code> and must use the
              <code>.json</code> extension.
            </p>
            <input
              className="modal__input"
              autoFocus
              value={saveAsName}
              onChange={(e) => {
                setSaveAsName(e.target.value);
                setSaveAsError("");
              }}
              placeholder="alpha.json"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void saveAs(false);
                }
              }}
            />
            {saveAsError && <div className="modal__error">{saveAsError}</div>}
            <div className="modal__actions">
              <button onClick={() => setShowSaveAs(false)}>Cancel</button>
              <button
                onClick={() => void saveAs(false)}
                disabled={saving}
                className="primary"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {showImport && (
        <div className="modal" onClick={() => setShowImport(false)}>
          <div className="modal__panel" onClick={(e) => e.stopPropagation()}>
            <h3>Paste a Markdown outline</h3>
            <p className="modal__hint">
              Use <code>#</code>/<code>##</code> headings, or <code>-</code>/
              <code>*</code> bullets with indentation. Mixed is fine.
            </p>
            <textarea
              autoFocus
              value={mdText}
              onChange={(e) => setMdText(e.target.value)}
              placeholder={"# Paper Title\n## Introduction\n- Motivation\n- Contributions\n## Method\n## Results"}
              rows={14}
            />
            <div className="modal__actions">
              <button onClick={() => setShowImport(false)}>Cancel</button>
              <button onClick={importMarkdown} className="primary">
                Build blueprint
              </button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
