# Blueprint

Blueprint is a tool for building **blueprints** — typed argument graphs — of research projects, with first-class interfaces for both humans and AI agents. The browser canvas (rendered as a mindmap) and the bundled CLI read and write the same JSON document; edits round-trip live, so a researcher and their coding agent (Claude Code, Codex, …) can think on the same artifact in parallel.

This tool is part of the **Engineering of Science** project, which aims to redesign the infrastructure of doing science in the era of AI.

## What is a blueprint?

A blueprint is the logic structure of a research project, represented by a heterogeneous DAG of typed nodes (claims, evidence, assumptions, definitions, questions, …) connected by typed relations (expands, supports, contradicts, …).

The idea is inspired by Patrick Massot's [leanblueprint](https://github.com/PatrickMassot/leanblueprint), where the same notion — typed nodes with status ladders for structural review of an argument — is used to plan and verify formal proofs in Lean. Terry Tao's ["Formalizing the proof of PFR in Lean4 using Blueprint — a short tour"](https://terrytao.wordpress.com/2023/11/18/formalizing-the-proof-of-pfr-in-lean4-using-blueprint-a-short-tour/) is the canonical demonstration.

To accommodate research beyond mathematics, a key difference made here is that the **statuses** encode **a lifecycle of settledness** (`draft → stated → supported` for a claim, `missing → cited → verified` for evidence) rather than a *binary* proof-checked flag. The graph captures the structure of an argument; statuses track where each piece is in its arc.

The built-in node types covers four concerns:

- **Argument core** — `claim`, `evidence`, `assumption`. Every argument bottoms out here: claims are the proposed conclusions, evidence is what we observe, assumptions are what we take as given.
- **Construction handles** — `definition` (pin a key concept so it can be referred to precisely), `question` (open-ended intermediate during construction; doubles as a future-work flag).
- **Review channel** — `risk` lets a reviewer (human or AI) attach a counter-argument or suspicion to a specific claim, in place.
- **Flexibility valve** — `synthesis` carries prose when a joint argument across several premises doesn't fit on a single edge. Use sparingly: synthesis nodes hide structure inside their bodies, the opposite of what the typed graph is for.

Edges carry types too — `supports` (evidence backs claim), `expands` (child elaborates parent), `contradicts`, `relates`, `addresses` — and may carry their own Markdown+KaTeX bodies when the relationship needs explanation.

## Design principles

1. **Verification-friendly structure.** A typed argument graph makes review more efficient. A reviewer — collaborator, advisor, or AI agent — can focus on a local region (one claim and its supporters) without holding the whole project in working memory. Critically, the structure exposes assumptions: the lint enforces that every matured claim traces back to evidence or assumptions through the support graph, minimizing room for implicit premises to hide. The hypothesis is that *exposed* structure beats *prose* structure when the goal is to verify an argument.

2. **Extensible types, statuses, and rules.** The types, statuses, and lint rules can all be customized and extended. Different disciplines and research paradigms can shape the vocabulary to their needs.

3. **Soft enforcement.** Lint flags structural issues but never blocks. The user owns the rigor decision; the tool helps them see it.

4. **Two first-class interfaces for human-AI collaboration.** Human-AI collaboration is natively supported. The mindmap canvas (humans visualize and edit) and the CLI tools (AI agents issue structured commands) are both first-class interfaces. Both read and write the same JSON document; edits round-trip live through the dev-server file watcher. The reasoning is that an active research project deserves a substrate where a researcher and their agent think on the same interface, in parallel — not ferry state across chat windows.

## Architecture

The components and how they fit:

```
   Canvas (browser)  ◄── HTTP + SSE ──►  dev-server (Vite plugin)
                                                  │
                                          fs read / write / watch
                                                  │
                                                  ▼
                                          blueprints/<doc>.json
                                                  ▲
                                                  │
                                          fs read / write
                                                  │
                                          CLI (`blueprint` command)
```

- **Canvas (browser)** — the human interface. Pan/zoom, typed nodes and edges, Markdown+KaTeX bodies, Inspector. Vite + React + [react-flow](https://reactflow.dev/) + [dagre](https://github.com/dagrejs/dagre).
- **CLI (`bin/blueprint.ts`)** — the agent interface. Pure operations on the graph live in `src/cli/operations.ts`; the bin is a thin file-I/O shell on top.
- **Dev-server sync API** (`src/server/blueprint-sync.ts`) — the bridge. HTTP for save / load / list, Server-Sent Events for live notification when any process rewrites a workspace file.
- **Registry** (`src/registry.ts`, `<workspace>/blueprint.types.toml`) — the extensible vocabulary. Resolution: per-doc override → workspace override → built-in default; whole-layer replacement, no deep merge.
- **Lint** (`src/lint.ts`) — the structural guardrails. Pure function over (GraphFile × Registry); 10 rules grouped along soundness / structure / lifecycle / vocabulary axes. CLI interface today, Inspector later.

## Run it

```bash
npm install
npm run dev
```

Then open the URL Vite prints (default `http://localhost:5173`).

## Use it (the canvas)

The canvas is the human interface — the agent works on the same file via the CLI (see below).

- **Pan**: drag the empty canvas. **Zoom**: scroll, pinch, or use the bottom-left controls.
- **Select** a node or edge by clicking it. **Multi-select**: hold `Shift` and click to extend the selection. Drag any node in a multi-selection to move all selected nodes together.
- **Add child** of the selected node: button or `Tab`.
- **Add sibling** of the selected node: button or `Enter`. If the selected node has multiple parents, the new node is connected to *all* of them.
- **Add root** (an unconnected node): button. Useful for starting a new sub-tree or parking a thought before deciding where it slots in.
- **Rename**: double-click the node, or press `F2` while it is selected.
- **Delete**: button or `Delete` / `Backspace`. Removes only the selected node(s) and edge(s); descendants survive (possibly disconnected).
- **Delete subtree**: button or `Shift`+`Delete`. Removes the selected node(s) plus any descendant whose remaining ancestors all trace back through the deletion (so shared children with another live parent stay).
- **Connect nodes manually**: drag from a node's bottom handle to another node's top handle. Self-loops and duplicate edges are ignored. Edits don't trigger a layout pass — existing nodes stay where you put them.
- **Collapse / expand a subtree**: click the small chevron on a node with children. Collapsed nodes show a `+N` badge with the count of descendants the collapse will *actually* hide (under multi-parent / DAG semantics). Edges that cross between the collapsed subtree and the rest of the graph render as dashed phantom edges from the collapsed super-node, so external connections stay visible.
- **Inspect a node or edge**: click it. The right side panel's **Inspector** tab shows the system id, title, type, status, and a Markdown+KaTeX body editor (live preview below the source). Edges have type + body too — useful for spelling out *why* X supports / contradicts Y.
- **Re-layout**: button. Runs dagre top-to-bottom on the visible subset; disconnected components are laid out independently and packed left-to-right with a gap so they don't collide.
- **Import Markdown**: paste an outline. Headings (`#`, `##`, ...) and indented bullets (`-`, `*`, `+`, `1.`) both nest correctly. Mixed is fine.
- **Import / Export JSON**: round-trip the graph as a JSON file.
- **Reset**: clear the current blueprint and start from a single root node.

The current document auto-saves a recovery snapshot to `localStorage`. **Manual Save / Save As** writes to `blueprints/<name>.json` — these workspace documents are **per-machine and gitignored**, so your blueprints stay yours and don't drift into the repo's history alongside the code. If the app reopens holding recovered unsaved changes that differ from the saved file, it asks whether to restore them or load the file.

The right-side **Notes** panel is a per-document free-form scratchpad shared with whatever agent is editing the file.

## Pair editing with a coding agent

The CLI is the agent's first-class interface — same JSON document as the canvas, edits round-trip live.

You talk to your agent (Claude Code, Codex, ...) in your usual chat interface and have it manipulate blueprints via the bundled CLI:

```bash
npm run blueprint -- list
npm run blueprint -- show paper
npm run blueprint -- add paper --parent "Introduction" --label "Motivation"
npm run blueprint -- label paper "Motivation" --set "Why this paper exists"
npm run blueprint -- body paper "Motivation" --set "## Why\n\n..."
npm run blueprint -- lint paper      # soft warnings on structural issues
npm run blueprint -- import-md paper --file outline.md
npm run blueprint -- --help          # full command list
```

The CLI rewrites `blueprints/<name>.json` directly. If `npm run dev` is running, the dev-server file watcher picks up the change and live-syncs your browser within ~200 ms. If you have unsaved canvas edits when an external write lands, the canvas doesn't silently reload: a conflict bar appears offering **Load latest** (discard your edits) or **Keep my edits** (your next Save overwrites the file).

For Claude Code, the `/blueprint` skill at `.claude/skills/blueprint/SKILL.md` auto-loads when you're working in this repo and tells the agent when and how to use the CLI. For Codex, the `$blueprint` skill lives at `.codex/skills/blueprint/SKILL.md`.

### Customizing types and statuses

The vocabulary in "What is a blueprint?" is the built-in default. The full taxonomy is **extensible**, with three layers of resolution (highest priority first):

1. Per-document override at `GraphFile.registry`.
2. Workspace-level registry at `<workspace>/blueprint.types.toml` (gitignored).
3. Built-in default (7 node types × 2–3 statuses each, 5 edge types).

Set up a workspace registry:

```bash
npm run blueprint -- registry --init      # writes <workspace>/blueprint.types.toml
npm run blueprint -- registry --workspace # print it
```

Edit the TOML freely to add or rename types and statuses — comments are welcome. Per-doc overrides go in the `registry` field of any `blueprints/<doc>.json` (still JSON, since it's embedded in the document).

CLI for setting types, statuses, labels, and bodies on nodes and edges:

```bash
npm run blueprint -- settype paper "Section 1" --type claim
npm run blueprint -- setstatus paper "Section 1" --status stated
npm run blueprint -- body paper "Section 1" --set "Why this section..."
npm run blueprint -- setedgetype paper "Section 1" "Section 2" --type supports
npm run blueprint -- edgebody paper "Section 1" "Section 2" --set "X is a special case of Y"
npm run blueprint -- show paper            # outline now shows [type · status]
```

Nodes and edges can also carry **paper references** — structured links
(`{ "loc": "§4.2 ¶3", "note": "..." }`) to where the element lives in the
prose paper. Keep locators there rather than in bodies, so a paper
revision means updating data instead of rewriting argument text. A
blueprint created at project inception simply has none until a draft
exists.

```bash
npm run blueprint -- paperref paper "Section 1" --add "§2 ¶1" --note "where stated"
npm run blueprint -- paperref paper "Section 1"              # print (numbered)
npm run blueprint -- paperref paper "Section 1" --remove 1   # by printed index
npm run blueprint -- edgepaperref paper "Section 1" "Section 2" --add "§5 ¶1"
```

When several pieces of evidence (or claims) only support a downstream claim *jointly* and the joint argument doesn't fit on a single edge, collapse them under a `synthesis` node:

```bash
npm run blueprint -- synthesize paper "Claim X" "Evidence 1" "Evidence 2" \
  --label "All three failures" \
  --body "## Joint argument\n\nE-1, E-2 together rule out ..."
```

The `synthesize` helper inserts a `synthesis`-typed intermediate node, rewires each parent's `supports` edge through it, and adds the `synthesis → claim` edge. Use sparingly — synthesis nodes hide structure; per-edge bodies are the default.

### Lint

Extensible vocabulary, soft enforcement — `blueprint lint <doc>` warns but never blocks; the user owns the rigor decision. Current rules (all `warn` severity) along four axes:

- **Soundness of the support graph** — `supports` running the wrong way (claim → evidence), `supports` without an explanation body, `supports` into a matured node from a non-grounded source, and matured nodes with no incoming `supports` at all.
- **Argument structure** — directed cycles in the `supports` subgraph, `synthesis` with a single supporter (synthesis is for *joint* support), and `synthesis · stated` with an empty body.
- **Lifecycle consistency** — an open `question` adjacent to a matured node (the user has asserted completeness while a question hangs).
- **Vocabulary integrity** against the effective registry — node and edge type/status ids that don't exist in the registry, plus empty labels.

In the browser, click a node or edge → the **Inspector** tab opens with the system id (read-only), type/status dropdowns, a Markdown+KaTeX body editor, and a live preview.

## Configuring the workspace

By default, blueprint documents live at `./blueprints/` inside the repo. If you'd rather keep them somewhere safer (e.g. outside any repo where the agent might be iterating on code), point both the CLI and the dev server at a different directory:

```bash
# Per-run override
BLUEPRINT_WORKSPACE=~/Documents/blueprints npm run dev

# Or sticky per-machine setting (gitignored)
echo '{"workspace": "~/Documents/blueprints"}' > blueprint.config.json
npm run blueprint -- config       # → /Users/.../Documents/blueprints  (from config)
```

Resolution order: env var > `blueprint.config.json` > `./blueprints/`. Paths support `~` and resolve relative to the repo root. To migrate, just `mv` your `blueprints/*.json` files into the new location — the on-the-wire `blueprints/<name>.json` identifier (used by the API and your browser's active-document pointer) is just a logical name and survives the move.

The easiest way to switch workspaces is in the browser: click the **⚙ Settings** button in the toolbar, type a new path, click Save. The dev server re-reads the config and re-binds the file watcher at runtime, no `npm run dev` restart needed. When `BLUEPRINT_WORKSPACE` is set in your shell, the modal interfaces that and disables the input — the env var always wins.

## Build

```bash
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build locally
```

The dev-server file API and live sync are dev-only. The static production build still works (Import/Export JSON + localStorage recovery) but doesn't talk to the workspace files.

## Project layout

```
src/
  main.tsx              React root
  App.tsx               Top-level layout (toolbar + canvas + notes panel)
  MindMap.tsx           react-flow wrapper, state, keyboard shortcuts, imperative API
  MindMapNode.tsx       Custom node with inline label editing + system-id badge
  Toolbar.tsx           File menu + edit buttons + import/export
  NotesPanel.tsx        Per-document notes scratchpad
  markdown.ts           Markdown outline -> graph
  layout.ts             Dagre layout, component-aware horizontal packing
  idgen.ts              System node-id generator (n_<base62 seconds>_<counter>)
  graphFile.ts          GraphFile shape, normalize, strip-for-persist helpers
  storage.ts            localStorage recovery + active-document pointer
  sync.ts               Browser side of the dev-server document API + SSE
  types.ts              Shared types
  index.css             All styling
  Inspector.tsx         Side-panel editor for the selected node or edge
  MarkdownView.tsx      Markdown + KaTeX renderer
  registry.ts           Pure registry resolution (per-doc > workspace > built-in)
  lint.ts               Pure lint pass over a GraphFile
  cli/operations.ts     Pure ops over a GraphFile (used by the CLI)
  server/blueprint-sync.ts  Vite dev plugin: workspace HTTP API + SSE + /api/registry
  server/workspace.ts     Resolves the workspace dir and reads blueprint.types.toml
bin/blueprint.ts          CLI entry point (`npm run blueprint -- ...`)
blueprints/               Workspace documents (per-machine, gitignored).
                        Includes blueprint.types.toml — the optional workspace
                        registry override.
.claude/skills/blueprint/ Claude Code skill that wraps the CLI
.codex/skills/blueprint/  Codex skill that wraps the CLI
```
