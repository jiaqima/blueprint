import { useEffect, useRef, useState } from "react";
import { MarkdownView } from "./MarkdownView";
import { getNodeType, getStatus } from "./registry";
import type { MindEdge, MindNode, Registry } from "./types";

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
  onSetEdgeType: (id: string, typeId: string | undefined) => void;
  onSetEdgeBody: (id: string, body: string) => void;
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

      <BodyEditor
        key={edge.id}
        initial={edge.data?.body ?? ""}
        onChange={(body) => onSetEdgeBody(edge.id, body)}
      />
    </div>
  );
}

// Markdown source on top, live KaTeX preview below. Local state with a
// short debounce so we don't fire onChange on every keystroke.
function BodyEditor({
  initial,
  onChange,
}: {
  initial: string;
  onChange: (body: string) => void;
}) {
  const [text, setText] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setText(initial);
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
          setText(e.target.value);
          schedule(e.target.value);
        }}
        onBlur={() => {
          if (timer.current) clearTimeout(timer.current);
          if (text !== initial) onChange(text);
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
