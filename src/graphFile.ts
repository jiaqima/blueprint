import type {
  EdgeTypeDef,
  Graph,
  GraphFile,
  MindEdge,
  MindEdgeData,
  MindNodeData,
  NodeTypeDef,
  Registry,
  Selection,
  StatusDef,
  Viewport,
} from "./types";

export function defaultUi(): GraphFile["ui"] {
  return {
    selection: { nodeIds: [], edgeIds: [] },
    viewport: { x: 0, y: 0, zoom: 1 },
    collapsed: [],
  };
}

// Built-in default registry. The shared baseline for the type/status/edge
// vocabulary. Used as the final fallback when neither a per-doc override
// nor a workspace-level blueprint.types.toml is present. Workspace contents
// (including blueprint.types.toml) are gitignored, so this default is the
// source of truth for new workspaces.
export function defaultRegistry(): Registry {
  return {
    nodeTypes: {
      claim: {
        label: "Claim",
        color: "#2563eb",
        icon: "❖",
        defaultStatus: "draft",
        statuses: [
          { id: "draft", label: "Draft", color: "#f3f4f6" },
          { id: "stated", label: "Stated", color: "#dbeafe" },
          { id: "supported", label: "Supported", color: "#d1fae5" },
        ],
      },
      evidence: {
        label: "Evidence",
        color: "#7c3aed",
        icon: "✦",
        defaultStatus: "missing",
        statuses: [
          { id: "missing", label: "Missing", color: "#fee2e2" },
          { id: "cited", label: "Cited", color: "#e0e7ff" },
          { id: "verified", label: "Verified", color: "#d1fae5" },
        ],
      },
      definition: {
        label: "Definition",
        color: "#0891b2",
        icon: "≡",
        defaultStatus: "draft",
        statuses: [
          { id: "draft", label: "Draft", color: "#cffafe" },
          { id: "stated", label: "Stated", color: "#a5f3fc" },
        ],
      },
      question: {
        label: "Question",
        color: "#ea580c",
        icon: "?",
        defaultStatus: "open",
        statuses: [
          { id: "open", label: "Open", color: "#fed7aa" },
          { id: "answered", label: "Answered", color: "#d1fae5" },
        ],
      },
      assumption: {
        label: "Assumption",
        color: "#475569",
        icon: "⊢",
        defaultStatus: "given",
        statuses: [
          { id: "given", label: "Given", color: "#e2e8f0" },
          { id: "questioned", label: "Questioned", color: "#fed7aa" },
        ],
      },
      risk: {
        label: "Risk",
        color: "#b91c1c",
        icon: "⚠",
        defaultStatus: "noted",
        statuses: [
          { id: "noted", label: "Noted", color: "#fee2e2" },
          { id: "addressed", label: "Addressed", color: "#d1fae5" },
          { id: "accepted", label: "Accepted", color: "#fef3c7" },
        ],
      },
      synthesis: {
        label: "Synthesis",
        color: "#6b7280",
        icon: "∧",
        defaultStatus: "draft",
        statuses: [
          { id: "draft", label: "Draft", color: "#f3f4f6" },
          { id: "stated", label: "Stated", color: "#dbeafe" },
        ],
      },
    },
    edgeTypes: {
      expands: { label: "Expands", color: "#94a3b8", lineStyle: "solid" },
      supports: { label: "Supports", color: "#16a34a", lineStyle: "solid" },
      contradicts: {
        label: "Contradicts",
        color: "#dc2626",
        lineStyle: "dashed",
      },
      relates: { label: "Relates", color: "#a3a3a3", lineStyle: "dotted" },
      addresses: { label: "Addresses", color: "#0d9488", lineStyle: "solid" },
    },
  };
}

export function seedGraphFile(): GraphFile {
  return {
    nodes: [
      {
        id: "root",
        type: "mind",
        position: { x: 0, y: 0 },
        data: { label: "My Paper" },
      },
    ],
    edges: [],
    notes: "",
    ui: defaultUi(),
  };
}

function normalizeSelection(value: unknown): Selection {
  if (!value || typeof value !== "object") return defaultUi().selection;
  const selection = value as Partial<Selection>;
  return {
    nodeIds: Array.isArray(selection.nodeIds)
      ? selection.nodeIds.filter((id): id is string => typeof id === "string")
      : [],
    edgeIds: Array.isArray(selection.edgeIds)
      ? selection.edgeIds.filter((id): id is string => typeof id === "string")
      : [],
  };
}

function normalizeViewport(value: unknown): Viewport {
  if (!value || typeof value !== "object") return defaultUi().viewport;
  const viewport = value as Partial<Viewport>;
  return {
    x: typeof viewport.x === "number" ? viewport.x : 0,
    y: typeof viewport.y === "number" ? viewport.y : 0,
    zoom: typeof viewport.zoom === "number" ? viewport.zoom : 1,
  };
}

function normalizeCollapsed(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === "string");
}

function stringOrUndef(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeNodeData(value: unknown): MindNodeData {
  if (!value || typeof value !== "object") return { label: "" };
  const v = value as Partial<MindNodeData>;
  const out: MindNodeData = { label: typeof v.label === "string" ? v.label : "" };
  if (typeof v.body === "string") out.body = v.body;
  if (typeof v.typeId === "string") out.typeId = v.typeId;
  if (typeof v.statusId === "string") out.statusId = v.statusId;
  return out;
}

function normalizeEdgeData(value: unknown): MindEdgeData | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Partial<MindEdgeData>;
  const out: MindEdgeData = {};
  if (typeof v.typeId === "string") out.typeId = v.typeId;
  if (typeof v.body === "string") out.body = v.body;
  if (Object.keys(out).length === 0) return undefined;
  return out;
}

function normalizeStatusDef(value: unknown): StatusDef | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<StatusDef>;
  if (typeof v.id !== "string" || !v.id) return null;
  return {
    id: v.id,
    label: typeof v.label === "string" ? v.label : v.id,
    color: stringOrUndef(v.color),
  };
}

function normalizeNodeTypeDef(value: unknown): NodeTypeDef | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<NodeTypeDef>;
  const statuses = Array.isArray(v.statuses)
    ? v.statuses
        .map(normalizeStatusDef)
        .filter((s): s is StatusDef => s !== null)
    : [];
  return {
    label: typeof v.label === "string" ? v.label : "Untitled",
    color: stringOrUndef(v.color),
    icon: stringOrUndef(v.icon),
    defaultStatus: stringOrUndef(v.defaultStatus),
    statuses,
  };
}

function normalizeEdgeTypeDef(value: unknown): EdgeTypeDef | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<EdgeTypeDef>;
  const lineStyle =
    v.lineStyle === "dashed" || v.lineStyle === "dotted" ? v.lineStyle : "solid";
  return {
    label: typeof v.label === "string" ? v.label : "Untitled",
    color: stringOrUndef(v.color),
    lineStyle,
  };
}

export function normalizeRegistry(value: unknown): Registry | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<Registry>;
  const nodeTypes: Record<string, NodeTypeDef> = {};
  if (v.nodeTypes && typeof v.nodeTypes === "object") {
    for (const [id, def] of Object.entries(v.nodeTypes)) {
      const normalized = normalizeNodeTypeDef(def);
      if (normalized) nodeTypes[id] = normalized;
    }
  }
  const edgeTypes: Record<string, EdgeTypeDef> = {};
  if (v.edgeTypes && typeof v.edgeTypes === "object") {
    for (const [id, def] of Object.entries(v.edgeTypes)) {
      const normalized = normalizeEdgeTypeDef(def);
      if (normalized) edgeTypes[id] = normalized;
    }
  }
  return { nodeTypes, edgeTypes };
}

export function normalizeGraphFile(value: unknown): GraphFile | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<GraphFile>;
  if (!Array.isArray(candidate.nodes) || !Array.isArray(candidate.edges)) {
    return null;
  }

  const registry = normalizeRegistry(candidate.registry);

  return {
    nodes: candidate.nodes.map((n) => ({
      ...n,
      data: normalizeNodeData(n.data),
    })),
    edges: candidate.edges.map((e) => {
      const data = normalizeEdgeData(e.data);
      const normalized = { ...e };
      if (data) normalized.data = data;
      else delete (normalized as { data?: unknown }).data;
      return normalized;
    }),
    notes: typeof candidate.notes === "string" ? candidate.notes : "",
    ui: {
      selection: normalizeSelection(candidate.ui?.selection),
      viewport: normalizeViewport(candidate.ui?.viewport),
      collapsed: normalizeCollapsed(candidate.ui?.collapsed),
    },
    ...(registry ? { registry } : {}),
  };
}

export function stripGraphForPersist(graph: Graph): Graph {
  return {
    nodes: graph.nodes.map((n) => {
      const data: MindNodeData = { label: n.data?.label ?? "" };
      if (n.data?.body !== undefined) data.body = n.data.body;
      if (n.data?.typeId !== undefined) data.typeId = n.data.typeId;
      if (n.data?.statusId !== undefined) data.statusId = n.data.statusId;
      return {
        ...n,
        data,
        selected: undefined,
        dragging: undefined,
      };
    }),
    edges: graph.edges.map((e) => {
      const data: MindEdgeData = {};
      if (e.data?.typeId !== undefined) data.typeId = e.data.typeId;
      if (e.data?.body !== undefined) data.body = e.data.body;
      const cleaned: MindEdge = { ...e, selected: undefined };
      if (Object.keys(data).length > 0) cleaned.data = data;
      else delete (cleaned as { data?: unknown }).data;
      return cleaned;
    }),
  };
}

export function stripFileForPersist(file: GraphFile): GraphFile {
  const graph = stripGraphForPersist(file);
  return {
    nodes: graph.nodes,
    edges: graph.edges,
    notes: file.notes,
    ui: file.ui,
    ...(file.registry ? { registry: file.registry } : {}),
  };
}

export function graphFileJson(file: GraphFile): string {
  return JSON.stringify(stripFileForPersist(file));
}

