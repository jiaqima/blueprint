import type { NodeTypeDef, Registry, StatusDef } from "./types";

// Pick the effective registry for a given document.
//   per-doc override > workspace > built-in
// No deep merging — keep the rule simple to explain.
export function resolveRegistry(
  builtIn: Registry,
  workspace: Registry | null,
  docOverride: Registry | undefined,
): Registry {
  if (docOverride) return docOverride;
  if (workspace) return workspace;
  return builtIn;
}

// Look up a node type, returning undefined if the typeId is unknown
// (e.g., the user removed it from the registry but a node still references it).
export function getNodeType(
  registry: Registry,
  typeId: string | undefined,
): NodeTypeDef | undefined {
  if (!typeId) return undefined;
  return registry.nodeTypes[typeId];
}

// Look up a status within a node type. Falls back to the type's
// defaultStatus if the statusId isn't valid.
export function getStatus(
  type: NodeTypeDef,
  statusId: string | undefined,
): StatusDef | undefined {
  if (statusId) {
    const s = type.statuses.find((s) => s.id === statusId);
    if (s) return s;
  }
  if (type.defaultStatus) {
    return type.statuses.find((s) => s.id === type.defaultStatus);
  }
  return type.statuses[0];
}
