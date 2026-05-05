// Soft structural warnings for mindmap documents. Pure function over a
// GraphFile + the effective Registry. The CLI surfaces issues via the
// `lint` command; the browser may surface them in the Inspector later.
//
// Rules are intentionally conservative: each one captures a structural
// pattern that almost always indicates a mistake (e.g. a `supports` edge
// that runs claim → evidence — backwards by convention) rather than a
// stylistic concern. Adding a rule should be cheap; ignoring rules at
// the call site is the user's prerogative.
import type { GraphFile, MindNode, Registry } from "./types";

export type LintIssue = {
  ruleId: string;
  severity: "warn" | "error";
  target: { kind: "node"; id: string } | { kind: "edge"; id: string };
  message: string;
};

// A node is "grounded" iff its assertion can rest on something already
// settled: an assumption (taken as given), evidence (cited or verified
// against an external source), a stated definition, a supported
// claim, or a stated synthesis whose own supporters are all
// grounded (recursive).
//
// This is a *necessary* condition for the node's status to be honest,
// not a sufficient one — argument quality (does the inference actually
// hold?) is a human judgment the lint can't make.
function isGrounded(
  file: GraphFile,
  n: MindNode,
  memo: Map<string, boolean>,
): boolean {
  const cached = memo.get(n.id);
  if (cached !== undefined) return cached;
  // Cycle guard: assume not grounded while computing recursively.
  memo.set(n.id, false);

  const t = n.data.typeId;
  const s = n.data.statusId;
  let result = false;
  if (t === "assumption") {
    result = true;
  } else if (t === "evidence" && (s === "cited" || s === "verified")) {
    result = true;
  } else if (t === "definition" && s === "stated") {
    result = true;
  } else if (t === "claim" && s === "supported") {
    result = true;
  } else if (t === "synthesis" && s === "stated") {
    const incoming = file.edges.filter(
      (e) => e.target === n.id && e.data?.typeId === "supports",
    );
    result =
      incoming.length > 0 &&
      incoming.every((e) => {
        const src = file.nodes.find((x) => x.id === e.source);
        return src ? isGrounded(file, src, memo) : false;
      });
  }
  memo.set(n.id, result);
  return result;
}

// A node has a "matured-supports" status when the user is asserting
// that its argument is complete: a supported claim or a stated
// synthesis. These are the states where loose ends in the support
// graph are bugs, not work-in-progress.
function isMatured(n: MindNode): boolean {
  const t = n.data.typeId;
  const s = n.data.statusId;
  return (
    (t === "claim" && s === "supported") ||
    (t === "synthesis" && s === "stated")
  );
}

function describeNode(n: MindNode): string {
  const t = n.data.typeId ?? "(untyped)";
  const s = n.data.statusId ?? "(no status)";
  return `${t} · ${s}`;
}

export function lint(file: GraphFile, registry: Registry): LintIssue[] {
  const issues: LintIssue[] = [];
  const nodeById = new Map(file.nodes.map((n) => [n.id, n]));
  const groundedMemo = new Map<string, boolean>();

  // Rule "supports-direction": a `supports` edge whose source is a `claim`
  // and whose target is `evidence` is backwards. Convention is
  // evidence → claim (evidence supports the claim).
  //
  // Rule "support-needs-explanation": a `supports` edge from `evidence`
  // to `claim` with no edge body — the relational explanation is missing.
  //
  // Rule "supports-source-not-grounded": a `supports` edge into a
  // matured node whose source is not itself grounded. The matured node
  // is asserting completeness on a non-grounded premise — necessary
  // condition for soundness fails.
  for (const edge of file.edges) {
    if (edge.data?.typeId !== "supports") continue;
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;

    if (
      source.data.typeId === "claim" &&
      target.data.typeId === "evidence"
    ) {
      issues.push({
        ruleId: "supports-direction",
        severity: "warn",
        target: { kind: "edge", id: edge.id },
        message:
          "'supports' edge runs claim → evidence; expected evidence → claim. " +
          "Try: unlink, then link with source/target swapped.",
      });
      continue;
    }

    if (
      source.data.typeId === "evidence" &&
      target.data.typeId === "claim" &&
      (edge.data?.body ?? "").trim() === ""
    ) {
      issues.push({
        ruleId: "support-needs-explanation",
        severity: "warn",
        target: { kind: "edge", id: edge.id },
        message:
          "'supports' edge has no body — consider explaining how the evidence " +
          "bears on the claim with `edgebody --set \"...\"`, or, when the claim " +
          "only holds with several parents jointly, route them through a " +
          "`synthesis` node (see `synthesize`).",
      });
    }

    if (isMatured(target) && !isGrounded(file, source, groundedMemo)) {
      issues.push({
        ruleId: "supports-source-not-grounded",
        severity: "warn",
        target: { kind: "edge", id: edge.id },
        message:
          `'supports' edge into a matured node has a non-grounded source ` +
          `(${describeNode(source)}). Either ground the source (e.g. promote ` +
          `to supported / cited / stated) or downgrade the target's status.`,
      });
    }
  }

  // Rule "matured-without-support": a matured node with no incoming
  // `supports` edges. The user has marked the argument complete but
  // there's nothing supporting it.
  //
  // Rule "synthesis-with-single-parent": synthesis is for *joint*
  // support; a single supporter wraps one edge in a node and hides
  // structure. Suggest replacing with a direct `supports` edge.
  const incomingSupportsByTarget = new Map<string, number>();
  for (const e of file.edges) {
    if (e.data?.typeId !== "supports") continue;
    incomingSupportsByTarget.set(
      e.target,
      (incomingSupportsByTarget.get(e.target) ?? 0) + 1,
    );
  }
  for (const node of file.nodes) {
    const incoming = incomingSupportsByTarget.get(node.id) ?? 0;
    if (isMatured(node) && incoming === 0) {
      issues.push({
        ruleId: "matured-without-support",
        severity: "warn",
        target: { kind: "node", id: node.id },
        message:
          `${describeNode(node)} node has no incoming 'supports' edges; either ` +
          `add supports or downgrade the status.`,
      });
    }
    if (node.data.typeId === "synthesis" && incoming === 1) {
      issues.push({
        ruleId: "synthesis-with-single-parent",
        severity: "warn",
        target: { kind: "node", id: node.id },
        message:
          "synthesis node has only one incoming 'supports' edge; synthesis is " +
          "for *joint* support — replace with a direct supports edge from the " +
          "single parent.",
      });
    }
  }

  // Rule "empty-synthesis": a `synthesis · stated` whose body is empty.
  // The whole point of a synthesis is to carry the joint argument that
  // didn't fit on a single edge; without a body, the argument is lost.
  for (const node of file.nodes) {
    if (node.data.typeId !== "synthesis") continue;
    if (node.data.statusId !== "stated") continue;
    if ((node.data.body ?? "").trim() !== "") continue;
    issues.push({
      ruleId: "empty-synthesis",
      severity: "warn",
      target: { kind: "node", id: node.id },
      message:
        "synthesis · stated has no body — set the joint argument with " +
        "`body --set \"...\"`, or downgrade to draft until it's written.",
    });
  }

  // Rule "empty-label": a node whose label is empty or whitespace-only.
  // The canvas shows nothing; CLI label-resolution can't find it.
  for (const node of file.nodes) {
    if ((node.data.label ?? "").trim() !== "") continue;
    issues.push({
      ruleId: "empty-label",
      severity: "warn",
      target: { kind: "node", id: node.id },
      message: "node has an empty label — set one with `label --set \"...\"`.",
    });
  }

  // Rules "untyped-node" / "unknown-typeid" / "unknown-statusid":
  // walk nodes against the effective registry. A typeId that isn't in
  // the registry, or a statusId that isn't in the type's status set,
  // is dead weight — usually a registry rename / removal that left
  // documents out of sync.
  for (const node of file.nodes) {
    const t = node.data.typeId;
    if (t === undefined) {
      issues.push({
        ruleId: "untyped-node",
        severity: "warn",
        target: { kind: "node", id: node.id },
        message:
          "node has no type — assign one with `settype --type <typeId>`.",
      });
      continue;
    }
    const typeDef = registry.nodeTypes[t];
    if (typeDef === undefined) {
      issues.push({
        ruleId: "unknown-typeid",
        severity: "warn",
        target: { kind: "node", id: node.id },
        message: `node typeId "${t}" is not in the effective registry.`,
      });
      continue;
    }
    const s = node.data.statusId;
    if (s !== undefined && !typeDef.statuses.some((x) => x.id === s)) {
      issues.push({
        ruleId: "unknown-statusid",
        severity: "warn",
        target: { kind: "node", id: node.id },
        message:
          `node statusId "${s}" is not in the "${t}" type's status set.`,
      });
    }
  }

  // Rule "unknown-edge-typeid": an edge typeId not in the registry.
  // Untyped edges are tolerated (they default to "expands" semantics).
  for (const edge of file.edges) {
    const t = edge.data?.typeId;
    if (t === undefined) continue;
    if (registry.edgeTypes[t] !== undefined) continue;
    issues.push({
      ruleId: "unknown-edge-typeid",
      severity: "warn",
      target: { kind: "edge", id: edge.id },
      message: `edge typeId "${t}" is not in the effective registry.`,
    });
  }

  // Rule "cycle-in-supports": `supports` edges form a directed cycle.
  // Today `isGrounded` silently treats the cycle path as not-grounded;
  // surfacing the back-edge helps the user break the loop.
  const supportsAdj = new Map<string, string[]>();
  const supportsEdgeId = new Map<string, string>(); // "src tgt" → edgeId
  for (const e of file.edges) {
    if (e.data?.typeId !== "supports") continue;
    if (!nodeById.has(e.source) || !nodeById.has(e.target)) continue;
    const list = supportsAdj.get(e.source) ?? [];
    list.push(e.target);
    supportsAdj.set(e.source, list);
    supportsEdgeId.set(`${e.source} ${e.target}`, e.id);
  }
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const cycleEdges = new Set<string>();
  for (const start of file.nodes) {
    if ((color.get(start.id) ?? WHITE) !== WHITE) continue;
    // Iterative DFS so deep blueprints don't blow the stack.
    const stack: { id: string; iter: Iterator<string> }[] = [
      { id: start.id, iter: (supportsAdj.get(start.id) ?? [])[Symbol.iterator]() },
    ];
    color.set(start.id, GRAY);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const next = top.iter.next();
      if (next.done) {
        color.set(top.id, BLACK);
        stack.pop();
        continue;
      }
      const v = next.value;
      const c = color.get(v) ?? WHITE;
      if (c === GRAY) {
        const eid = supportsEdgeId.get(`${top.id} ${v}`);
        if (eid) cycleEdges.add(eid);
      } else if (c === WHITE) {
        color.set(v, GRAY);
        stack.push({ id: v, iter: (supportsAdj.get(v) ?? [])[Symbol.iterator]() });
      }
    }
  }
  for (const eid of cycleEdges) {
    issues.push({
      ruleId: "cycle-in-supports",
      severity: "warn",
      target: { kind: "edge", id: eid },
      message:
        "'supports' edges form a cycle through this edge — circular " +
        "reasoning. Break the cycle by re-rooting one of the supports.",
    });
  }

  // Rule "open-question-on-supported-claim": a `question · open` node
  // adjacent (any edge, any direction) to a matured node. The user is
  // asserting completeness while a question is hanging — answer it or
  // downgrade the matured node.
  const maturedIds = new Set(
    file.nodes.filter(isMatured).map((n) => n.id),
  );
  const reportedQuestionIds = new Set<string>();
  for (const edge of file.edges) {
    const src = nodeById.get(edge.source);
    const tgt = nodeById.get(edge.target);
    if (!src || !tgt) continue;
    let question: MindNode | null = null;
    let other: MindNode | null = null;
    if (
      src.data.typeId === "question" &&
      src.data.statusId === "open" &&
      maturedIds.has(tgt.id)
    ) {
      question = src;
      other = tgt;
    } else if (
      tgt.data.typeId === "question" &&
      tgt.data.statusId === "open" &&
      maturedIds.has(src.id)
    ) {
      question = tgt;
      other = src;
    }
    if (!question || reportedQuestionIds.has(question.id)) continue;
    reportedQuestionIds.add(question.id);
    issues.push({
      ruleId: "open-question-on-supported-claim",
      severity: "warn",
      target: { kind: "node", id: question.id },
      message:
        `question · open is connected to a matured ${describeNode(other!)} ` +
        `node; either answer the question (status → answered) or downgrade ` +
        `the matured node's status.`,
    });
  }

  return issues;
}
