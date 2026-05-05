import { describe, expect, it } from "vitest";
import { defaultRegistry } from "./graphFile";
import { getNodeType, getStatus, resolveRegistry } from "./registry";
import type { Registry } from "./types";

const builtIn: Registry = defaultRegistry();

const workspace: Registry = {
  nodeTypes: {
    claim: {
      label: "Workspace Claim",
      defaultStatus: "draft",
      statuses: [{ id: "draft", label: "Draft" }],
    },
  },
  edgeTypes: { supports: { label: "Workspace Supports", lineStyle: "solid" } },
};

const docOverride: Registry = {
  nodeTypes: {
    claim: {
      label: "Doc Claim",
      defaultStatus: "draft",
      statuses: [{ id: "draft", label: "Draft" }],
    },
  },
  edgeTypes: { supports: { label: "Doc Supports", lineStyle: "solid" } },
};

describe("resolveRegistry", () => {
  it("returns the per-doc override when present", () => {
    expect(resolveRegistry(builtIn, workspace, docOverride)).toBe(docOverride);
  });

  it("returns the workspace registry when no per-doc override", () => {
    expect(resolveRegistry(builtIn, workspace, undefined)).toBe(workspace);
  });

  it("returns the built-in default when neither workspace nor per-doc is set", () => {
    expect(resolveRegistry(builtIn, null, undefined)).toBe(builtIn);
  });

  it("does NOT deep-merge layers (whole-layer replacement)", () => {
    // Workspace defines only `claim`; resolved registry should not
    // include `evidence` from the built-in.
    const r = resolveRegistry(builtIn, workspace, undefined);
    expect(r.nodeTypes.evidence).toBeUndefined();
    expect(r.nodeTypes.claim?.label).toBe("Workspace Claim");
  });
});

describe("getNodeType", () => {
  it("returns the type def for a known typeId", () => {
    expect(getNodeType(builtIn, "claim")?.label).toBe("Claim");
  });

  it("returns undefined for unknown typeId", () => {
    expect(getNodeType(builtIn, "nope")).toBeUndefined();
  });

  it("returns undefined when typeId is undefined", () => {
    expect(getNodeType(builtIn, undefined)).toBeUndefined();
  });
});

describe("getStatus", () => {
  const claim = builtIn.nodeTypes.claim;

  it("returns the named status when it's in the type's set", () => {
    expect(getStatus(claim, "stated")?.id).toBe("stated");
  });

  it("falls back to the type's defaultStatus when the statusId is invalid", () => {
    // claim.defaultStatus is "draft"; an invalid statusId falls back.
    expect(getStatus(claim, "nonsense")?.id).toBe("draft");
  });

  it("falls back to defaultStatus when statusId is undefined", () => {
    expect(getStatus(claim, undefined)?.id).toBe("draft");
  });

  it("falls back to the first status if defaultStatus is itself missing", () => {
    const oddType = {
      label: "Odd",
      statuses: [{ id: "alpha", label: "Alpha" }],
    };
    expect(getStatus(oddType, undefined)?.id).toBe("alpha");
  });
});
