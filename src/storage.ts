import { normalizeGraphFile, stripFileForPersist } from "./graphFile";
import type { GraphFile } from "./types";

const FILE_RECOVERY_KEY = "blueprint.file.v2";
const FILE_RECOVERY_DIRTY_KEY = "blueprint.fileDirty.v1";
const ACTIVE_DOCUMENT_KEY = "blueprint.activeDocument.v1";

export function saveRecovery(file: GraphFile, dirty = false): void {
  try {
    localStorage.setItem(
      FILE_RECOVERY_KEY,
      JSON.stringify(stripFileForPersist(file)),
    );
    localStorage.setItem(FILE_RECOVERY_DIRTY_KEY, dirty ? "1" : "0");
  } catch {
    // ignore quota errors
  }
}

// Whether the recovery snapshot was taken while the editor held unsaved
// changes. Distinguishes "worth offering to restore" from "stale copy of
// a document that was saved (and may have moved on) since".
export function loadRecoveryDirty(): boolean {
  try {
    return localStorage.getItem(FILE_RECOVERY_DIRTY_KEY) === "1";
  } catch {
    return false;
  }
}

export function loadRecovery(): GraphFile | null {
  try {
    const raw = localStorage.getItem(FILE_RECOVERY_KEY);
    if (!raw) return null;
    return normalizeGraphFile(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveActiveDocumentPath(path: string | null): void {
  try {
    if (path) {
      localStorage.setItem(ACTIVE_DOCUMENT_KEY, path);
    } else {
      localStorage.removeItem(ACTIVE_DOCUMENT_KEY);
    }
  } catch {
    // ignore quota errors
  }
}

export function loadActiveDocumentPath(): string | null {
  try {
    return localStorage.getItem(ACTIVE_DOCUMENT_KEY);
  } catch {
    return null;
  }
}

export function clear(): void {
  localStorage.removeItem(FILE_RECOVERY_KEY);
  localStorage.removeItem(FILE_RECOVERY_DIRTY_KEY);
  localStorage.removeItem(ACTIVE_DOCUMENT_KEY);
}

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  delay: number,
): (...args: A) => void {
  let t: ReturnType<typeof setTimeout> | null = null;
  return (...args: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}
