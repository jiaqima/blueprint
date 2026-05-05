import { describe, expect, it } from "vitest";
import { layoutWithDagre, NODE_HEIGHT, NODE_WIDTH } from "./layout";
import type { MindEdge, MindNode } from "./types";

function mkNode(id: string): MindNode {
  return {
    id,
    type: "mind",
    position: { x: 0, y: 0 },
    data: { label: id },
  };
}

function mkEdge(source: string, target: string): MindEdge {
  return { id: `e_${source}_${target}`, source, target };
}

function bbox(positions: { x: number; y: number }[]) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of positions) {
    if (p.x < minX) minX = p.x;
    if (p.x + NODE_WIDTH > maxX) maxX = p.x + NODE_WIDTH;
    if (p.y < minY) minY = p.y;
    if (p.y + NODE_HEIGHT > maxY) maxY = p.y + NODE_HEIGHT;
  }
  return { minX, maxX, minY, maxY };
}

describe("layoutWithDagre", () => {
  it("returns the empty graph unchanged", () => {
    expect(layoutWithDagre([], [])).toEqual([]);
  });

  it("preserves the input node order", () => {
    const nodes = ["a", "b", "c"].map(mkNode);
    const edges = [mkEdge("a", "b"), mkEdge("b", "c")];
    const out = layoutWithDagre(nodes, edges);
    expect(out.map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("assigns finite numeric positions for a single component", () => {
    const nodes = ["root", "child", "grandchild"].map(mkNode);
    const edges = [mkEdge("root", "child"), mkEdge("child", "grandchild")];
    const out = layoutWithDagre(nodes, edges);
    for (const n of out) {
      expect(Number.isFinite(n.position.x)).toBe(true);
      expect(Number.isFinite(n.position.y)).toBe(true);
    }
    // TB layout: root above its descendants.
    const yByLabel = Object.fromEntries(
      out.map((n) => [n.data.label, n.position.y]),
    );
    expect(yByLabel.root).toBeLessThan(yByLabel.child);
    expect(yByLabel.child).toBeLessThan(yByLabel.grandchild);
  });

  it("packs disconnected components without horizontal overlap", () => {
    // Two unrelated trees, A↔B and C↔D.
    const nodes = ["A", "B", "C", "D"].map(mkNode);
    const edges = [mkEdge("A", "B"), mkEdge("C", "D")];
    const out = layoutWithDagre(nodes, edges);
    const positionById = new Map(out.map((n) => [n.id, n.position]));
    const compAB = bbox([positionById.get("A")!, positionById.get("B")!]);
    const compCD = bbox([positionById.get("C")!, positionById.get("D")!]);
    // Components packed left-to-right: AB ends before CD begins (or vice versa).
    expect(
      compAB.maxX <= compCD.minX || compCD.maxX <= compAB.minX,
    ).toBe(true);
  });

  it("packs three components in input order", () => {
    const nodes = ["a", "b", "c"].map(mkNode);
    const edges: MindEdge[] = []; // each node is its own component
    const out = layoutWithDagre(nodes, edges);
    const positionById = new Map(out.map((n) => [n.id, n.position]));
    expect(positionById.get("a")!.x).toBeLessThan(positionById.get("b")!.x);
    expect(positionById.get("b")!.x).toBeLessThan(positionById.get("c")!.x);
  });

  it("does not produce overlapping nodes within a single component", () => {
    const nodes = ["root", "a", "b", "c"].map(mkNode);
    const edges = [mkEdge("root", "a"), mkEdge("root", "b"), mkEdge("root", "c")];
    const out = layoutWithDagre(nodes, edges);
    // All three children share the same y; their x positions should differ
    // by at least NODE_WIDTH so the rectangles don't overlap.
    const childPositions = ["a", "b", "c"].map(
      (id) => out.find((n) => n.id === id)!.position,
    );
    childPositions.sort((p, q) => p.x - q.x);
    for (let i = 1; i < childPositions.length; i++) {
      expect(childPositions[i].x - childPositions[i - 1].x).toBeGreaterThanOrEqual(
        NODE_WIDTH,
      );
    }
  });
});
