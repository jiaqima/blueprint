import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import type { MindNodeData } from "./types";

function MindMapNodeImpl({ id, data, selected }: NodeProps<MindNodeData>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.label);
  const inputRef = useRef<HTMLInputElement>(null);

  // External request to start editing (e.g. F2 keyboard shortcut)
  useEffect(() => {
    if (data.startEditingToken !== undefined) {
      setDraft(data.label);
      setEditing(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.startEditingToken]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  // Keep draft in sync if label changes externally and we're not editing
  useEffect(() => {
    if (!editing) setDraft(data.label);
  }, [data.label, editing]);

  const commit = () => {
    const next = draft.trim() || data.label;
    if (next !== data.label) data.onLabelChange?.(id, next);
    setEditing(false);
  };

  const cancel = () => {
    setDraft(data.label);
    setEditing(false);
  };

  const childCount = data.childCount ?? 0;
  const isCollapsed = !!data.collapsed;
  const hiddenCount = data.hiddenDescendantCount ?? 0;
  const showChevron = childCount > 0;

  const className =
    "mind-node" +
    (selected ? " mind-node--selected" : "") +
    (isCollapsed ? " mind-node--collapsed" : "");

  const typeIcon = data.typeIcon;
  const typeColor = data.typeColor;
  const statusColor = data.statusColor;
  const innerStyle: CSSProperties = {};
  if (typeColor) innerStyle.borderColor = typeColor;
  if (statusColor) innerStyle.backgroundColor = statusColor;

  return (
    <div
      className={className}
      style={innerStyle}
      onDoubleClick={() => setEditing(true)}
    >
      <Handle type="target" position={Position.Top} />
      {typeIcon && (
        <span
          className="mind-node__type-badge"
          title={typeIcon}
          style={typeColor ? { color: typeColor } : undefined}
        >
          {typeIcon}
        </span>
      )}
      {editing ? (
        <input
          ref={inputRef}
          className="mind-node__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
            // Stop these from bubbling up to global shortcuts
            e.stopPropagation();
          }}
        />
      ) : (
        <span className="mind-node__label">
          <span className="mind-node__id" title={id}>
            {id.replace(/^n_/, "")}
          </span>
          {data.label}
        </span>
      )}
      {showChevron && (
        <button
          type="button"
          className="mind-node__chevron"
          aria-label={isCollapsed ? "Expand" : "Collapse"}
          title={
            isCollapsed
              ? `Expand (${hiddenCount} hidden)`
              : `Collapse subtree`
          }
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            data.onToggleCollapse?.(id);
          }}
        >
          {isCollapsed ? `▶ +${hiddenCount}` : "▼"}
        </button>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export const MindMapNode = memo(MindMapNodeImpl);
