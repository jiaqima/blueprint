import type { Node, Edge } from "reactflow";

export type MindNodeData = {
  label: string;
  // Persisted: rich detail rendered in the Inspector.
  body?: string;
  // Persisted: which entry in registry.nodeTypes this node belongs to.
  typeId?: string;
  // Persisted: which status (within the node type's statuses) this node is in.
  statusId?: string;

  // Transient (not persisted): injected by MindMap so the custom node can
  // render the inline label-edit input.
  onLabelChange?: (id: string, label: string) => void;
  startEditingToken?: number;

  // Transient: injected by MindMap so the custom node can render the
  // collapse chevron.
  collapsed?: boolean;
  childCount?: number;
  hiddenDescendantCount?: number;
  onToggleCollapse?: (id: string) => void;

  // Transient: injected by MindMap so the custom node can render the
  // type icon and status tint.
  typeIcon?: string;
  typeColor?: string;
  statusColor?: string;
};

export type MindEdgeData = {
  // Persisted: which entry in registry.edgeTypes this edge belongs to.
  typeId?: string;
  // Persisted: rich detail rendered in the Inspector when the edge is selected.
  body?: string;
};

export type MindNode = Node<MindNodeData>;
export type MindEdge = Edge<MindEdgeData>;

export type Graph = {
  nodes: MindNode[];
  edges: MindEdge[];
};

export type Selection = {
  nodeIds: string[];
  edgeIds: string[];
};

export type Viewport = {
  x: number;
  y: number;
  zoom: number;
};

// Type / status / edge-type taxonomy. Resolution: per-doc registry override
// (GraphFile.registry) > workspace-level <workspace>/blueprint.types.toml >
// built-in default (defaultRegistry() in graphFile.ts).
export type StatusDef = {
  id: string;
  label: string;
  color?: string; // CSS — background tint on the node
};

export type NodeTypeDef = {
  label: string;
  color?: string; // CSS — border accent on the node
  icon?: string; // optional short glyph
  defaultStatus?: string; // status id new nodes of this type get
  statuses: StatusDef[];
};

export type EdgeTypeDef = {
  label: string;
  color?: string; // CSS — line color
  lineStyle?: "solid" | "dashed" | "dotted";
};

export type Registry = {
  nodeTypes: Record<string, NodeTypeDef>;
  edgeTypes: Record<string, EdgeTypeDef>;
};

// The full file shape persisted to <workspace>/<name>.json (and used over
// the API).
export type GraphFile = {
  nodes: MindNode[];
  edges: MindEdge[];
  notes: string;
  ui: {
    selection: Selection;
    viewport: Viewport;
    // Node ids whose children should be hidden in the editor.
    collapsed: string[];
  };
  // Optional per-doc registry override. If absent, the workspace registry
  // (or built-in default) applies.
  registry?: Registry;
};
