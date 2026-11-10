import { describe, expect, it } from "vitest";
import {
  defaultRegistry,
  defaultUi,
  normalizeGraphFile,
  normalizeRegistry,
  stripFileForPersist,
  stripGraphForPersist,
} from "./graphFile";
import type { GraphFile, PaperRef } from "./types";

describe("normalizeGraphFile", () => {
  it("rejects null", () => {
    expect(normalizeGraphFile(null)).toBeNull();
  });

  it("rejects non-objects", () => {
    expect(normalizeGraphFile(42)).toBeNull();
    expect(normalizeGraphFile("hello")).toBeNull();
  });

  it("rejects when nodes or edges aren't arrays", () => {
    expect(normalizeGraphFile({ nodes: null, edges: [] })).toBeNull();
    expect(normalizeGraphFile({ nodes: [], edges: "wrong" })).toBeNull();
  });

  it("accepts an empty graph and fills in defaults", () => {
    const file = normalizeGraphFile({ nodes: [], edges: [] });
    expect(file).not.toBeNull();
    expect(file!.nodes).toEqual([]);
    expect(file!.edges).toEqual([]);
    expect(file!.notes).toBe("");
    expect(file!.ui.collapsed).toEqual([]);
    expect(file!.ui.selection.nodeIds).toEqual([]);
    expect(file!.ui.selection.edgeIds).toEqual([]);
  });

  it("preserves persisted node-data fields and drops unknowns", () => {
    const file = normalizeGraphFile({
      nodes: [
        {
          id: "n1",
          type: "mind",
          position: { x: 0, y: 0 },
          data: {
            label: "Hello",
            body: "## detail",
            typeId: "claim",
            statusId: "draft",
            // Unknown / transient fields should be dropped on normalize.
            startEditingToken: 12345,
            collapsed: true,
          },
        },
      ],
      edges: [],
    });
    expect(file).not.toBeNull();
    const data = file!.nodes[0].data;
    expect(data.label).toBe("Hello");
    expect(data.body).toBe("## detail");
    expect(data.typeId).toBe("claim");
    expect(data.statusId).toBe("draft");
    expect(
      (data as Record<string, unknown>).startEditingToken,
    ).toBeUndefined();
    expect((data as Record<string, unknown>).collapsed).toBeUndefined();
  });

  it("preserves edge data when present and drops it when empty", () => {
    const file = normalizeGraphFile({
      nodes: [],
      edges: [
        {
          id: "e1",
          source: "n1",
          target: "n2",
          data: { typeId: "supports", body: "why" },
        },
        // Edge with no data: normalizer drops the data field entirely.
        { id: "e2", source: "n1", target: "n2" },
      ],
    });
    expect(file).not.toBeNull();
    expect(file!.edges[0].data?.typeId).toBe("supports");
    expect(file!.edges[0].data?.body).toBe("why");
    expect(file!.edges[1].data).toBeUndefined();
  });

  it("normalises an embedded registry", () => {
    const file = normalizeGraphFile({
      nodes: [],
      edges: [],
      registry: {
        nodeTypes: {
          claim: {
            label: "Claim",
            statuses: [{ id: "draft", label: "Draft" }],
          },
        },
        edgeTypes: { supports: { label: "Supports" } },
      },
    });
    expect(file?.registry?.nodeTypes.claim?.statuses[0].id).toBe("draft");
  });
});

describe("stripGraphForPersist / stripFileForPersist", () => {
  const seed: GraphFile = {
    nodes: [
      {
        id: "n1",
        type: "mind",
        position: { x: 1, y: 2 },
        selected: true,
        dragging: true,
        data: {
          label: "K",
          body: "B",
          typeId: "claim",
          statusId: "draft",
          // Fake transient fields the live editor injects:
          ...({ startEditingToken: 1 } as Record<string, unknown>),
        },
      },
    ],
    edges: [
      {
        id: "e1",
        source: "n1",
        target: "n2",
        selected: true,
        data: { typeId: "supports", body: "why" },
      },
    ],
    notes: "doc notes",
    ui: defaultUi(),
  };

  it("drops transient node fields and keeps persistent ones", () => {
    const out = stripGraphForPersist(seed);
    const n = out.nodes[0];
    expect(n.id).toBe("n1");
    expect(n.position).toEqual({ x: 1, y: 2 });
    expect(n.selected).toBeUndefined();
    expect(n.dragging).toBeUndefined();
    expect(n.data.label).toBe("K");
    expect(n.data.body).toBe("B");
    expect(n.data.typeId).toBe("claim");
    expect(n.data.statusId).toBe("draft");
    // Transient `startEditingToken` is dropped because stripGraphForPersist
    // explicitly enumerates the persisted fields.
    expect(
      (n.data as Record<string, unknown>).startEditingToken,
    ).toBeUndefined();
  });

  it("drops transient edge fields and keeps data", () => {
    const out = stripGraphForPersist(seed);
    const e = out.edges[0];
    expect(e.selected).toBeUndefined();
    expect(e.data?.typeId).toBe("supports");
    expect(e.data?.body).toBe("why");
  });

  it("stripFileForPersist preserves notes, ui, and registry pointers", () => {
    const out = stripFileForPersist(seed);
    expect(out.notes).toBe("doc notes");
    expect(out.ui).toEqual(seed.ui);
    expect(out.registry).toBeUndefined();
  });
});

describe("defaultRegistry", () => {
  it("ships the seven canonical node types", () => {
    const r = defaultRegistry();
    expect(Object.keys(r.nodeTypes).sort()).toEqual([
      "assumption",
      "claim",
      "definition",
      "evidence",
      "question",
      "risk",
      "synthesis",
    ]);
  });

  it("uses the draft / stated / supported ladder for claim", () => {
    const claim = defaultRegistry().nodeTypes.claim;
    expect(claim.defaultStatus).toBe("draft");
    expect(claim.statuses.map((s) => s.id)).toEqual([
      "draft",
      "stated",
      "supported",
    ]);
  });

  it("ships the five canonical edge types including addresses", () => {
    const ets = defaultRegistry().edgeTypes;
    expect(Object.keys(ets).sort()).toEqual([
      "addresses",
      "contradicts",
      "expands",
      "relates",
      "supports",
    ]);
  });

  it("synthesis has the same first-stage ladder as claim", () => {
    const s = defaultRegistry().nodeTypes.synthesis;
    expect(s.defaultStatus).toBe("draft");
    expect(s.statuses.map((x) => x.id)).toEqual(["draft", "stated"]);
  });
});

describe("normalizeRegistry", () => {
  it("returns null for non-objects", () => {
    expect(normalizeRegistry(null)).toBeNull();
    expect(normalizeRegistry(42)).toBeNull();
  });

  it("accepts a partial registry and fills in safe defaults per type", () => {
    const r = normalizeRegistry({
      nodeTypes: { x: { statuses: [{ id: "a" }] } },
      edgeTypes: { y: {} },
    });
    expect(r?.nodeTypes.x?.label).toBe("Untitled");
    expect(r?.nodeTypes.x?.statuses[0].id).toBe("a");
    expect(r?.nodeTypes.x?.statuses[0].label).toBe("a");
    expect(r?.edgeTypes.y?.label).toBe("Untitled");
    expect(r?.edgeTypes.y?.lineStyle).toBe("solid");
  });
});

describe("paperRefs normalization and persistence", () => {
  const nodeWith = (paperRefs: unknown) => ({
    id: "n1",
    type: "mind",
    position: { x: 0, y: 0 },
    data: { label: "A", paperRefs },
  });

  it("normalize keeps well-formed entries and drops malformed ones", () => {
    const file = normalizeGraphFile({
      nodes: [
        nodeWith([
          { loc: "§4.2 ¶3", note: "data model" },
          { loc: "§1" },
          { loc: "", note: "empty loc dropped" },
          { loc: "   ", note: "blank loc dropped" },
          { note: "no loc dropped" },
          "not an object",
          null,
          { loc: 42 },
          { loc: "§9", note: 7 },
        ]),
      ],
      edges: [],
    });
    expect(file!.nodes[0].data.paperRefs).toEqual([
      { loc: "§4.2 ¶3", note: "data model" },
      { loc: "§1" },
      { loc: "§9" },
    ]);
  });

  it("normalize omits the field when the list is empty or invalid", () => {
    const dataFor = (paperRefs: unknown) =>
      normalizeGraphFile({ nodes: [nodeWith(paperRefs)], edges: [] })!.nodes[0]
        .data;
    expect("paperRefs" in dataFor([])).toBe(false);
    expect("paperRefs" in dataFor([{ loc: "" }])).toBe(false);
    expect("paperRefs" in dataFor("nope")).toBe(false);
  });

  it("normalize keeps edge paperRefs when present", () => {
    const file = normalizeGraphFile({
      nodes: [],
      edges: [
        {
          id: "e1",
          source: "a",
          target: "b",
          data: { paperRefs: [{ loc: "§3" }] },
        },
      ],
    });
    expect(file!.edges[0].data?.paperRefs).toEqual([{ loc: "§3" }]);
  });

  it("strip rebuilds clean entries on nodes and edges", () => {
    const graph = stripGraphForPersist({
      nodes: [
        {
          id: "n1",
          type: "mind",
          position: { x: 0, y: 0 },
          data: {
            label: "A",
            paperRefs: [
              { loc: "§1", note: "x", junk: "dropped" } as PaperRef,
              { loc: "§2" },
            ],
          },
        },
      ],
      edges: [
        {
          id: "e1",
          source: "n1",
          target: "n1",
          data: { typeId: "supports", paperRefs: [{ loc: "§5" }] },
        },
      ],
    });
    expect(graph.nodes[0].data.paperRefs).toEqual([
      { loc: "§1", note: "x" },
      { loc: "§2" },
    ]);
    expect(graph.edges[0].data?.paperRefs).toEqual([{ loc: "§5" }]);
  });
});
