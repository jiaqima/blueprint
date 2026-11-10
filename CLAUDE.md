# CLAUDE.md

Notes for Claude Code working in this repo. Shared agent guidance also lives
in `AGENTS.md` (commit subject style, agent-specific rules about workspace
files vs session state, path-validation guarantees) — read it for anything
that any agent should follow, then come back here for Claude-specific detail.

## What this is

A tool for building **blueprints** of scientific research projects. A
blueprint is the logic chain of a project, organized as a heterogeneous
DAG (typed nodes — claims, evidence, definitions, questions — connected
by typed edges). Humans interact with it via a web canvas (mindmap
visualization, react-flow + dagre); AI agents interact via the bundled
CLI (`bin/blueprint.ts`). Both share the same JSON file shape, so edits
round-trip live.

This tool is part of the **Engineering of Science** project, which aims
to redesign the infrastructure of doing science in the era of AI.

Tech: Vite + React + TypeScript + [react-flow](https://reactflow.dev/)
for rendering and pan/zoom, [dagre](https://github.com/dagrejs/dagre)
for top-to-bottom layout, [react-markdown](https://github.com/remarkjs/react-markdown)
+ [KaTeX](https://katex.org/) for node/edge bodies. In `npm run dev`, a
small Vite plugin exposes a tiny HTTP+SSE API so the browser live-syncs
whenever a workspace file is rewritten — by you (Save / Save As) or by
the CLI. The production build still works — it falls back to local-only
state via `localStorage` recovery and the Import/Export JSON buttons.

For agent-facing usage of the CLI, see `.claude/skills/blueprint/SKILL.md`
(the `/blueprint` skill).

## Commands

- `npm run dev` — Vite dev server with the pair-editing API.
- `npm run build` — `tsc -b && vite build`. Use this to type-check.
- `npm run lint` — ESLint.
- `npm test` — vitest unit suite over the pure core (operations, lint,
  layout, registry, markdown, idgen, graphFile).
- `npm run preview` — serve the production build.

There is no separate `typecheck` script; `npm run build` is the type check.
Strictness: `tsconfig.app.json` (`strict`, `noUnusedLocals`,
`noUnusedParameters`); `src/server/**` is type-checked under
`tsconfig.node.json` (Node types).

## Files vs. state

| Path | Source-controlled? | What it is |
|---|---|---|
| `blueprints/*.json` | gitignored (per-machine) | The workspace. Each `.json` is one blueprint document; the workspace-level registry override lives alongside as `blueprint.types.toml`. **Only manual Save / Save As writes here.** Location is configurable — see below. |
| `blueprint.config.json` | gitignored | Per-machine workspace pointer: `{ "workspace": "~/Documents/blueprints" }`. |
| `examples/` | gitignored | Sample inputs (e.g., Markdown outlines for Import Markdown). |

The shared baseline for the type/status registry is the **built-in
default** in `src/graphFile.ts:defaultRegistry` (which IS source-
controlled). Each machine's `blueprints/blueprint.types.toml` overrides it
locally; the per-doc `GraphFile.registry` overrides both. Workspace
documents themselves are local: agents and humans collaborate on a
machine-by-machine basis, and treating them as source-controlled mixed
content with code didn't fit the use case.

The on-disk workspace dir is resolved at startup in this order, highest
priority first:

1. `BLUEPRINT_WORKSPACE` env var.
2. `blueprint.config.json` at the repo root, field `workspace`.
3. `./blueprints/` (default).

Both the Vite plugin and `bin/blueprint.ts` resolve via the same helper
(`src/server/workspace.ts::getWorkspaceDir`). The on-the-wire path
`blueprints/<name>.json` is a stable logical identifier — clients, the API,
and `localStorage.blueprint.activeDocument.v1` keep using it regardless of
where the workspace lives on disk. The server resolves the basename
against the configured dir.

LocalStorage keys (recovery cache only — not source of truth):
- `blueprint.file.v2` — last in-memory `GraphFile` snapshot (auto-saved, debounced).
- `blueprint.fileDirty.v1` — whether that snapshot held unsaved changes
  (gates the restore-recovered prompt on next launch).
- `blueprint.activeDocument.v1` — which `blueprints/*.json` to reopen on next launch.

## Architecture

Everything lives under `src/`. The data model:

```ts
type Graph     = { nodes: MindNode[]; edges: MindEdge[] };
type GraphFile = Graph & {
  notes: string;
  ui: {
    selection: Selection;
    viewport: Viewport;
    collapsed: string[];   // node ids whose children are hidden in the editor
  };
  registry?: Registry;     // optional per-doc taxonomy override
};

type PaperRef = { loc: string; note?: string };  // e.g. { loc: "§4.2 ¶3" }

type MindNodeData = {
  label: string;
  body?: string;       // Markdown + KaTeX detail rendered in the Inspector
  typeId?: string;     // references registry.nodeTypes
  statusId?: string;   // references the type's statuses
  paperRefs?: PaperRef[];  // optional links into the prose paper; absent
                           // is normal (a blueprint may predate the paper)
};

type MindEdgeData = {
  typeId?: string;     // references registry.edgeTypes
  body?: string;       // Markdown + KaTeX detail (e.g. why X supports Y)
  paperRefs?: PaperRef[];  // same, for the relationship
};

type Registry = {
  nodeTypes: Record<string, NodeTypeDef>;  // claim, evidence, ...
  edgeTypes: Record<string, EdgeTypeDef>;  // supports, contradicts, ...
};
```

Registry resolution at runtime: per-doc `GraphFile.registry` >
workspace `<workspace>/blueprint.types.toml` >
built-in `defaultRegistry()` in `src/graphFile.ts`. No deep merging —
whichever layer is present wins entirely. The browser computes the
effective registry in `src/registry.ts::resolveRegistry`; the CLI uses
`src/cli/operations.ts::effectiveRegistry`.

`MindNode` and `MindEdge` are aliases over react-flow's `Node` / `Edge`. The
graph is conceptually a tree but stored as a generic graph (DAGs work; cycles
render but dagre handles them noisily).

### Editor

- `MindMap.tsx` owns nodes/edges via `useNodesState`/`useEdgesState`, plus a
  `selection: { nodeIds, edgeIds }` synced from react-flow's
  `onSelectionChange`. Exposes `MindMapHandle` for the toolbar / shortcuts and
  emits `onGraphSnapshot` / `onSelectionSnapshot` / `onViewportSnapshot` to
  the parent — the parent (App) owns persistence.
  Two delete modes: `deleteSelected` removes only selected nodes/edges (plus
  incident edges of removed nodes), so shared children survive;
  `deleteSubtreeSelected` additionally prunes any descendant whose every
  remaining parent is in the deleted set. `addSibling` connects the new node
  to every parent of the selected node (multi-parent aware). `onConnect`
  rejects self-loops and duplicates; it does not re-run layout, so existing
  nodes stay where the user put them (Re-layout is a manual button).
  Multi-select via
  shift-click is enabled (`multiSelectionKeyCode="Shift"`); group drag is
  built into react-flow's `applyNodeChanges`, so dragging any selected node
  moves the whole selection — we deliberately don't relayout on plain
  position changes. `onMove` ignores programmatic moves (`event === null`) so
  remote viewport restores don't bounce back as a snapshot.
- `MindMapNode.tsx` is the custom node. The inline-rename `<input>` stops
  keyboard event propagation so global shortcuts don't fire while typing.
  Renders a chevron (▼ / ▶ +N) when the node has children; clicking it
  toggles `ui.collapsed` membership for that node via `data.onToggleCollapse`.
  Also renders an optional type-icon badge in the top-left corner.
- `MindMap.tsx` derives per-node border / background and per-edge stroke /
  dash from the effective registry, in `nodesForRender` / `edgesForRender`
  memos. Imperative `updateNodeData(id, patch)` and `updateEdgeData(id, patch)`
  let the App's Inspector mutate node/edge data without going through a full
  `loadGraph`. The snapshot loop carries those mutations back into App's
  `graphFile` for persistence.
- `Inspector.tsx` is the side-panel editor. When exactly one node is
  selected, it shows title, type/status dropdowns, and a Markdown+KaTeX
  body editor (source on top, live preview below, debounced ~250 ms).
  When one edge is selected, it shows the endpoints (read-only), a type
  dropdown, and the same body editor. Empty state otherwise.
- `MarkdownView.tsx` wraps `react-markdown` with `remark-math` and
  `rehype-katex`. KaTeX CSS is imported globally from this module.
- `App.tsx` fetches the registry on mount via `fetchRegistry()` and
  resolves the effective registry per the rule above. The side panel auto-
  switches between Inspector and Notes based on selection (1 → Inspector,
  0 → Notes; multi-select leaves the current tab alone). User can override
  by clicking a tab.
- Collapse / hide computation lives in `MindMap.tsx::computeHidden`. BFS
  from roots, skipping the children of any collapsed node — anything not
  visited is hidden. Multi-parent: a child stays visible if any other
  parent's path is uncollapsed. `layoutVisibleAware` runs dagre over the
  visible subset so the canvas reflows after a collapse.
- `Toolbar.tsx` carries the file menu (New / Open / Save / Save As) and a
  document name + dirty indicator. File controls are disabled when the
  workspace API isn't reachable (production build, etc.).
- `layout.ts::layoutWithDagre` returns nodes with fresh `position`,
  `sourcePosition`, `targetPosition`; `layoutVisibleAware` runs it over the
  visible subset. Layout is invoked on three events only: initial document
  load, a collapse-set change, and the manual Re-layout button. Structural
  mutations (add, delete, connect) deliberately preserve existing positions
  — `createNodeWithParents` places the new node relative to its parents,
  and delete / `onConnect` leave the rest of the canvas untouched. Don't
  reflexively re-layout on every edit; the user's hand-placed positions
  are load-bearing.
- `markdown.ts` uses a single depth scale: headings get depth 1-6, bullets
  get `100 + indent/2`, so bullets always nest under the nearest heading. If
  the parsed outline has multiple top-level nodes, a synthetic "Outline" root
  is prepended.

### Shared file/state helpers

- `graphFile.ts`: `seedGraphFile`, `defaultUi`, `normalizeGraphFile`
  (defensive parse from JSON of unknown shape), `stripGraphForPersist` /
  `stripFileForPersist` (drop transient fields like `selected`, `dragging`,
  `data.onLabelChange`, `startEditingToken`, and react-flow render
  measurements `width` / `height` / `positionAbsolute` — leaving those in
  makes CLI-written docs read as dirty on open), `graphFileJson` (canonical
  string for dirty-state and dedup comparisons).
- `storage.ts`: `saveRecovery`/`loadRecovery` for the file snapshot (plus
  its dirty flag via `loadRecoveryDirty`),
  `saveActiveDocumentPath`/`loadActiveDocumentPath` for the last-open
  document, `save`/`load` for the legacy graph-only cache, plus a small
  `debounce` helper.
- `types.ts`: shared `Graph`, `GraphFile`, `Selection`, `Viewport` types.
  Reuse these whenever the shape changes.

### App orchestration (`App.tsx`)

Holds the `GraphFile` state, the active document path, the document name,
the dirty flag, and the connection state. Flow:

1. **Initial state**: `loadRecovery()` from localStorage (or `seedGraphFile`).
2. **Workspace probe**: `listDocuments()` from the API. If
   `loadActiveDocumentPath()` matches an entry, `loadDocument(path)` and
   replace the editor — unless the recovery snapshot holds content-level
   unsaved changes for that document, in which case a confirm offers to
   restore them (kept in the editor, marked dirty) instead of replacing.
   Otherwise start with the seeded empty file.
3. **SSE subscription**: scoped to the active document path. On a
   `graph-changed` event for that path: if the editor is clean, re-fetch
   and replace it (skipping the remote viewport if the user has panned in
   the last 5s); if the editor has unsaved changes, show the conflict bar
   ("Load latest" / "Keep my edits") instead of silently replacing them.
4. **Recovery save**: every state change debounces a write of the current
   `GraphFile` to localStorage. **No automatic write to the workspace file.**
5. **Manual Save / Save As**: writes through the workspace API to
   `blueprints/<name>.json`. Save As prompts for a name and supports overwrite
   confirmation (the API returns 409 if the file exists and `overwrite=0`).
6. **Dirty state**: derived by comparing `graphFileJson(currentFile)` to
   `lastSavedJsonRef`. Reset to clean after a successful Save / Save As / Open.

### Sync layer (`sync.ts`)

Per-tab `clientId`. SSE handler drops events whose origin matches its own
clientId. API surface used by App/Toolbar:

- `listDocuments()` → workspace document index.
- `loadDocument(path)` / `saveDocument(path, file)` → existing files.
- `createOrSaveAsDocument(path, file, overwrite)` → returns `"exists"` on
  conflict.
- `subscribe(handlers, path)` → opens an `EventSource` scoped to the
  document path; reconnects on transient errors. No-op if `EventSource` is
  absent or the API isn't reachable (production build).

### Backend (`src/server/blueprint-sync.ts`)

Vite plugin (`apply: "serve"`). Endpoints:

| Method | Path | Notes |
|---|---|---|
| GET | `/api/documents` | List `blueprints/*.json`. |
| GET | `/api/document?path=blueprints/<name>.json` | Read one document. |
| PUT | `/api/document?path=...` | Save in place. |
| POST | `/api/document?path=...&overwrite=0|1` | Create or Save As. 409 if exists and `overwrite=0`. |
| GET | `/api/registry` | `{ workspace: Registry \| null, builtIn: Registry }`. Browser merges per-doc → workspace → built-in via `resolveRegistry`. |
| GET | `/api/config` | `{ workspace, source, envOverride }`. Resolved workspace dir, where it came from, and the `BLUEPRINT_WORKSPACE` env override (or null). |
| PUT | `/api/config` | Body `{ workspace: string \| null }`. Writes (or removes) `blueprint.config.json`, re-binds the file watcher at runtime, and broadcasts `workspace-changed`. 409 when env override is set. |
| GET | `/api/events?path=...` | SSE. Path-scoped subscriptions; events fire only for matching documents. Also emits unscoped `workspace-changed` after a runtime workspace switch. |

**Path validation is strict**: `normalizeDocumentPath` rejects absolute paths,
`..`, NUL bytes, anything outside the wire prefix `blueprints/`, and any
basename that isn't `[A-Za-z0-9][A-Za-z0-9 _.-]*\.json`. Preserve this
when extending the API. The CLI mirrors this same regex in
`src/cli/operations.ts::resolveDocumentPath`. After validation, the wire
basename is resolved against the configured workspace dir via
`src/server/workspace.ts::documentFsPath`.

**Echo suppression**: server writes record `(absolutePath, expectedContent)`
in a 5s window; the matching `fs.watch` event is filtered out by comparing
the file content. External edits (no recent server write) — including writes
from `bin/blueprint.ts` while the dev server is running — are broadcast as
`origin: "external"`. The watcher falls back to polling (1.5s) if `fs.watch`
errors out.

### Blueprint CLI (`bin/blueprint.ts`, `src/cli/operations.ts`)

`bin/blueprint.ts` is a small Node CLI run via `npm run blueprint -- <cmd>`
(uses `tsx` to execute TypeScript directly). It reads and writes
`blueprints/<doc>.json` files on disk — no dev-server dependency. When the
dev server *is* running, the file watcher live-syncs the browser within
~200 ms after the CLI writes.

`src/cli/operations.ts` holds pure, file-free operations over a `GraphFile`
— structure (`addChild`, `addSibling`, `deleteNode`, `move`, `link`,
`unlink`, `synthesize`), content (`setNodeLabel`/`rename`, `setNodeBody`,
`setEdgeBody`, `setNotes`), vocabulary (`setNodeType`, `setNodeStatus`,
`setEdgeType`, `effectiveRegistry`), paper refs (`addPaperRef`,
`removePaperRef`, `clearPaperRefs` + edge variants), plus
`importMarkdown`, `find`, and
`outline`; the pure lint pass lives in `src/lint.ts`. They reuse the existing
`normalizeGraphFile` / `seedGraphFile` / `stripFileForPersist` from
`graphFile.ts` and `parseMarkdownOutline` from `markdown.ts`. Node refs in
the CLI accept either an exact node id (`n_xyz_3`) or a label substring;
ambiguous matches print all candidates and exit non-zero.

The skill at `.claude/skills/blueprint/SKILL.md` documents when and how an
agent should call the CLI; `AGENTS.md` points to the same.

## Pair-editing flow (the user-facing model)

1. The user opens or creates a document in `blueprints/`. The active document
   path is persisted in `localStorage`.
2. The browser auto-saves an in-memory recovery snapshot, but **does not**
   silently overwrite the workspace file. The user (or an agent, via the
   CLI) must explicitly Save.
3. An agent edits `blueprints/<name>.json` via `npm run blueprint -- <cmd>`
   (or in a pinch with normal file tools). The browser sees the SSE event
   and reloads the active document into the editor — or, when the editor
   holds unsaved changes, shows the conflict bar instead of clobbering them.

## Deferred follow-ups

The following enhancements were intentionally deferred when the typed
nodes / statuses / bodies feature shipped. Each is a self-contained next
round; pick one up when the user asks.

1. **Status filter in the toolbar** — small filter bar that dims (or
   hides) nodes whose status doesn't match the selected set. New piece of
   `ui` state; just affects rendering opacity. No schema change.
2. **Critical-path highlight** — color the chain of nodes/edges from the
   root thesis to the leaves, or from the selected node back to the root.
   Helps see the spine when the graph gets busy.
3. **Per-type rollups in the toolbar** — `12 claims, 4 supported, 2 needs-work`
   computed from `effectiveRegistry × graphFile.nodes`. Counts only.
4. **Browser-side lint surfacing** — the lint engine itself has shipped:
   `src/lint.ts` implements 10 soft rules (supports direction and
   grounding, matured-without-support, cycles in the supports subgraph,
   synthesis misuse, lifecycle consistency, vocabulary integrity) as a
   pure function over `GraphFile` × effective registry, exposed via
   `blueprint lint <doc>` and covered by `src/lint.test.ts`. Still
   deferred: surfacing the same issues in the browser (Inspector panel +
   per-node badges), and per-type configurable rules in the registry
   (e.g. `allowedSourceTypes`, `allowedTargetTypes`, `requiresStatus`,
   `requiresIncomingEdgeType`). This is the foundation of a richer
   "blueprint linter" — a key roadmap item for the Engineering of
   Science direction.
5. **Export to a structured Markdown summary** — `blueprint export <doc>
   [--md]` produces a Markdown outline with status badges
   (`- [x] Section 1 — settled`). Useful for sharing snapshots.
6. **Browser-side registry editor** — a small modal in the Inspector tab
   for editing `blueprint.types.toml`. Until then, edit by hand or use an
   agent.
7. **Citation-store / BibTeX integration on `evidence` nodes** —
   `evidence` nodes carry a `citationKey`; workspace `references.bib`
   resolves to rendered citations in the body. Distinct from
   `data.paperRefs` (shipped): that links an element to a location in
   *this project's own* prose paper; the citation store identifies
   *external* sources.

## Conventions

- Keep things simple. One file per concern; no new abstractions, libraries,
  or build steps without a concrete reason. Don't expand the API surface
  beyond what the workspace + CLI flow needs.
- Workspace files are source. LocalStorage is the only recovery cache.
  Manual Save is the only thing that writes a workspace document.
- No new dependencies without checking they're maintained and small.
- The pure core is covered by vitest (`npm test`) — extend those tests
  when changing pure logic (operations, lint, layout, registry, markdown,
  graphFile normalize). Don't add UI/e2e test scaffolding unless asked;
  UI behavior is verified by running `npm run dev` and clicking around.
- Path validation (absolute paths, `..`, basename whitelist, `blueprints/`
  scope) is a load-bearing invariant of the dev API. Keep it strict.
- Keyboard shortcut handler in `MindMap.tsx` ignores events whose target is
  an input/textarea/contenteditable. Preserve this when adding shortcuts.
- Production build must keep working: Import/Export JSON and localStorage
  recovery are the only persistence paths when the API is absent.
- Support arguments (how an evidence supports a claim) live, in
  preference order: (1) on the edge body, (2) in a `synthesis`-typed
  intermediate node when several parents must hold jointly, (3) as a
  `## Support summary` section in the claim body. The `synthesize`
  CLI helper automates (2). Prefer (1) until a joint argument
  genuinely needs a name; synthesis nodes hide structure and degrade
  the dependency graph if overused. The full convention lives in
  `.claude/skills/blueprint/SKILL.md` under "Where support arguments live".

## Verification before reporting done

For UI changes: `npm run dev`, open the app, exercise the changed path
(add/delete/rename, import Markdown, refresh for recovery, switch documents,
Save / Save As, open via the file menu, watch the live sync indicator).
For workspace/sync changes: edit a `blueprints/*.json` from a separate editor
while the browser is open; confirm the canvas updates within ~200ms when the
editor is clean, and that unsaved browser edits raise the conflict bar
instead of being silently replaced. For
production-only changes: `npm run preview` and confirm Import/Export JSON
and the offline state still work. `npm test` guards the pure core;
`npm run build` catches the type-level mistakes; the browser catches
everything else.
