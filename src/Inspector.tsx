import { useEffect, useRef, useState } from "react";
import { MarkdownView } from "./MarkdownView";
import { getNodeType, getStatus } from "./registry";
import type { MindEdge, MindNode, PaperRef, Registry } from "./types";

type Props = {
  selectedNode: MindNode | null;
  selectedEdge: MindEdge | null;
  selectionCount: number;
  registry: Registry;
  nodeLabel: (id: string) => string;
  onSetNodeLabel: (id: string, label: string) => void;
  onSetNodeType: (id: string, typeId: string | undefined) => void;
  onSetNodeStatus: (id: string, statusId: string | undefined) => void;
  onSetNodeBody: (id: string, body: string) => void;
  onSetNodePaperRefs: (id: string, paperRefs: PaperRef[]) => void;
  onSetEdgeType: (id: string, typeId: string | undefined) => void;
  onSetEdgeBody: (id: string, body: string) => void;
  onSetEdgePaperRefs: (id: string, paperRefs: PaperRef[]) => void;
};

const NO_TYPE = "__none__";

export function Inspector(props: Props) {
  const { selectedNode, selectedEdge, selectionCount } = props;

  if (selectionCount === 0) {
    return (
      <div className="inspector inspector--empty">
        Select a node or edge to edit its type, status, and body.
      </div>
    );
  }
  if (selectionCount > 1) {
    return (
      <div className="inspector inspector--empty">
        {selectionCount} items selected. Select a single node or edge to edit.
      </div>
    );
  }

  if (selectedNode) {
    return <NodeInspector node={selectedNode} {...props} />;
  }
  if (selectedEdge) {
    return <EdgeInspector edge={selectedEdge} {...props} />;
  }
  return (
    <div className="inspector inspector--empty">
      (no selected node or edge)
    </div>
  );
}

function NodeInspector({
  node,
  registry,
  onSetNodeLabel,
  onSetNodeType,
  onSetNodeStatus,
  onSetNodeBody,
  onSetNodePaperRefs,
}: Props & { node: MindNode }) {
  const type = getNodeType(registry, node.data.typeId);
  const status = type ? getStatus(type, node.data.statusId) : undefined;

  return (
    <div className="inspector">
      <div className="inspector__row">
        <label className="inspector__label">ID</label>
        <div className="inspector__readonly inspector__readonly--mono">
          {node.id}
        </div>
      </div>

      <div className="inspector__row">
        <label className="inspector__label">Title</label>
        <input
          key={node.id}
          className="inspector__input"
          defaultValue={node.data.label}
          onBlur={(e) => {
            const next = e.target.value.trim();
            if (next && next !== node.data.label) {
              onSetNodeLabel(node.id, next);
            }
          }}
        />
      </div>

      <div className="inspector__row inspector__row--split">
        <div className="inspector__field">
          <label className="inspector__label">Type</label>
          <select
            className="inspector__select"
            value={node.data.typeId ?? NO_TYPE}
            onChange={(e) => {
              const v = e.target.value;
              onSetNodeType(node.id, v === NO_TYPE ? undefined : v);
            }}
          >
            <option value={NO_TYPE}>(untyped)</option>
            {Object.entries(registry.nodeTypes).map(([id, def]) => (
              <option key={id} value={id}>
                {def.icon ? `${def.icon}  ${def.label}` : def.label}
              </option>
            ))}
          </select>
        </div>

        <div className="inspector__field">
          <label className="inspector__label">Status</label>
          <select
            className="inspector__select"
            value={status?.id ?? NO_TYPE}
            disabled={!type}
            onChange={(e) => {
              const v = e.target.value;
              onSetNodeStatus(node.id, v === NO_TYPE ? undefined : v);
            }}
          >
            <option value={NO_TYPE}>(none)</option>
            {type?.statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <PaperRefsEditor
        key={`refs-${node.id}`}
        refs={node.data.paperRefs ?? []}
        onChange={(refs) => onSetNodePaperRefs(node.id, refs)}
      />

      <BodyEditor
        key={node.id}
        initial={node.data.body ?? ""}
        onChange={(body) => onSetNodeBody(node.id, body)}
      />
    </div>
  );
}

function EdgeInspector({
  edge,
  registry,
  nodeLabel,
  onSetEdgeType,
  onSetEdgeBody,
  onSetEdgePaperRefs,
}: Props & { edge: MindEdge }) {
  const typeId = edge.data?.typeId;

  return (
    <div className="inspector">
      <div className="inspector__row">
        <label className="inspector__label">Edge</label>
        <div className="inspector__readonly">
          {nodeLabel(edge.source)} → {nodeLabel(edge.target)}
        </div>
      </div>

      <div className="inspector__row">
        <label className="inspector__label">Type</label>
        <select
          className="inspector__select"
          value={typeId ?? NO_TYPE}
          onChange={(e) => {
            const v = e.target.value;
            onSetEdgeType(edge.id, v === NO_TYPE ? undefined : v);
          }}
        >
          <option value={NO_TYPE}>(untyped)</option>
          {Object.entries(registry.edgeTypes).map(([id, def]) => (
            <option key={id} value={id}>
              {def.label}
            </option>
          ))}
        </select>
      </div>

      <PaperRefsEditor
        key={`refs-${edge.id}`}
        refs={edge.data?.paperRefs ?? []}
        onChange={(refs) => onSetEdgePaperRefs(edge.id, refs)}
      />

      <BodyEditor
        key={edge.id}
        initial={edge.data?.body ?? ""}
        onChange={(body) => onSetEdgeBody(edge.id, body)}
      />
    </div>
  );
}

// Structured links from the selected element to locations in the prose
// paper. Absence is the normal state (a blueprint may predate any paper),
// so the section renders as just a label and an add row when empty.
// Editing an entry = remove + re-add, mirroring the CLI.
function PaperRefsEditor({
  refs,
  onChange,
}: {
  refs: PaperRef[];
  onChange: (refs: PaperRef[]) => void;
}) {
  const [loc, setLoc] = useState("");
  const [note, setNote] = useState("");

  const add = () => {
    const cleanLoc = loc.trim();
    if (!cleanLoc) return;
    const cleanNote = note.trim();
    onChange([
      ...refs,
      cleanNote ? { loc: cleanLoc, note: cleanNote } : { loc: cleanLoc },
    ]);
    setLoc("");
    setNote("");
  };

  return (
    <div className="inspector__row">
      <label className="inspector__label">Paper refs</label>
      {refs.map((r, i) => (
        <div key={i} className="inspector__ref">
          <span className="inspector__ref-loc">{r.loc}</span>
          {r.note ? <span className="inspector__ref-note">{r.note}</span> : null}
          <button
            className="inspector__ref-remove"
            title="Remove this paper ref"
            onClick={() => onChange(refs.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <div className="inspector__ref-add">
        <input
          className="inspector__input inspector__ref-add-loc"
          placeholder="§4.2 ¶3"
          value={loc}
          onChange={(e) => setLoc(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <input
          className="inspector__input inspector__ref-add-note"
          placeholder="note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <button
          className="inspector__ref-add-button"
          onClick={add}
          disabled={!loc.trim()}
        >
          Add
        </button>
      </div>
    </div>
  );
}

// Markdown source on top, live KaTeX preview below. Local state with a
// short debounce so we don't fire onChange on every keystroke. External
// changes to `initial` (e.g. a remote update) sync into the textarea only
// while the user isn't typing; otherwise they're held and applied on blur
// — same pattern as NotesPanel — so a write from the agent can't yank
// text out from under the cursor.
function BodyEditor({
  initial,
  onChange,
}: {
  initial: string;
  onChange: (body: string) => void;
}) {
  const [text, setText] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFocusedRef = useRef(false);
  const editedSinceFocusRef = useRef(false);
  const pendingExternalRef = useRef<string | null>(null);

  useEffect(() => {
    if (initial === text) {
      pendingExternalRef.current = null;
      return;
    }
    if (isFocusedRef.current) {
      // Defer until the user is done.
      pendingExternalRef.current = initial;
    } else {
      setText(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const schedule = (next: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      onChange(next);
    }, 250);
  };

  return (
    <div className="inspector__body">
      <label className="inspector__label">Body (Markdown + KaTeX)</label>
      <textarea
        className="inspector__body-input"
        value={text}
        onChange={(e) => {
          editedSinceFocusRef.current = true;
          setText(e.target.value);
          schedule(e.target.value);
        }}
        onFocus={() => {
          isFocusedRef.current = true;
          editedSinceFocusRef.current = false;
        }}
        onBlur={() => {
          isFocusedRef.current = false;
          if (timer.current) clearTimeout(timer.current);
          const pending = pendingExternalRef.current;
          pendingExternalRef.current = null;
          if (editedSinceFocusRef.current) {
            // The user's typed text wins over any held external value.
            if (text !== initial) onChange(text);
          } else if (pending !== null) {
            setText(pending);
          }
        }}
        placeholder="Markdown with $math$ and $$display math$$"
        rows={8}
      />
      <div className="inspector__body-preview">
        <MarkdownView source={text} />
      </div>
    </div>
  );
}
