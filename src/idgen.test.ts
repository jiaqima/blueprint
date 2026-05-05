import { describe, expect, it } from "vitest";
import { nextNodeId } from "./idgen";

describe("nextNodeId", () => {
  it("produces ids of shape n_<base62>_<counter>", () => {
    const id = nextNodeId();
    expect(id).toMatch(/^n_[0-9A-Za-z]+_\d+$/);
  });

  it("monotonically increments the counter on consecutive calls", () => {
    const a = nextNodeId();
    const b = nextNodeId();
    const c = nextNodeId();
    const counterOf = (s: string) =>
      Number(s.slice(s.lastIndexOf("_") + 1));
    expect(counterOf(b)).toBe(counterOf(a) + 1);
    expect(counterOf(c)).toBe(counterOf(b) + 1);
  });

  it("advances the counter past collisions in the existing set", () => {
    // Mint one id, build an `existing` that contains it plus the next
    // few counter values, and verify the next call returns a free
    // counter beyond them.
    const seed = nextNodeId();
    const m = seed.match(/^n_(.+)_(\d+)$/);
    expect(m).not.toBeNull();
    const ts = m![1];
    const start = Number(m![2]);
    const taken = new Set([
      seed,
      `n_${ts}_${start + 1}`,
      `n_${ts}_${start + 2}`,
    ]);
    const fresh = nextNodeId(taken);
    expect(taken.has(fresh)).toBe(false);
    expect(fresh).toMatch(/^n_[0-9A-Za-z]+_\d+$/);
  });

  it("treats an empty existing set the same as undefined", () => {
    const a = nextNodeId(new Set());
    const b = nextNodeId();
    expect(a).toMatch(/^n_[0-9A-Za-z]+_\d+$/);
    expect(b).toMatch(/^n_[0-9A-Za-z]+_\d+$/);
    expect(a).not.toEqual(b);
  });
});
