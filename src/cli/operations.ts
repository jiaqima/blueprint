import path from "node:path";
import {
  defaultRegistry,
  normalizeGraphFile,
  seedGraphFile,
  stripFileForPersist,
} from "../graphFile";
import { nextNodeId } from "../idgen";
import { parseMarkdownOutline } from "../markdown";
import { isWorkspaceToolFile } from "../server/workspace";
import type {
  GraphFile,
  MindEdge,
  MindNode,
  Registry,
} from "../types";

export class CliError extends Error {}

export const DOCUMENTS_DIR = "blueprints";

function nextEdgeId(source: string, target: string): string {
  return `e_${source}_${target}`;
}

function newNode(
  file: GraphFile,
  label: string,
  options: { body?: string } = {},
): MindNode {
  const data: { label: string; body?: string } = { label };
  if (options.body !== undefined) data.body = options.body;
  return {
    id: nextNodeId(new Set(file.nodes.map((n) => n.id))),
    type: "mind",
    position: { x: 0, y: 0 },
    data,
  };
}

// Resolve a user-supplied document name or path to a workspace path of the
// form `blueprints/<name>.json`. Mirrors the dev-server's path validation.
export function resolveDocumentPath(input: string): string {
  let raw = input.trim().replace(/\\/g, "/");
  if (!raw) throw new CliError("missing document name");
  if (raw.includes("\0") || raw.includes("..")) {
    throw new CliError(`invalid document name: "${input}"`);
  }
  if (path.posix.isAbsolute(raw)) {
    throw new CliError(`document path must be relative: "${input}"`);
  }
  if (raw.startsWith(`${DOCUMENTS_DIR}/`)) raw = raw.slice(DOCUMENTS_DIR.length + 1);
  if (raw.includes("/")) {
    throw new CliError(`document path must be a single name under ${DOCUMENTS_DIR}/: "${input}"`);
  }
  if (!raw.endsWith(".json")) raw += ".json";
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]*\.json$/.test(raw)) {
    throw new CliError(`invalid document name: "${input}"`);
  }
  if (isWorkspaceToolFile(raw)) {
    throw new CliError(
      `"${raw}" is the workspace registry, not a document — use \`blueprint registry\``,
    );
  }
  return path.posix.join(DOCUMENTS_DIR, raw);
}

export type NodeRef = string;

// Resolve a ref to a node. Tiers, in order:
//   1. system id (e.g. "n_xyz_3") — exact
//   2. label — exact
//   3. label — case-insensitive substring
export function findNode(file: GraphFile, ref: NodeRef): MindNode {
  const byId = file.nodes.find((n) => n.id === ref);
  if (byId) return byId;

  const exactLabel = file.nodes.filter((n) => n.data.label === ref);
  if (exactLabel.length === 1) return exactLabel[0];
  if (exactLabel.length > 1) {
    throw new CliError(
      `multiple nodes with label "${ref}":\n` +
        exactLabel.map((n) => `  ${n.id}: "${n.data.label}"`).join("\n"),
    );
  }

  const lower = ref.toLowerCase();
  const partial = file.nodes.filter((n) =>
    n.data.label.toLowerCase().includes(lower),
  );
  if (partial.length === 1) return partial[0];
  if (partial.length === 0) {
    throw new CliError(`no node matches "${ref}"`);
  }
  throw new CliError(
    `ambiguous label "${ref}", matches:\n` +
      partial.map((n) => `  ${n.id}: "${n.data.label}"`).join("\n"),
  );
}

export function addChild(
  file: GraphFile,
  parentRef: NodeRef,
  label: string,
  options: { body?: string } = {},
): { file: GraphFile; node: MindNode } {
  const parent = findNode(file, parentRef);
  const node = newNode(file, label, options);
  const edge: MindEdge = {
    id: nextEdgeId(parent.id, node.id),
    source: parent.id,
    target: node.id,
  };
  return {
    file: { ...file, nodes: [...file.nodes, node], edges: [...file.edges, edge] },
    node,
  };
}

export function addSibling(
  file: GraphFile,
  ofRef: NodeRef,
  label: string,
  options: { body?: string } = {},
): { file: GraphFile; node: MindNode } {
  const sibling = findNode(file, ofRef);
  const parents = file.edges
    .filter((e) => e.target === sibling.id)
    .map((e) => e.source);

  if (parents.length === 0) {
    // No parents (root) — fall back to adding a child of the selected node.
    return addChild(file, sibling.id, label, options);
  }
  const node = newNode(file, label, options);
  const newEdges = parents.map((p) => ({
    id: nextEdgeId(p, node.id),
    source: p,
    target: node.id,
  }));
  return {
    file: {
      ...file,
      nodes: [...file.nodes, node],
      edges: [...file.edges, ...newEdges],
    },
    node,
  };
}

// Set or append the label (short title shown on the canvas) of a node.
// Mirrors the shape of setNodeBody / setEdgeBody.
export function setNodeLabel(
  file: GraphFile,
  ref: NodeRef,
  text: string,
  options: { append?: boolean } = {},
): GraphFile {
  const node = findNode(file, ref);
  const next = options.append ? `${node.data.label}${text}` : text;
  return {
    ...file,
    nodes: file.nodes.map((n) =>
      n.id === node.id ? { ...n, data: { ...n.data, label: next } } : n,
    ),
  };
}

// Backward-compatible alias for setNodeLabel(..., { append: false }).
export function rename(
  file: GraphFile,
  ref: NodeRef,
  newLabel: string,
): GraphFile {
  return setNodeLabel(file, ref, newLabel);
}

export function deleteNode(
  file: GraphFile,
  ref: NodeRef,
  options: { subtree?: boolean } = {},
): { file: GraphFile; removed: string[] } {
  const node = findNode(file, ref);
  const removed = new Set<string>([node.id]);

  if (options.subtree) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of file.nodes) {
        if (removed.has(n.id)) continue;
        const incoming = file.edges.filter((e) => e.target === n.id);
        if (incoming.length === 0) continue;
        if (incoming.every((e) => removed.has(e.source))) {
          removed.add(n.id);
          changed = true;
        }
      }
    }
  }

  return {
    file: {
      ...file,
      nodes: file.nodes.filter((n) => !removed.has(n.id)),
      edges: file.edges.filter(
        (e) => !removed.has(e.source) && !removed.has(e.target),
      ),
      ui: {
        ...file.ui,
        collapsed: file.ui.collapsed.filter((id) => !removed.has(id)),
      },
    },
    removed: [...removed],
  };
}

export function move(
  file: GraphFile,
  ref: NodeRef,
  newParentRef: NodeRef,
): GraphFile {
  const node = findNode(file, ref);
  const newParent = findNode(file, newParentRef);
  if (node.id === newParent.id) {
    throw new CliError("cannot reparent a node to itself");
  }
  const remainingEdges = file.edges.filter((e) => e.target !== node.id);
  if (
    !remainingEdges.some(
      (e) => e.source === newParent.id && e.target === node.id,
    )
  ) {
    remainingEdges.push({
      id: nextEdgeId(newParent.id, node.id),
      source: newParent.id,
      target: node.id,
    });
  }
  return { ...file, edges: remainingEdges };
}

export function link(
  file: GraphFile,
  sourceRef: NodeRef,
  targetRef: NodeRef,
): GraphFile {
  const source = findNode(file, sourceRef);
  const target = findNode(file, targetRef);
  if (source.id === target.id) {
    throw new CliError("cannot link a node to itself");
  }
  if (
    file.edges.some((e) => e.source === source.id && e.target === target.id)
  ) {
    return file;
  }
  return {
    ...file,
    edges: [
      ...file.edges,
      {
        id: nextEdgeId(source.id, target.id),
        source: source.id,
        target: target.id,
      },
    ],
  };
}

export function unlink(
  file: GraphFile,
  sourceRef: NodeRef,
  targetRef: NodeRef,
): GraphFile {
  const source = findNode(file, sourceRef);
  const target = findNode(file, targetRef);
  return {
    ...file,
    edges: file.edges.filter(
      (e) => !(e.source === source.id && e.target === target.id),
    ),
  };
}

export function setNotes(
  file: GraphFile,
  text: string,
  options: { append?: boolean } = {},
): GraphFile {
  if (!options.append) return { ...file, notes: text };
  const sep = file.notes.length > 0 && !file.notes.endsWith("\n") ? "\n" : "";
  return { ...file, notes: `${file.notes}${sep}${text}` };
}

// Find the edge connecting source → target. Throws if missing or ambiguous
// (in normal use there's at most one edge per source/target pair).
export function findEdge(
  file: GraphFile,
  sourceRef: NodeRef,
  targetRef: NodeRef,
): MindEdge {
  const source = findNode(file, sourceRef);
  const target = findNode(file, targetRef);
  const matches = file.edges.filter(
    (e) => e.source === source.id && e.target === target.id,
  );
  if (matches.length === 0) {
    throw new CliError(`no edge from "${sourceRef}" to "${targetRef}"`);
  }
  if (matches.length > 1) {
    throw new CliError(
      `multiple edges from "${sourceRef}" to "${targetRef}": ${matches
        .map((e) => e.id)
        .join(", ")}`,
    );
  }
  return matches[0];
}

// Resolve the effective registry for a doc. Per-doc override > workspace
// (passed in) > built-in default.
export function effectiveRegistry(
  file: GraphFile,
  workspace: Registry | null,
): Registry {
  if (file.registry) return file.registry;
  if (workspace) return workspace;
  return defaultRegistry();
}

function nodeTypeOrThrow(registry: Registry, typeId: string) {
  const t = registry.nodeTypes[typeId];
  if (!t) {
    throw new CliError(
      `unknown node type "${typeId}". Known: ${
        Object.keys(registry.nodeTypes).join(", ") || "(none)"
      }`,
    );
  }
  return t;
}

function edgeTypeOrThrow(registry: Registry, typeId: string) {
  const t = registry.edgeTypes[typeId];
  if (!t) {
    throw new CliError(
      `unknown edge type "${typeId}". Known: ${
        Object.keys(registry.edgeTypes).join(", ") || "(none)"
      }`,
    );
  }
  return t;
}

export function setNodeType(
  file: GraphFile,
  ref: NodeRef,
  typeId: string,
  registry: Registry,
): GraphFile {
  const node = findNode(file, ref);
  const type = nodeTypeOrThrow(registry, typeId);
  const cur = node.data.statusId;
  const valid = cur && type.statuses.some((s) => s.id === cur);
  const nextStatus = valid
    ? cur
    : type.defaultStatus ?? type.statuses[0]?.id;
  return {
    ...file,
    nodes: file.nodes.map((n) =>
      n.id === node.id
        ? {
            ...n,
            data: { ...n.data, typeId, statusId: nextStatus },
          }
        : n,
    ),
  };
}

export function setNodeStatus(
  file: GraphFile,
  ref: NodeRef,
  statusId: string,
  registry: Registry,
): GraphFile {
  const node = findNode(file, ref);
  if (!node.data.typeId) {
    throw new CliError(
      `cannot set status on "${ref}": it has no type. Set a type first with 'settype'.`,
    );
  }
  const type = nodeTypeOrThrow(registry, node.data.typeId);
  if (!type.statuses.some((s) => s.id === statusId)) {
    throw new CliError(
      `unknown status "${statusId}" for type "${node.data.typeId}". Known: ${type.statuses
        .map((s) => s.id)
        .join(", ")}`,
    );
  }
  return {
    ...file,
    nodes: file.nodes.map((n) =>
      n.id === node.id ? { ...n, data: { ...n.data, statusId } } : n,
    ),
  };
}

export function setNodeBody(
  file: GraphFile,
  ref: NodeRef,
  text: string,
  options: { append?: boolean } = {},
): GraphFile {
  const node = findNode(file, ref);
  const cur = node.data.body ?? "";
  const next = options.append
    ? `${cur}${cur && !cur.endsWith("\n") ? "\n" : ""}${text}`
    : text;
  return {
    ...file,
    nodes: file.nodes.map((n) =>
      n.id === node.id ? { ...n, data: { ...n.data, body: next } } : n,
    ),
  };
}

export function setEdgeType(
  file: GraphFile,
  sourceRef: NodeRef,
  targetRef: NodeRef,
  typeId: string,
  registry: Registry,
): GraphFile {
  const edge = findEdge(file, sourceRef, targetRef);
  edgeTypeOrThrow(registry, typeId);
  return {
    ...file,
    edges: file.edges.map((e) =>
      e.id === edge.id ? { ...e, data: { ...(e.data ?? {}), typeId } } : e,
    ),
  };
}

export function setEdgeBody(
  file: GraphFile,
  sourceRef: NodeRef,
  targetRef: NodeRef,
  text: string,
  options: { append?: boolean } = {},
): GraphFile {
  const edge = findEdge(file, sourceRef, targetRef);
  const cur = edge.data?.body ?? "";
  const next = options.append
    ? `${cur}${cur && !cur.endsWith("\n") ? "\n" : ""}${text}`
    : text;
  return {
    ...file,
    edges: file.edges.map((e) =>
      e.id === edge.id ? { ...e, data: { ...(e.data ?? {}), body: next } } : e,
    ),
  };
}

// Bundle multiple parents (evidence and/or claims) under a single
// "synthesis" node that supports the downstream claim. Reach for this
// when a claim only holds when several parents hold together and the
// joint argument doesn't fit on a single edge body.
//
// By default, existing `supports` edges from each parent to the claim
// are *rewired* through the synthesis (their bodies ride along onto the
// new parent → synthesis edges). Pass `keep: true` to preserve the
// originals in addition.
export function synthesize(
  file: GraphFile,
  parentClaimRef: NodeRef,
  parentRefs: NodeRef[],
  options: {
    label: string;
    typeId?: string;
    body?: string;
    keep?: boolean;
    registry: Registry;
  },
): { file: GraphFile; node: MindNode } {
  if (parentRefs.length === 0) {
    throw new CliError("synthesize needs at least one parent ref");
  }

  const target = findNode(file, parentClaimRef);
  const parents: MindNode[] = [];
  const seen = new Set<string>();
  for (const ref of parentRefs) {
    const n = findNode(file, ref);
    if (seen.has(n.id)) {
      throw new CliError(
        `parent "${ref}" is listed more than once (resolves to ${n.id})`,
      );
    }
    seen.add(n.id);
    parents.push(n);
  }

  const synth = newNode(file, options.label, { body: options.body });

  // Rewire supports edges from each parent to the target, capturing any
  // existing edge body so it rides along onto the new parent → synthesis
  // edge. With `keep`, leave originals alone.
  const removedEdgeIds = new Set<string>();
  const carriedBodyByParent = new Map<string, string | undefined>();
  if (!options.keep) {
    for (const e of file.edges) {
      if (
        e.source === target.id // shouldn't happen — but defensive
      ) {
        continue;
      }
      if (e.target !== target.id) continue;
      if (e.data?.typeId !== "supports") continue;
      if (!seen.has(e.source)) continue;
      removedEdgeIds.add(e.id);
      carriedBodyByParent.set(e.source, e.data?.body);
    }
  }

  const newEdges: MindEdge[] = parents.map((p) => {
    const body = carriedBodyByParent.get(p.id);
    const data: { typeId: string; body?: string } = { typeId: "supports" };
    if (body !== undefined) data.body = body;
    return {
      id: nextEdgeId(p.id, synth.id),
      source: p.id,
      target: synth.id,
      data,
    };
  });
  newEdges.push({
    id: nextEdgeId(synth.id, target.id),
    source: synth.id,
    target: target.id,
    data: { typeId: "supports" },
  });

  let result: GraphFile = {
    ...file,
    nodes: [...file.nodes, synth],
    edges: [
      ...file.edges.filter((e) => !removedEdgeIds.has(e.id)),
      ...newEdges,
    ],
  };

  // Apply the type (default: synthesis). setNodeType picks up the type's
  // defaultStatus, so a fresh synthesis lands as `draft`.
  result = setNodeType(
    result,
    synth.id,
    options.typeId ?? "synthesis",
    options.registry,
  );

  return { file: result, node: synth };
}

export function importMarkdown(file: GraphFile, markdown: string): GraphFile {
  const parsed = parseMarkdownOutline(markdown);
  if (parsed.nodes.length === 0) {
    throw new CliError("no headings or bullets found in the markdown");
  }
  return { ...file, nodes: parsed.nodes, edges: parsed.edges };
}

export type FindMatch = { id: string; label: string };

export function find(file: GraphFile, query: string): FindMatch[] {
  const q = query.toLowerCase();
  return file.nodes
    .filter((n) => n.data.label.toLowerCase().includes(q))
    .map((n) => ({ id: n.id, label: n.data.label }));
}

// Indented outline: roots first, then children. Repeated nodes (multi-parent)
// are tagged so the agent can see they're shared.
export function outline(file: GraphFile, registry?: Registry): string {
  const childrenById = new Map<string, string[]>();
  for (const e of file.edges) {
    if (!childrenById.has(e.source)) childrenById.set(e.source, []);
    childrenById.get(e.source)!.push(e.target);
  }
  const targetSet = new Set(file.edges.map((e) => e.target));
  const roots = file.nodes.filter((n) => !targetSet.has(n.id));
  const nodeById = new Map(file.nodes.map((n) => [n.id, n]));
  const lines: string[] = [];
  const visited = new Set<string>();

  function tag(node: MindNode): string {
    const t = node.data.typeId;
    const s = node.data.statusId;
    if (!t && !s) return "";
    const typeLabel =
      registry?.nodeTypes[t ?? ""]?.label ?? t ?? "";
    const statusLabel = (() => {
      if (!s) return "";
      const type = registry?.nodeTypes[t ?? ""];
      const status = type?.statuses.find((x) => x.id === s);
      return status?.label ?? s;
    })();
    const parts = [typeLabel, statusLabel].filter(Boolean);
    return parts.length > 0 ? `  [${parts.join(" · ")}]` : "";
  }

  function walk(id: string, depth: number) {
    const seenBefore = visited.has(id);
    visited.add(id);
    const indent = "  ".repeat(depth);
    const node = nodeById.get(id);
    const label = node?.data.label ?? id;
    const sharedTag = seenBefore ? "  [shared/cycle]" : "";
    const typeTag = node ? tag(node) : "";
    lines.push(`${indent}- ${label}  (${id})${typeTag}${sharedTag}`);
    if (seenBefore) return;
    for (const child of childrenById.get(id) ?? []) {
      walk(child, depth + 1);
    }
  }

  if (roots.length === 0 && file.nodes.length > 0) {
    lines.push("(no clear root — every node has at least one incoming edge)");
  }
  for (const r of roots) walk(r.id, 0);
  for (const n of file.nodes) {
    if (!visited.has(n.id)) {
      lines.push("(orphan)");
      walk(n.id, 0);
    }
  }
  return lines.join("\n");
}

export {
  defaultRegistry,
  normalizeGraphFile,
  seedGraphFile,
  stripFileForPersist,
};
