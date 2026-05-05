// System node-id generator. Shared between the browser (MindMap.tsx,
// when the user creates a node on the canvas) and the CLI
// (cli/operations.ts, when an `add` / `synthesize` etc. mints one).
//
// Shape: `n_<base62 seconds since epoch>_<counter>`, e.g. "n_1wIjg7_1".
//   - The `n_` prefix distinguishes node ids from edge ids (`e_…`).
//   - Seconds-since-epoch in base62 keeps the timestamp portion ~6
//     chars (vs ~8 for ms-in-base36).
//   - The counter disambiguates ids minted in the same second.
//
// `idCounter` is process-local and resets per process. The browser is
// one long-running process so the counter monotonically grows. The CLI
// runs as a fresh process per command, so back-to-back CLI calls in
// the same second would all start at counter=1 and collide. To handle
// that, callers pass the existing-id set; nextNodeId advances the
// counter past any collisions before returning. For typical doc sizes
// the loop body runs ≤ a handful of times.

const BASE62 =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function base62(n: number): string {
  if (n === 0) return "0";
  let s = "";
  while (n > 0) {
    s = BASE62[n % 62] + s;
    n = Math.floor(n / 62);
  }
  return s;
}

let idCounter = 0;

export function nextNodeId(existing?: ReadonlySet<string>): string {
  while (true) {
    idCounter += 1;
    const candidate = `n_${base62(Math.floor(Date.now() / 1000))}_${idCounter}`;
    if (!existing?.has(candidate)) return candidate;
  }
}
