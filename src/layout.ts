import dagre from "dagre";
import { Position } from "reactflow";
import type { MindNode, MindEdge } from "./types";

export const NODE_WIDTH = 180;
export const NODE_HEIGHT = 44;

// Dagre spacing within a single connected component.
const NODE_SEP = 60;
const RANK_SEP = 120;
// Horizontal gap between independently-laid-out components.
const COMPONENT_GAP = 120;

// Lay out the graph with dagre. When the graph has multiple connected
// components (treating edges as undirected for the connectivity check),
// each component is laid out independently and the components are
// packed left-to-right with a fixed gap. This keeps disconnected
// subgraphs from colliding the way a single dagre call would.
export function layoutWithDagre(
  nodes: MindNode[],
  edges: MindEdge[],
  direction: "LR" | "TB" = "TB",
): MindNode[] {
  if (nodes.length === 0) return nodes;

  const components = findConnectedComponents(nodes, edges);

  // Map each component to its laid-out node-position pairs.
  const positionById = new Map<string, { x: number; y: number }>();
  let cursorX = 0;

  for (const component of components) {
    const subNodes = nodes.filter((n) => component.has(n.id));
    const subEdges = edges.filter(
      (e) => component.has(e.source) && component.has(e.target),
    );
    const laidOut = dagreLayoutComponent(subNodes, subEdges, direction);

    // Bounding box of this component, in dagre's local coordinates.
    let minX = Infinity;
    let maxX = -Infinity;
    for (const { x } of laidOut.values()) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
    // Account for node width — laidOut x is the left edge.
    const width = maxX - minX + NODE_WIDTH;

    // Shift this component so its leftmost node lands at cursorX.
    const shiftX = cursorX - minX;
    for (const [id, pos] of laidOut) {
      positionById.set(id, { x: pos.x + shiftX, y: pos.y });
    }

    cursorX += width + COMPONENT_GAP;
  }

  // Return in the original input order, with positions filled in.
  return nodes.map((n) => {
    const pos = positionById.get(n.id);
    if (!pos) return n;
    return {
      ...n,
      position: pos,
      sourcePosition: direction === "LR" ? Position.Right : Position.Bottom,
      targetPosition: direction === "LR" ? Position.Left : Position.Top,
    };
  });
}

// BFS over the undirected projection of edges to find connected components.
// Returns components in the order their first node appears in `nodes`.
function findConnectedComponents(
  nodes: MindNode[],
  edges: MindEdge[],
): Set<string>[] {
  const neighbours = new Map<string, string[]>();
  for (const n of nodes) neighbours.set(n.id, []);
  for (const e of edges) {
    neighbours.get(e.source)?.push(e.target);
    neighbours.get(e.target)?.push(e.source);
  }

  const seen = new Set<string>();
  const components: Set<string>[] = [];
  for (const n of nodes) {
    if (seen.has(n.id)) continue;
    const component = new Set<string>();
    const queue: string[] = [n.id];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      component.add(id);
      for (const next of neighbours.get(id) ?? []) {
        if (!seen.has(next)) queue.push(next);
      }
    }
    components.push(component);
  }
  return components;
}

// Run dagre on a single component; return position-by-id (using the
// node's top-left corner, the same convention as MindNode.position).
function dagreLayoutComponent(
  nodes: MindNode[],
  edges: MindEdge[],
  direction: "LR" | "TB",
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, nodesep: NODE_SEP, ranksep: RANK_SEP });

  for (const n of nodes) {
    g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const e of edges) {
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  const out = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const pos = g.node(n.id);
    out.set(n.id, {
      x: pos.x - NODE_WIDTH / 2,
      y: pos.y - NODE_HEIGHT / 2,
    });
  }
  return out;
}
