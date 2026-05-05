import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type OnSelectionChangeParams,
  type Viewport as RFViewport,
} from "reactflow";
import "reactflow/dist/style.css";

import { MindMapNode } from "./MindMapNode";
import { layoutWithDagre, NODE_HEIGHT } from "./layout";
import { nextNodeId } from "./idgen";
import { getNodeType, getStatus } from "./registry";
import { debounce } from "./storage";
import type {
  Graph,
  MindEdge,
  MindEdgeData,
  MindNode,
  MindNodeData,
  Registry,
  Selection,
  Viewport,
} from "./types";

export type MindMapHandle = {
  addChild: () => void;
  addSibling: () => void;
  addRoot: () => void;
  deleteSelected: () => void;
  deleteSubtreeSelected: () => void;
  renameSelected: () => void;
  loadGraph: (
    g: Graph,
    options?: { relayout?: boolean; selection?: Selection },
  ) => void;
  exportGraph: () => Graph;
  reset: () => void;
  relayout: () => void;
  setViewport: (v: Viewport) => void;
  // Merge `patch` into the node's data; transient fields kept untouched.
  updateNodeData: (id: string, patch: Partial<MindNodeData>) => void;
  // Merge `patch` into the edge's data; transient fields kept untouched.
  updateEdgeData: (id: string, patch: Partial<MindEdgeData>) => void;
};

type Props = {
  initialGraph: Graph;
  // Fired whenever nodes or edges change. Parent owns debounced persistence.
  onGraphSnapshot?: (g: Graph) => void;
  // Fired whenever selection changes.
  onSelectionSnapshot?: (s: Selection) => void;
  // Fired (debounced) whenever the viewport changes due to user pan/zoom.
  onViewportSnapshot?: (v: Viewport) => void;
  // Node ids whose children are currently hidden (collapsed).
  collapsed?: readonly string[];
  // Called when the user toggles the chevron on a node.
  onToggleCollapse?: (id: string) => void;
  // Effective registry — used to color/style typed nodes and edges.
  registry?: Registry;
};

// BFS from roots, skipping descendants of any collapsed node. A node is
// hidden iff every root-path to it passes through a collapsed node — i.e.,
// the dominator semantics. Multi-parent: a node stays visible if it's
// reachable via any uncollapsed path.
//
// Returns:
//   visible/hidden — the partition of node ids
//   childCountById — count of direct children per node (for the chevron)
//   hiddenOnlyDueToN — for each currently-visible collapsed node N, the set
//     of nodes that would *re-appear* if N alone were uncollapsed. This is
//     the effective hide count that the chevron's `+N` badge should show,
//     and the same set drives phantom-edge ownership.
function computeHidden(
  nodes: readonly MindNode[],
  edges: readonly MindEdge[],
  collapsed: ReadonlySet<string>,
): {
  hidden: Set<string>;
  childCountById: Map<string, number>;
  hiddenOnlyDueToN: Map<string, Set<string>>;
} {
  const childrenBySource = new Map<string, string[]>();
  for (const e of edges) {
    if (!childrenBySource.has(e.source)) childrenBySource.set(e.source, []);
    childrenBySource.get(e.source)!.push(e.target);
  }
  const childCountById = new Map<string, number>();
  for (const [src, children] of childrenBySource) {
    childCountById.set(src, children.length);
  }

  const targetSet = new Set(edges.map((e) => e.target));
  const roots = nodes.filter((n) => !targetSet.has(n.id));

  function bfsVisible(cut: ReadonlySet<string>): Set<string> {
    const seen = new Set<string>();
    const queue: string[] = roots.map((r) => r.id);
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (cut.has(id)) continue;
      for (const child of childrenBySource.get(id) ?? []) queue.push(child);
    }
    return seen;
  }

  const visible = bfsVisible(collapsed);
  const hidden = new Set<string>();
  for (const n of nodes) if (!visible.has(n.id)) hidden.add(n.id);

  // For each visible collapsed node N, recompute visibility with N removed
  // from the cut and diff against the global visible set. The diff is
  // exactly the nodes hidden because of N — i.e., N dominates them.
  const hiddenOnlyDueToN = new Map<string, Set<string>>();
  for (const c of collapsed) {
    if (!visible.has(c)) {
      // c itself is hidden under another collapsed ancestor — no chevron,
      // no phantom edges originate here.
      hiddenOnlyDueToN.set(c, new Set());
      continue;
    }
    const without = new Set(collapsed);
    without.delete(c);
    const visibleWithout = bfsVisible(without);
    const onlyDueTo = new Set<string>();
    for (const id of visibleWithout) {
      if (!visible.has(id)) onlyDueTo.add(id);
    }
    hiddenOnlyDueToN.set(c, onlyDueTo);
  }

  return { hidden, childCountById, hiddenOnlyDueToN };
}

// Run dagre over the visible subset only; hidden nodes keep their stale
// positions (they don't render anyway). Returns a new node array in the
// same order as the input.
function layoutVisibleAware(
  nodes: MindNode[],
  edges: MindEdge[],
  collapsed: ReadonlySet<string>,
): MindNode[] {
  const { hidden } = computeHidden(nodes, edges, collapsed);
  const visibleNodes = nodes.filter((n) => !hidden.has(n.id));
  const visibleEdges = edges.filter(
    (e) => !hidden.has(e.source) && !hidden.has(e.target),
  );
  const laidOut = layoutWithDagre(visibleNodes, visibleEdges);
  const positionById = new Map(laidOut.map((n) => [n.id, n]));
  return nodes.map((n) => positionById.get(n.id) ?? n);
}

const nodeTypes = { mind: MindMapNode };

const MindMapInner = forwardRef<MindMapHandle, Props>(function MindMapInner(
  {
    initialGraph,
    onGraphSnapshot,
    onSelectionSnapshot,
    onViewportSnapshot,
    collapsed,
    onToggleCollapse,
    registry,
  },
  ref,
) {
  // Memoize on the sorted content rather than the array identity. The
  // parent (App) replaces the `collapsed` array on every Save (because
  // `setGraphFile(saved.file)` produces a fresh JSON-parsed array), and
  // we don't want a new collapsedSet identity to re-trigger the layout
  // effect when the actual ids haven't changed — that re-runs dagre and
  // wipes any manual node drags.
  const collapsedKey = useMemo(
    () => (collapsed ?? []).slice().sort().join("\n"),
    [collapsed],
  );
  const collapsedSet = useMemo(
    () => new Set(collapsed ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [collapsedKey],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<MindNode["data"]>(
    initialGraph.nodes,
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialGraph.edges);
  const [selection, setSelection] = useState<Selection>({
    nodeIds: [],
    edgeIds: [],
  });

  const handleLabelChange = useCallback(
    (id: string, label: string) => {
      setNodes((ns) =>
        ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, label } } : n)),
      );
    },
    [setNodes],
  );

  const visibility = useMemo(
    () => computeHidden(nodes, edges, collapsedSet),
    [nodes, edges, collapsedSet],
  );

  const nodesForRender = useMemo(
    () =>
      nodes.map((n) => {
        const type = registry ? getNodeType(registry, n.data.typeId) : undefined;
        const status = type ? getStatus(type, n.data.statusId) : undefined;
        return {
          ...n,
          type: "mind" as const,
          hidden: visibility.hidden.has(n.id),
          data: {
            ...n.data,
            onLabelChange: handleLabelChange,
            collapsed: collapsedSet.has(n.id),
            childCount: visibility.childCountById.get(n.id) ?? 0,
            hiddenDescendantCount:
              visibility.hiddenOnlyDueToN.get(n.id)?.size ?? 0,
            onToggleCollapse,
            typeIcon: type?.icon,
            typeColor: type?.color,
            statusColor: status?.color,
          },
        };
      }),
    [
      nodes,
      handleLabelChange,
      visibility,
      collapsedSet,
      onToggleCollapse,
      registry,
    ],
  );

  const edgesForRender = useMemo(() => {
    const real = edges.map((e) => {
      const edgeType =
        registry && e.data?.typeId
          ? registry.edgeTypes[e.data.typeId]
          : undefined;
      const style: React.CSSProperties = { strokeWidth: 2 };
      if (edgeType?.color) style.stroke = edgeType.color;
      if (edgeType?.lineStyle === "dashed") style.strokeDasharray = "6 4";
      else if (edgeType?.lineStyle === "dotted") style.strokeDasharray = "2 4";
      return {
        ...e,
        hidden:
          visibility.hidden.has(e.source) || visibility.hidden.has(e.target),
        style,
      };
    });

    // Phantom edges: for any real edge that crosses the visible/hidden
    // boundary, synthesize a dashed edge from the responsible collapsed
    // super-node(s) to the visible neighbour. Both-hidden edges become
    // phantom edges between distinct super-nodes.
    type Phantom = {
      id: string;
      source: string;
      target: string;
      hidden: boolean;
      selectable: boolean;
      focusable: boolean;
      style: React.CSSProperties;
      className: string;
    };
    const phantoms: Phantom[] = [];
    const phantomKeys = new Set<string>();
    function addPhantom(source: string, target: string) {
      if (source === target) return;
      const key = `phantom:${source}->${target}`;
      if (phantomKeys.has(key)) return;
      phantomKeys.add(key);
      phantoms.push({
        id: key,
        source,
        target,
        hidden: false,
        selectable: false,
        focusable: false,
        className: "mind-edge--phantom",
        style: {
          stroke: "#94a3b8",
          strokeDasharray: "4 4",
          strokeWidth: 2,
          opacity: 0.65,
        },
      });
    }
    function ownersOf(id: string): string[] {
      const out: string[] = [];
      for (const [n, set] of visibility.hiddenOnlyDueToN) {
        if (set.has(id)) out.push(n);
      }
      return out;
    }
    for (const e of edges) {
      const sHidden = visibility.hidden.has(e.source);
      const tHidden = visibility.hidden.has(e.target);
      if (!sHidden && !tHidden) continue;
      if (sHidden && !tHidden) {
        for (const n of ownersOf(e.source)) addPhantom(n, e.target);
      } else if (!sHidden && tHidden) {
        for (const n of ownersOf(e.target)) addPhantom(e.source, n);
      } else {
        for (const ns of ownersOf(e.source)) {
          for (const nt of ownersOf(e.target)) addPhantom(ns, nt);
        }
      }
    }
    return [...real, ...phantoms];
  }, [edges, visibility, registry]);

  useEffect(() => {
    onGraphSnapshot?.({ nodes, edges });
  }, [nodes, edges, onGraphSnapshot]);

  // Throttle viewport updates so panning doesn't flood the parent.
  const debouncedViewportSnapshot = useMemo(
    () =>
      debounce((v: Viewport) => {
        onViewportSnapshot?.(v);
      }, 200),
    [onViewportSnapshot],
  );

  // Notify parent on selection changes.
  useEffect(() => {
    onSelectionSnapshot?.(selection);
  }, [selection, onSelectionSnapshot]);

  const relayout = useCallback(() => {
    setNodes((ns) => layoutVisibleAware(ns, edges, collapsedSet));
  }, [edges, collapsedSet, setNodes]);

  useEffect(() => {
    setNodes((ns) => layoutVisibleAware(ns, edges, collapsedSet));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the collapsed set changes, re-layout so the visible portion
  // reflows to fill the freed space.
  useEffect(() => {
    setNodes((ns) => layoutVisibleAware(ns, edges, collapsedSet));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsedSet]);

  const onSelectionChange = useCallback(
    ({ nodes: sn, edges: se }: OnSelectionChangeParams) => {
      setSelection({
        nodeIds: sn.map((n) => n.id),
        edgeIds: se.map((e) => e.id),
      });
    },
    [],
  );

  // Atomic: add one new node, with one incoming edge from every parent in parentIds.
  // Position the new node relative to its parents so existing nodes don't move;
  // user clicks Re-layout when they want a clean pass.
  const createNodeWithParents = useCallback(
    (parentIds: string[]) => {
      const id = nextNodeId(new Set(nodes.map((n) => n.id)));
      const parentNodes = parentIds
        .map((pid) => nodes.find((n) => n.id === pid))
        .filter((n): n is MindNode => n !== undefined);
      const position =
        parentNodes.length === 0
          ? { x: 0, y: 0 }
          : {
              x:
                parentNodes.reduce((a, p) => a + p.position.x, 0) /
                parentNodes.length,
              y:
                Math.max(...parentNodes.map((p) => p.position.y)) +
                NODE_HEIGHT +
                60,
            };
      const newNode: MindNode = {
        id,
        type: "mind",
        position,
        data: { label: "New idea" },
        selected: true,
      };
      const newEdges: MindEdge[] = parentIds.map((p) => ({
        id: `e_${p}_${id}`,
        source: p,
        target: id,
      }));
      setEdges([...edges, ...newEdges]);
      setNodes((ns) => [
        ...ns.map((n) => (n.selected ? { ...n, selected: false } : n)),
        newNode,
      ]);
      setSelection({ nodeIds: [id], edgeIds: [] });
    },
    [nodes, edges, setEdges, setNodes],
  );

  const addChild = useCallback(() => {
    const parent = selection.nodeIds[0] ?? nodes[0]?.id;
    if (parent) createNodeWithParents([parent]);
  }, [selection.nodeIds, nodes, createNodeWithParents]);

  const addSibling = useCallback(() => {
    if (selection.nodeIds.length !== 1) return;
    const sel = selection.nodeIds[0];
    const parents = edges
      .filter((e) => e.target === sel)
      .map((e) => e.source);
    if (parents.length === 0) {
      // selected node is a root — fall back to adding a child
      createNodeWithParents([sel]);
    } else {
      createNodeWithParents(parents);
    }
  }, [selection.nodeIds, edges, createNodeWithParents]);

  const addRoot = useCallback(() => {
    createNodeWithParents([]);
  }, [createNodeWithParents]);

  // Node-only delete: removes selected nodes (and their incident edges) plus
  // explicitly selected edges. Descendants survive (possibly orphaned).
  const deleteSelected = useCallback(() => {
    if (selection.nodeIds.length === 0 && selection.edgeIds.length === 0) {
      return;
    }
    const removedNodes = new Set(selection.nodeIds);
    const removedEdges = new Set(selection.edgeIds);
    const remainingEdges = edges.filter(
      (e) =>
        !removedEdges.has(e.id) &&
        !removedNodes.has(e.source) &&
        !removedNodes.has(e.target),
    );
    const remainingNodes = nodes.filter((n) => !removedNodes.has(n.id));
    setEdges(remainingEdges);
    setNodes(remainingNodes);
    setSelection({ nodeIds: [], edgeIds: [] });
  }, [selection, edges, nodes, setEdges, setNodes]);

  // Smart subtree delete: starting from selected nodes, also remove any
  // descendant whose every remaining parent is itself in the deleted set.
  // Nodes with zero incoming edges are treated as roots and never auto-pruned.
  const deleteSubtreeSelected = useCallback(() => {
    if (selection.nodeIds.length === 0 && selection.edgeIds.length === 0) {
      return;
    }
    const deleted = new Set(selection.nodeIds);
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of nodes) {
        if (deleted.has(n.id)) continue;
        const incoming = edges.filter((e) => e.target === n.id);
        if (incoming.length === 0) continue;
        if (incoming.every((e) => deleted.has(e.source))) {
          deleted.add(n.id);
          changed = true;
        }
      }
    }
    const removedEdges = new Set(selection.edgeIds);
    const remainingEdges = edges.filter(
      (e) =>
        !removedEdges.has(e.id) &&
        !deleted.has(e.source) &&
        !deleted.has(e.target),
    );
    const remainingNodes = nodes.filter((n) => !deleted.has(n.id));
    setEdges(remainingEdges);
    setNodes(remainingNodes);
    setSelection({ nodeIds: [], edgeIds: [] });
  }, [selection, edges, nodes, setEdges, setNodes]);

  const renameSelected = useCallback(() => {
    if (selection.nodeIds.length !== 1) return;
    const sel = selection.nodeIds[0];
    setNodes((ns) =>
      ns.map((n) =>
        n.id === sel
          ? { ...n, data: { ...n.data, startEditingToken: Date.now() } }
          : n,
      ),
    );
  }, [selection.nodeIds, setNodes]);

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      if (
        edges.some((e) => e.source === c.source && e.target === c.target)
      ) {
        return;
      }
      setEdges(addEdge(c, edges));
    },
    [edges, setEdges],
  );

  const loadGraph = useCallback(
    (g: Graph, options: { relayout?: boolean; selection?: Selection } = {}) => {
      const selectedNodes = new Set(options.selection?.nodeIds ?? []);
      const selectedEdges = new Set(options.selection?.edgeIds ?? []);
      const typed = g.nodes.map((n) => ({
        ...n,
        type: "mind" as const,
        data: {
          label: n.data.label,
          body: n.data.body,
          typeId: n.data.typeId,
          statusId: n.data.statusId,
        },
        selected: selectedNodes.has(n.id),
      }));
      setEdges(
        g.edges.map((e) => ({
          ...e,
          selected: selectedEdges.has(e.id),
          // Preserve persisted edge data (typeId, body) on reload.
          data: e.data ? { typeId: e.data.typeId, body: e.data.body } : undefined,
        })),
      );
      setNodes(
        options.relayout === false
          ? typed
          : layoutVisibleAware(typed, g.edges, collapsedSet),
      );
      setSelection(options.selection ?? { nodeIds: [], edgeIds: [] });
    },
    [collapsedSet, setEdges, setNodes],
  );

  const exportGraph = useCallback(
    // App's stripFileForPersist takes care of dropping transient runtime
    // fields (selected, dragging, onLabelChange, etc.) and rebuilding
    // node.data with only the persisted shape. Don't strip here too —
    // doing so would silently drop typeId / statusId / body and the
    // dirty-state comparison would never settle after a Save.
    (): Graph => ({ nodes, edges }),
    [nodes, edges],
  );

  const rf = useReactFlow();

  const setViewport = useCallback(
    (v: Viewport) => {
      rf.setViewport(v, { duration: 0 });
    },
    [rf],
  );

  const updateNodeData = useCallback(
    (id: string, patch: Partial<MindNodeData>) => {
      setNodes((ns) =>
        ns.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, ...patch } } : n,
        ),
      );
    },
    [setNodes],
  );

  const updateEdgeData = useCallback(
    (id: string, patch: Partial<MindEdgeData>) => {
      setEdges((es) =>
        es.map((e) =>
          e.id === id ? { ...e, data: { ...(e.data ?? {}), ...patch } } : e,
        ),
      );
    },
    [setEdges],
  );

  const reset = useCallback(() => {
    const root: MindNode = {
      id: nextNodeId(),
      type: "mind",
      position: { x: 0, y: 0 },
      data: { label: "My Paper" },
    };
    setEdges([]);
    setNodes(layoutVisibleAware([root], [], collapsedSet));
    setSelection({ nodeIds: [], edgeIds: [] });
  }, [collapsedSet, setEdges, setNodes]);

  useImperativeHandle(
    ref,
    () => ({
      addChild,
      addSibling,
      addRoot,
      deleteSelected,
      deleteSubtreeSelected,
      renameSelected,
      loadGraph,
      exportGraph,
      reset,
      relayout,
      setViewport,
      updateNodeData,
      updateEdgeData,
    }),
    [
      addChild,
      addSibling,
      addRoot,
      deleteSelected,
      deleteSubtreeSelected,
      renameSelected,
      loadGraph,
      exportGraph,
      reset,
      relayout,
      setViewport,
      updateNodeData,
      updateEdgeData,
    ],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) {
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        addChild();
      } else if (e.key === "Enter") {
        e.preventDefault();
        addSibling();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (
          selection.nodeIds.length === 0 &&
          selection.edgeIds.length === 0
        ) {
          return;
        }
        e.preventDefault();
        if (e.shiftKey) deleteSubtreeSelected();
        else deleteSelected();
      } else if (e.key === "F2") {
        e.preventDefault();
        renameSelected();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    addChild,
    addSibling,
    deleteSelected,
    deleteSubtreeSelected,
    renameSelected,
    selection,
  ]);

  return (
    <ReactFlow
      nodes={nodesForRender}
      edges={edgesForRender}
      onNodesChange={onNodesChange as (c: NodeChange[]) => void}
      onEdgesChange={onEdgesChange as (c: EdgeChange[]) => void}
      onConnect={onConnect}
      onSelectionChange={onSelectionChange}
      onMove={(event, viewport: RFViewport) => {
        // event is null for programmatic moves (fitView, setViewport).
        // Only snapshot real user-driven pans/zooms.
        if (event !== null) debouncedViewportSnapshot(viewport);
      }}
      nodeTypes={nodeTypes}
      defaultEdgeOptions={{ interactionWidth: 30 }}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      deleteKeyCode={null}
      multiSelectionKeyCode="Shift"
    >
      <Background gap={16} />
      <Controls />
      <MiniMap pannable zoomable />
    </ReactFlow>
  );
});

export const MindMap = forwardRef<MindMapHandle, Props>(function MindMap(
  props,
  ref,
) {
  return (
    <ReactFlowProvider>
      <MindMapInner ref={ref} {...props} />
    </ReactFlowProvider>
  );
});
