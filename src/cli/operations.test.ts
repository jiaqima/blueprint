import { describe, expect, it } from "vitest";
import { defaultRegistry, defaultUi, seedGraphFile } from "../graphFile";
import {
  addChild,
  addEdgePaperRef,
  addPaperRef,
  addSibling,
  clearEdgePaperRefs,
  clearPaperRefs,
  CliError,
  deleteNode,
  effectiveRegistry,
  find,
  findEdge,
  findNode,
  importMarkdown,
  link,
  move,
  outline,
  removeEdgePaperRef,
  removePaperRef,
  rename,
  resolveDocumentPath,
  setEdgeBody,
  setEdgeType,
  setNodeBody,
  setNodeLabel,
  setNodeStatus,
  setNodeType,
  setNotes,
  synthesize,
  unlink,
} from "./operations";
import type { GraphFile, MindEdge, MindNode } from "../types";

type NodeSpec = {
  id: string;
  label?: string;
  typeId?: string;
  statusId?: string;
  body?: string;
};
type EdgeSpec = {
  id?: string;
  source: string;
  target: string;
  typeId?: string;
  body?: string;
};

function mkFile(nodes: NodeSpec[], edges: EdgeSpec[] = []): GraphFile {
  const ns: MindNode[] = nodes.map((n) => ({
    id: n.id,
    type: "mind",
    position: { x: 0, y: 0 },
    data: {
      label: n.label ?? n.id,
      ...(n.typeId !== undefined ? { typeId: n.typeId } : {}),
      ...(n.statusId !== undefined ? { statusId: n.statusId } : {}),
      ...(n.body !== undefined ? { body: n.body } : {}),
    },
  }));
  const es: MindEdge[] = edges.map((e) => ({
    id: e.id ?? `e_${e.source}_${e.target}`,
    source: e.source,
    target: e.target,
    ...(e.typeId !== undefined || e.body !== undefined
      ? {
          data: {
            ...(e.typeId !== undefined ? { typeId: e.typeId } : {}),
            ...(e.body !== undefined ? { body: e.body } : {}),
          },
        }
      : {}),
  }));
  return { nodes: ns, edges: es, notes: "", ui: defaultUi() };
}

const reg = defaultRegistry();

// ---------------------------------------------------------------------------

describe("findNode", () => {
  const file = mkFile([
    { id: "n1", label: "Introduction" },
    { id: "n2", label: "Method" },
    { id: "n3", label: "Method 2" },
  ]);

  it("matches by exact system id", () => {
    expect(findNode(file, "n2").id).toBe("n2");
  });

  it("matches by exact label", () => {
    expect(findNode(file, "Introduction").id).toBe("n1");
  });

  it("matches by unique case-insensitive substring", () => {
    expect(findNode(file, "intro").id).toBe("n1");
  });

  it("throws on ambiguous substring", () => {
    // 'method' (lowercase) doesn't match any label exactly, so the
    // resolver falls through to case-insensitive substring matching,
    // where both 'Method' and 'Method 2' match — ambiguous.
    expect(() => findNode(file, "method")).toThrow(/ambiguous/);
  });

  it("throws on no match", () => {
    expect(() => findNode(file, "missing")).toThrow(/no node matches/);
  });
});

// ---------------------------------------------------------------------------

describe("findEdge", () => {
  const file = mkFile(
    [{ id: "a" }, { id: "b" }],
    [{ source: "a", target: "b" }],
  );

  it("returns the edge between two endpoints", () => {
    const e = findEdge(file, "a", "b");
    expect(e.source).toBe("a");
    expect(e.target).toBe("b");
  });

  it("throws when no edge exists", () => {
    expect(() => findEdge(file, "b", "a")).toThrow(/no edge/);
  });
});

// ---------------------------------------------------------------------------

describe("addChild / addSibling", () => {
  it("addChild creates a node + edge from parent", () => {
    const file = mkFile([{ id: "p" }]);
    const { file: out, node } = addChild(file, "p", "kid");
    expect(out.nodes).toHaveLength(2);
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0].source).toBe("p");
    expect(out.edges[0].target).toBe(node.id);
    expect(node.data.label).toBe("kid");
  });

  it("addChild accepts an inline body", () => {
    const file = mkFile([{ id: "p" }]);
    const { node } = addChild(file, "p", "kid", { body: "## why" });
    expect(node.data.body).toBe("## why");
  });

  it("addSibling connects to all parents of the reference node", () => {
    const file = mkFile(
      [{ id: "p1" }, { id: "p2" }, { id: "child" }],
      [
        { source: "p1", target: "child" },
        { source: "p2", target: "child" },
      ],
    );
    const { file: out, node } = addSibling(file, "child", "sib");
    const incoming = out.edges.filter((e) => e.target === node.id);
    expect(incoming.map((e) => e.source).sort()).toEqual(["p1", "p2"]);
  });

  it("addSibling falls back to addChild when the target is a root", () => {
    const file = mkFile([{ id: "root" }]);
    const { file: out, node } = addSibling(file, "root", "kid");
    const incoming = out.edges.filter((e) => e.target === node.id);
    expect(incoming).toHaveLength(1);
    expect(incoming[0].source).toBe("root");
  });
});

// ---------------------------------------------------------------------------

describe("setNodeLabel / rename", () => {
  it("replaces the label", () => {
    const file = mkFile([{ id: "n", label: "old" }]);
    const out = setNodeLabel(file, "n", "new");
    expect(out.nodes[0].data.label).toBe("new");
  });

  it("appends with { append: true }", () => {
    const file = mkFile([{ id: "n", label: "Hello" }]);
    const out = setNodeLabel(file, "n", " World", { append: true });
    expect(out.nodes[0].data.label).toBe("Hello World");
  });

  it("rename is the same as setNodeLabel without options", () => {
    const file = mkFile([{ id: "n", label: "old" }]);
    expect(rename(file, "n", "new").nodes[0].data.label).toBe("new");
  });
});

// ---------------------------------------------------------------------------

describe("deleteNode", () => {
  it("removes the node and its incident edges", () => {
    const file = mkFile(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      [
        { source: "a", target: "b" },
        { source: "b", target: "c" },
      ],
    );
    const { file: out, removed } = deleteNode(file, "b");
    expect(removed).toEqual(["b"]);
    expect(out.nodes.map((n) => n.id).sort()).toEqual(["a", "c"]);
    expect(out.edges).toEqual([]);
  });

  it("--subtree prunes descendants whose every parent is in the removed set", () => {
    const file = mkFile(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      [
        { source: "a", target: "b" },
        { source: "b", target: "c" },
      ],
    );
    const { removed } = deleteNode(file, "a", { subtree: true });
    expect(removed.sort()).toEqual(["a", "b", "c"]);
  });

  it("--subtree preserves multi-parent shared children that have a live parent", () => {
    // Both `a` and `keepalive` parent `shared`. Deleting `a --subtree`
    // should leave `shared` because `keepalive` still parents it.
    const file = mkFile(
      [{ id: "a" }, { id: "keepalive" }, { id: "shared" }],
      [
        { source: "a", target: "shared" },
        { source: "keepalive", target: "shared" },
      ],
    );
    const { file: out, removed } = deleteNode(file, "a", { subtree: true });
    expect(removed).toEqual(["a"]);
    expect(out.nodes.map((n) => n.id).sort()).toEqual([
      "keepalive",
      "shared",
    ]);
    // The edge from `a` is gone; the edge from `keepalive` remains.
    expect(out.edges).toEqual([
      expect.objectContaining({ source: "keepalive", target: "shared" }),
    ]);
  });
});

// ---------------------------------------------------------------------------

describe("move", () => {
  it("rewires all incoming edges to the new parent", () => {
    const file = mkFile(
      [{ id: "old" }, { id: "new" }, { id: "child" }],
      [{ source: "old", target: "child" }],
    );
    const out = move(file, "child", "new");
    expect(out.edges.map((e) => `${e.source}->${e.target}`)).toEqual([
      "new->child",
    ]);
  });

  it("rejects reparenting a node to itself", () => {
    const file = mkFile([{ id: "n" }]);
    expect(() => move(file, "n", "n")).toThrow(/itself/);
  });
});

// ---------------------------------------------------------------------------

describe("link / unlink", () => {
  it("link adds a new edge", () => {
    const file = mkFile([{ id: "a" }, { id: "b" }]);
    const out = link(file, "a", "b");
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0].source).toBe("a");
    expect(out.edges[0].target).toBe("b");
  });

  it("link rejects self-loops", () => {
    const file = mkFile([{ id: "n" }]);
    expect(() => link(file, "n", "n")).toThrow(/itself/);
  });

  it("link is idempotent for duplicate edges", () => {
    const file = mkFile(
      [{ id: "a" }, { id: "b" }],
      [{ source: "a", target: "b" }],
    );
    const out = link(file, "a", "b");
    expect(out.edges).toHaveLength(1);
  });

  it("unlink removes an existing edge", () => {
    const file = mkFile(
      [{ id: "a" }, { id: "b" }],
      [{ source: "a", target: "b" }],
    );
    const out = unlink(file, "a", "b");
    expect(out.edges).toEqual([]);
  });

  it("unlink is idempotent when the edge is absent", () => {
    const file = mkFile([{ id: "a" }, { id: "b" }]);
    const out = unlink(file, "a", "b");
    expect(out.edges).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("setNotes", () => {
  it("replaces the notes", () => {
    const file = mkFile([]);
    const out = setNotes(file, "hello");
    expect(out.notes).toBe("hello");
  });

  it("appends with a separating newline when needed", () => {
    const file = { ...mkFile([]), notes: "first" };
    const out = setNotes(file, "second", { append: true });
    expect(out.notes).toBe("first\nsecond");
  });

  it("does not double-add a newline if notes already end in one", () => {
    const file = { ...mkFile([]), notes: "first\n" };
    const out = setNotes(file, "second", { append: true });
    expect(out.notes).toBe("first\nsecond");
  });
});

// ---------------------------------------------------------------------------

describe("setNodeType / setNodeStatus", () => {
  it("setNodeType sets the type and falls back to defaultStatus when current is invalid", () => {
    const file = mkFile([{ id: "n", typeId: "evidence", statusId: "cited" }]);
    // 'cited' isn't in the claim ladder -> falls back to claim's defaultStatus 'draft'.
    const out = setNodeType(file, "n", "claim", reg);
    expect(out.nodes[0].data.typeId).toBe("claim");
    expect(out.nodes[0].data.statusId).toBe("draft");
  });

  it("setNodeType preserves status when it remains valid for the new type", () => {
    const file = mkFile([{ id: "n", typeId: "claim", statusId: "draft" }]);
    // Keeping the same type is the easy case; statusId stays as-is.
    const out = setNodeType(file, "n", "claim", reg);
    expect(out.nodes[0].data.statusId).toBe("draft");
  });

  it("setNodeType throws on unknown type id", () => {
    const file = mkFile([{ id: "n" }]);
    expect(() => setNodeType(file, "n", "ghost", reg)).toThrow(
      /unknown node type/,
    );
  });

  it("setNodeStatus throws when the node has no type yet", () => {
    const file = mkFile([{ id: "n" }]);
    expect(() => setNodeStatus(file, "n", "draft", reg)).toThrow(
      /no type/,
    );
  });

  it("setNodeStatus validates against the type's status set", () => {
    const file = mkFile([{ id: "n", typeId: "claim", statusId: "draft" }]);
    expect(() => setNodeStatus(file, "n", "ghost", reg)).toThrow(
      /unknown status/,
    );
    const out = setNodeStatus(file, "n", "supported", reg);
    expect(out.nodes[0].data.statusId).toBe("supported");
  });
});

// ---------------------------------------------------------------------------

describe("setNodeBody / setEdgeBody / setEdgeType", () => {
  it("setNodeBody set vs append", () => {
    const file = mkFile([{ id: "n", body: "first" }]);
    expect(setNodeBody(file, "n", "next").nodes[0].data.body).toBe("next");
    expect(
      setNodeBody(file, "n", " more", { append: true }).nodes[0].data.body,
    ).toBe("first\n more");
  });

  it("setEdgeType validates against the registry", () => {
    const file = mkFile(
      [{ id: "a" }, { id: "b" }],
      [{ source: "a", target: "b" }],
    );
    expect(() => setEdgeType(file, "a", "b", "ghost", reg)).toThrow(
      /unknown edge type/,
    );
    const out = setEdgeType(file, "a", "b", "supports", reg);
    expect(out.edges[0].data?.typeId).toBe("supports");
  });

  it("setEdgeBody set vs append", () => {
    const file = mkFile(
      [{ id: "a" }, { id: "b" }],
      [{ source: "a", target: "b", body: "first" }],
    );
    expect(setEdgeBody(file, "a", "b", "next").edges[0].data?.body).toBe(
      "next",
    );
    expect(
      setEdgeBody(file, "a", "b", " more", { append: true }).edges[0].data
        ?.body,
    ).toBe("first\n more");
  });
});

// ---------------------------------------------------------------------------

describe("synthesize", () => {
  it("creates a synthesis-typed node and rewires supports edges through it", () => {
    const file = mkFile(
      [
        { id: "C", typeId: "claim", statusId: "draft" },
        { id: "E1", typeId: "evidence", statusId: "cited" },
        { id: "E2", typeId: "evidence", statusId: "cited" },
      ],
      [
        { source: "E1", target: "C", typeId: "supports", body: "from-1" },
        { source: "E2", target: "C", typeId: "supports" },
      ],
    );
    const { file: out, node } = synthesize(file, "C", ["E1", "E2"], {
      label: "Combined",
      registry: reg,
    });
    // synthesize returns the freshly-minted node *before* setNodeType
    // is applied; look up the post-typed node from the result file.
    const finalNode = out.nodes.find((n) => n.id === node.id);
    expect(finalNode?.data.typeId).toBe("synthesis");
    expect(finalNode?.data.statusId).toBe("draft");
    // The original E1/E2 → C edges are gone; new edges go to the synthesis.
    const edgesByPair = out.edges.map((e) => `${e.source}->${e.target}`);
    expect(edgesByPair).not.toContain("E1->C");
    expect(edgesByPair).not.toContain("E2->C");
    expect(edgesByPair).toContain(`E1->${node.id}`);
    expect(edgesByPair).toContain(`E2->${node.id}`);
    expect(edgesByPair).toContain(`${node.id}->C`);
    // The carried-over body rides along on the rewired E1 → synthesis edge.
    const e1ToSynth = out.edges.find(
      (e) => e.source === "E1" && e.target === node.id,
    );
    expect(e1ToSynth?.data?.body).toBe("from-1");
  });

  it("--keep preserves the original parent → claim supports edges", () => {
    const file = mkFile(
      [
        { id: "C", typeId: "claim", statusId: "draft" },
        { id: "E1", typeId: "evidence", statusId: "cited" },
      ],
      [{ source: "E1", target: "C", typeId: "supports" }],
    );
    const { file: out, node } = synthesize(file, "C", ["E1"], {
      label: "Synth",
      keep: true,
      registry: reg,
    });
    const pairs = out.edges.map((e) => `${e.source}->${e.target}`);
    expect(pairs).toContain("E1->C"); // original preserved
    expect(pairs).toContain(`E1->${node.id}`);
    expect(pairs).toContain(`${node.id}->C`);
  });

  it("rejects duplicate parent refs", () => {
    const file = mkFile(
      [
        { id: "C", typeId: "claim", statusId: "draft" },
        { id: "E1", typeId: "evidence", statusId: "cited" },
      ],
      [],
    );
    expect(() =>
      synthesize(file, "C", ["E1", "E1"], {
        label: "Synth",
        registry: reg,
      }),
    ).toThrow(/listed more than once/);
  });

  it("requires at least one parent ref", () => {
    const file = mkFile([{ id: "C", typeId: "claim", statusId: "draft" }], []);
    expect(() =>
      synthesize(file, "C", [], { label: "Synth", registry: reg }),
    ).toThrow(/at least one parent/);
  });
});

// ---------------------------------------------------------------------------

describe("importMarkdown / find / outline", () => {
  it("importMarkdown replaces the graph", () => {
    const file = mkFile([{ id: "old" }]);
    const out = importMarkdown(file, "# A\n## B\n## C");
    expect(out.nodes.map((n) => n.data.label)).toEqual(["A", "B", "C"]);
  });

  it("importMarkdown throws on empty input", () => {
    const file = mkFile([]);
    expect(() => importMarkdown(file, "")).toThrow(/no headings or bullets/);
  });

  it("find returns label-substring matches case-insensitively", () => {
    const file = mkFile([
      { id: "a", label: "Method One" },
      { id: "b", label: "Method Two" },
      { id: "c", label: "Conclusion" },
    ]);
    const matches = find(file, "method");
    expect(matches.map((m) => m.id).sort()).toEqual(["a", "b"]);
  });

  it("outline produces an indented tree with type/status decorations", () => {
    const file = mkFile(
      [
        { id: "root", label: "R", typeId: "claim", statusId: "draft" },
        { id: "kid", label: "K", typeId: "evidence", statusId: "cited" },
      ],
      [{ source: "root", target: "kid" }],
    );
    const text = outline(file, reg);
    expect(text).toContain("- R  (root)  [Claim · Draft]");
    expect(text).toContain("- K  (kid)  [Evidence · Cited]");
    // Indentation: kid is one level under root.
    expect(text.split("\n")[1].startsWith("  -")).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("resolveDocumentPath", () => {
  it("normalizes a bare name to blueprints/<name>.json", () => {
    expect(resolveDocumentPath("paper")).toBe("blueprints/paper.json");
  });

  it("strips a leading blueprints/ prefix", () => {
    expect(resolveDocumentPath("blueprints/paper.json")).toBe(
      "blueprints/paper.json",
    );
  });

  it("rejects absolute paths", () => {
    expect(() => resolveDocumentPath("/abs/paper.json")).toThrow(CliError);
  });

  it("rejects names containing ..", () => {
    expect(() => resolveDocumentPath("../paper")).toThrow(CliError);
  });

  it("rejects nested paths", () => {
    expect(() => resolveDocumentPath("dir/paper")).toThrow(CliError);
  });

  it("rejects the empty string", () => {
    expect(() => resolveDocumentPath("")).toThrow(CliError);
  });
});

// ---------------------------------------------------------------------------

describe("effectiveRegistry", () => {
  it("prefers a per-doc override", () => {
    const docReg = {
      nodeTypes: { x: { label: "X", statuses: [{ id: "a", label: "A" }] } },
      edgeTypes: {},
    };
    const file = { ...seedGraphFile(), registry: docReg };
    expect(effectiveRegistry(file, null)).toBe(docReg);
  });

  it("falls back to the workspace registry, then the built-in", () => {
    const ws = {
      nodeTypes: { y: { label: "Y", statuses: [{ id: "b", label: "B" }] } },
      edgeTypes: {},
    };
    expect(effectiveRegistry(seedGraphFile(), ws)).toBe(ws);
    expect(effectiveRegistry(seedGraphFile(), null)).toEqual(reg);
  });
});

// ---------------------------------------------------------------------------

describe("paper refs", () => {
  const base = () =>
    mkFile(
      [
        { id: "n1", label: "Claim A", typeId: "claim" },
        { id: "n2", label: "Evidence B", typeId: "evidence" },
      ],
      [{ source: "n2", target: "n1", typeId: "supports" }],
    );

  it("addPaperRef appends entries in order, trimming loc and note", () => {
    let f = addPaperRef(base(), "Claim A", " §4.2 ¶3 ", "  data model  ");
    f = addPaperRef(f, "n1", "§1 ¶2");
    expect(findNode(f, "n1").data.paperRefs).toEqual([
      { loc: "§4.2 ¶3", note: "data model" },
      { loc: "§1 ¶2" },
    ]);
  });

  it("addPaperRef rejects an empty loc and drops an empty note", () => {
    expect(() => addPaperRef(base(), "n1", "   ")).toThrow(CliError);
    const f = addPaperRef(base(), "n1", "§2", "   ");
    expect(findNode(f, "n1").data.paperRefs).toEqual([{ loc: "§2" }]);
  });

  it("removePaperRef removes by 1-based index; the field disappears when empty", () => {
    let f = addPaperRef(base(), "n1", "§1");
    f = addPaperRef(f, "n1", "§2");
    f = removePaperRef(f, "n1", 1);
    expect(findNode(f, "n1").data.paperRefs).toEqual([{ loc: "§2" }]);
    f = removePaperRef(f, "n1", 1);
    expect("paperRefs" in findNode(f, "n1").data).toBe(false);
  });

  it("removePaperRef rejects out-of-range and non-integer indices", () => {
    const f = addPaperRef(base(), "n1", "§1");
    expect(() => removePaperRef(f, "n1", 0)).toThrow(CliError);
    expect(() => removePaperRef(f, "n1", 2)).toThrow(CliError);
    expect(() => removePaperRef(f, "n1", 1.5)).toThrow(CliError);
    expect(() => removePaperRef(base(), "n1", 1)).toThrow(CliError);
  });

  it("clearPaperRefs removes the field entirely and is a no-op when absent", () => {
    let f = addPaperRef(base(), "n1", "§1");
    f = addPaperRef(f, "n1", "§2");
    f = clearPaperRefs(f, "n1");
    expect("paperRefs" in findNode(f, "n1").data).toBe(false);
    expect(() => clearPaperRefs(base(), "n1")).not.toThrow();
  });

  it("edge variants add / remove / clear while preserving other edge data", () => {
    let f = addEdgePaperRef(base(), "n2", "n1", "§5 ¶1", "the inference");
    let edge = findEdge(f, "n2", "n1");
    expect(edge.data?.paperRefs).toEqual([
      { loc: "§5 ¶1", note: "the inference" },
    ]);
    expect(edge.data?.typeId).toBe("supports");

    f = addEdgePaperRef(f, "n2", "n1", "§6");
    f = removeEdgePaperRef(f, "n2", "n1", 1);
    edge = findEdge(f, "n2", "n1");
    expect(edge.data?.paperRefs).toEqual([{ loc: "§6" }]);

    f = clearEdgePaperRefs(f, "n2", "n1");
    edge = findEdge(f, "n2", "n1");
    expect(edge.data !== undefined && "paperRefs" in edge.data).toBe(false);
    expect(edge.data?.typeId).toBe("supports");
  });

  it("removeEdgePaperRef rejects when the edge has no refs", () => {
    expect(() => removeEdgePaperRef(base(), "n2", "n1", 1)).toThrow(CliError);
  });

  it("resolves node and edge refs like the other ops", () => {
    expect(() => addPaperRef(base(), "nope", "§1")).toThrow(CliError);
    // Direction matters: the edge runs n2 → n1.
    expect(() => addEdgePaperRef(base(), "n1", "n2", "§1")).toThrow(CliError);
  });
});
