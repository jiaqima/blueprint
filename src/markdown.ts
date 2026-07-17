import { nextNodeId } from "./idgen";
import type { Graph, MindNode, MindEdge } from "./types";

type Line = { depth: number; text: string };

function classify(raw: string): Line | null {
  if (!raw.trim()) return null;

  // Heading: # text, ## text, ...
  const h = /^(#{1,6})\s+(.*)$/.exec(raw);
  if (h) {
    return { depth: h[1].length, text: h[2].trim() };
  }

  // Bullet: optional indent then -, *, +, or "1." / "1)"
  const b = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/.exec(raw);
  if (b) {
    const indent = b[1].replace(/\t/g, "  ").length;
    // 100 is a sentinel "deeper than any heading" base; add indent steps
    const depth = 100 + Math.floor(indent / 2);
    return { depth, text: b[2].trim() };
  }

  return null;
}

export function parseMarkdownOutline(text: string): Graph {
  const lines = text.split(/\r?\n/).map(classify).filter((l): l is Line => l !== null);
  if (lines.length === 0) {
    return { nodes: [], edges: [] };
  }

  // Import replaces the whole graph, so only intra-parse uniqueness
  // matters; the shared generator plus the minted set guarantee it.
  const minted = new Set<string>();
  const mint = (): string => {
    const id = nextNodeId(minted);
    minted.add(id);
    return id;
  };

  // Normalize: bullets sitting under headings become children of the heading.
  // Run a stack-based attach using raw depths; bullets always have depth >= 100,
  // so they naturally nest under any heading.
  const nodes: MindNode[] = [];
  const edges: MindEdge[] = [];
  const stack: { depth: number; id: string }[] = [];

  for (const line of lines) {
    while (stack.length > 0 && stack[stack.length - 1].depth >= line.depth) {
      stack.pop();
    }
    const id = mint();
    nodes.push({
      id,
      type: "mind",
      position: { x: 0, y: 0 },
      data: { label: line.text },
    });
    if (stack.length > 0) {
      const parent = stack[stack.length - 1].id;
      edges.push({
        id: `e_${parent}_${id}`,
        source: parent,
        target: id,
      });
    }
    stack.push({ depth: line.depth, id });
  }

  // If multiple top-level nodes (no shared root), wrap them under a synthetic root
  const topLevel = nodes.filter((n) => !edges.some((e) => e.target === n.id));
  if (topLevel.length > 1) {
    const rootId = mint();
    nodes.unshift({
      id: rootId,
      type: "mind",
      position: { x: 0, y: 0 },
      data: { label: "Outline" },
    });
    for (const n of topLevel) {
      edges.push({
        id: `e_${rootId}_${n.id}`,
        source: rootId,
        target: n.id,
      });
    }
  }

  return { nodes, edges };
}
