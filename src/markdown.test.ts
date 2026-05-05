import { describe, expect, it } from "vitest";
import { parseMarkdownOutline } from "./markdown";

function labels(graph: { nodes: { data: { label: string } }[] }): string[] {
  return graph.nodes.map((n) => n.data.label);
}

function edgeLabels(
  graph: {
    nodes: { id: string; data: { label: string } }[];
    edges: { source: string; target: string }[];
  },
): [string, string][] {
  const labelById = new Map(graph.nodes.map((n) => [n.id, n.data.label]));
  return graph.edges.map((e) => [
    labelById.get(e.source) ?? e.source,
    labelById.get(e.target) ?? e.target,
  ]);
}

describe("parseMarkdownOutline", () => {
  it("returns an empty graph for empty input", () => {
    const g = parseMarkdownOutline("");
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
  });

  it("parses pure headings into a tree", () => {
    const g = parseMarkdownOutline("# A\n## B\n### C\n## D");
    expect(labels(g)).toEqual(["A", "B", "C", "D"]);
    expect(edgeLabels(g)).toEqual([
      ["A", "B"],
      ["B", "C"],
      ["A", "D"],
    ]);
  });

  it("parses bulleted outlines with indent-based nesting", () => {
    const g = parseMarkdownOutline(
      ["- Top", "  - Mid", "    - Leaf", "  - SecondMid"].join("\n"),
    );
    // The first bullet (no indent) is the only top-level; the rest are
    // children. We don't insert a synthetic root unless there are
    // multiple top-level nodes.
    expect(labels(g)).toEqual(["Top", "Mid", "Leaf", "SecondMid"]);
    expect(edgeLabels(g)).toEqual([
      ["Top", "Mid"],
      ["Mid", "Leaf"],
      ["Top", "SecondMid"],
    ]);
  });

  it("nests bullets under the nearest heading regardless of indent", () => {
    const g = parseMarkdownOutline(
      ["# Paper", "## Intro", "- Motivation", "- Contributions", "## Method"].join(
        "\n",
      ),
    );
    expect(labels(g)).toEqual([
      "Paper",
      "Intro",
      "Motivation",
      "Contributions",
      "Method",
    ]);
    expect(edgeLabels(g)).toEqual([
      ["Paper", "Intro"],
      ["Intro", "Motivation"],
      ["Intro", "Contributions"],
      ["Paper", "Method"],
    ]);
  });

  it("wraps multiple top-level nodes under a synthetic Outline root", () => {
    const g = parseMarkdownOutline(["# First", "# Second", "# Third"].join("\n"));
    // The Outline root is unshifted to the front of the nodes array.
    expect(g.nodes[0].data.label).toBe("Outline");
    expect(labels(g).slice(1)).toEqual(["First", "Second", "Third"]);
    expect(edgeLabels(g)).toEqual([
      ["Outline", "First"],
      ["Outline", "Second"],
      ["Outline", "Third"],
    ]);
  });

  it("supports `*` and numeric `1.` bullet markers", () => {
    const g = parseMarkdownOutline(["* alpha", "1. beta", "  * gamma"].join("\n"));
    // Three top-level-ish bullets if bullets at the same indent are siblings;
    // here the first two are at indent 0 (siblings), and gamma is nested under beta.
    // But because there are 2 top-level (alpha and beta), an Outline root wraps them.
    expect(g.nodes[0].data.label).toBe("Outline");
    const rest = labels(g).slice(1);
    expect(rest).toContain("alpha");
    expect(rest).toContain("beta");
    expect(rest).toContain("gamma");
    // gamma should be under beta.
    const labelById = new Map(g.nodes.map((n) => [n.id, n.data.label]));
    const gammaParent = g.edges.find(
      (e) => labelById.get(e.target) === "gamma",
    );
    expect(gammaParent).toBeDefined();
    expect(labelById.get(gammaParent!.source)).toBe("beta");
  });

  it("ignores blank lines and lines that don't match heading or bullet syntax", () => {
    const g = parseMarkdownOutline(
      ["# Title", "", "Random prose line.", "## Sub"].join("\n"),
    );
    expect(labels(g)).toEqual(["Title", "Sub"]);
  });
});
