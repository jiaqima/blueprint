# Repository Guidelines

## Project Structure & Module Organization

This is a Vite + React + TypeScript tool for building blueprints of scientific research projects. A blueprint is a heterogeneous DAG (typed nodes — claims, evidence, definitions, questions, assumptions, risks, syntheses — connected by typed edges) rendered as a mindmap in the browser. Humans use the web canvas; AI agents use the bundled CLI. The tool is part of the Engineering of Science project. Source lives in `src/`:

- `src/main.tsx` mounts the React app.
- `src/App.tsx` coordinates graph state, sync, the Inspector, and the Notes panel.
- `src/MindMap.tsx`, `src/MindMapNode.tsx`, `src/Toolbar.tsx`, `src/Inspector.tsx`, `src/MarkdownView.tsx`, and `src/NotesPanel.tsx` contain the editor UI.
- `src/graphFile.ts`, `src/layout.ts`, `src/markdown.ts`, `src/registry.ts`, `src/storage.ts`, `src/sync.ts`, and `src/types.ts` hold shared logic and types.
- `src/server/blueprint-sync.ts` is the Vite dev-only file sync API.
- `src/server/workspace.ts` resolves the configured workspace directory and workspace registry.
- `src/cli/operations.ts` holds pure operations over a `GraphFile`.
- `bin/blueprint.ts` is the CLI entry point (`npm run blueprint -- <command>`).
- `.claude/skills/blueprint/SKILL.md` is the Claude Code skill that wraps the CLI.
- `.codex/skills/blueprint/SKILL.md` is the repo-local Codex skill that wraps the CLI.
- `blueprints/*.json` are local-only workspace documents (gitignored).

Generated or local-only files are excluded from source control: `dist/`, `node_modules/`, `blueprint.config.json`, `examples/`, and the entire `blueprints/*.json` workspace contents. The workspace registry override at `<workspace>/blueprint.types.toml` is also local; the shared baseline is the built-in default in `src/graphFile.ts:defaultRegistry`.

## Build, Test, and Development Commands

- `npm install` installs dependencies from `package-lock.json`.
- `npm run dev` starts the Vite dev server with the local pair-editing API.
- `npm run build` runs `tsc -b` and writes the production build to `dist/`.
- `npm run lint` runs ESLint across the repository.
- `npm test` runs the vitest unit suite (`src/**/*.test.ts`).
- `npm run preview` serves the production build locally.

There is no separate `typecheck` script; use `npm run build` for type checking.

## Coding Style & Naming Conventions

Use TypeScript and React function components. Keep files focused by concern. Components use `PascalCase` filenames and exports; helpers and utilities use `camelCase`. Prefer shared types from `src/types.ts` when graph shape changes.

Formatting is enforced through ESLint and TypeScript rather than a separate formatter. Match the existing style: two-space indentation, semicolons, double-quoted imports in `src`, and concise comments only for non-obvious behavior.

## Testing Guidelines

Unit tests run with vitest (`npm test`); the pure core — CLI operations, lint, layout, registry resolution, markdown import, id generation, graph-file normalization — is covered. There is no coverage target. Before submitting changes, run:

```bash
npm run lint
npm run build
npm test
```

For UI or graph behavior changes, also run `npm run dev` and manually exercise the affected path: add, delete, rename, connect nodes, edit Inspector type/status/body fields, import Markdown, refresh for persistence, or check live sync state.

For workspace file changes, manually test New, Open, Save, and Save As against `blueprints/*.json`; confirm notes, selection, and viewport are preserved. Also check `npm run preview` when changing file controls, because static builds should keep Import/Export JSON and localStorage recovery while disabling dev-server workspace controls.

For CLI changes (`bin/blueprint.ts`, `src/cli/**`), run `npm run blueprint -- --help` and exercise the affected command end-to-end against a `blueprints/*.json` document. With `npm run dev` running, confirm the browser live-syncs within ~200 ms after a CLI write.

## Commit & Pull Request Guidelines

Recent commits use short, imperative, lower-case subjects, for example `add file-backed pair-editing with a coding agent`. Keep commit subjects specific and focused on one change.

Pull requests should include a concise description, verification commands, and screenshots or short recordings for visible UI changes. Link related issues or explain motivation when changing graph behavior, storage, or sync semantics.

## Agent-Specific Instructions

### The blueprint CLI

When the user wants to inspect or edit a blueprint, use the bundled CLI rather than hand-editing `blueprints/*.json`:

```
npm run blueprint -- list                                  # all documents
npm run blueprint -- show <doc>                            # outline + system ids + [type · status]
npm run blueprint -- find <doc> <substring>                # nodes whose label matches
npm run blueprint -- outline <doc>                         # plain indented outline
npm run blueprint -- config                                # resolved workspace dir + source

# Structure
npm run blueprint -- new <doc>                             # create an empty document (1 root node)
npm run blueprint -- add <doc> --parent <ref> --label <text> [--body <md> | --body-file <p> | --body-stdin]
npm run blueprint -- add-sibling <doc> --of <ref> --label <text>
npm run blueprint -- label <doc> <ref> [--set <text> | --append <text>]
npm run blueprint -- rename <doc> <ref> <new-label>        # alias for label --set
npm run blueprint -- delete <doc> <ref> [--subtree]
npm run blueprint -- move <doc> <ref> --to <new-parent-ref>
npm run blueprint -- link <doc> <src> <tgt>
npm run blueprint -- unlink <doc> <src> <tgt>
npm run blueprint -- synthesize <doc> <claim-ref> <parent-ref>... [--label <text> --body <md>]
npm run blueprint -- import-md <doc> --file <path>
npm run blueprint -- notes <doc> [--set <text> | --append <text>]

# Types, statuses, bodies (see registry resolution below)
npm run blueprint -- settype <doc> <ref> --type <typeId>
npm run blueprint -- setstatus <doc> <ref> --status <statusId>
npm run blueprint -- body <doc> <ref> [--set <text> | --append <text> | --file <path> | --stdin]
npm run blueprint -- setedgetype <doc> <src> <tgt> --type <typeId>
npm run blueprint -- edgebody <doc> <src> <tgt> [--set/--append/--file/--stdin]
npm run blueprint -- paperref <doc> <ref> [--add <loc> [--note <t>] | --remove <n> | --clear]
npm run blueprint -- edgepaperref <doc> <src> <tgt> [--add/--remove/--clear]  # links into the prose paper
npm run blueprint -- registry <doc>                        # effective registry
npm run blueprint -- registry --workspace                  # workspace registry
npm run blueprint -- registry --init [--force]             # write default to <workspace>/blueprint.types.toml
npm run blueprint -- lint <doc>                            # soft warnings on structural issues

npm run blueprint -- --help                                # full surface
```

The type/status/edge-type vocabulary is **extensible** via the registry,
resolved highest-priority first: per-doc `GraphFile.registry` >
`<workspace>/blueprint.types.toml` > built-in default. Run
`npm run blueprint -- registry <doc>` to see what's in effect for a
document.

`<ref>` is a node id or an unambiguous label substring. Always run `show` first to learn the current ids; do not guess. The CLI rewrites the file atomically; if `npm run dev` is running, the browser updates within ~200 ms. For Claude Code, the `/blueprint` skill at `.claude/skills/blueprint/SKILL.md` documents the same workflows in more detail. For Codex, use `$blueprint` from `.codex/skills/blueprint/SKILL.md`.

### Workspace files vs. session state

Treat `blueprints/*.json` as **per-machine, gitignored** workspace contents — user documents and the workspace registry override (`blueprint.types.toml`) live locally. The shared baseline registry is the built-in default in `src/graphFile.ts:defaultRegistry`.

The on-disk workspace dir is configurable: `BLUEPRINT_WORKSPACE` env var > `blueprint.config.json` (gitignored) > `./blueprints/` (default). Treat `blueprints/<name>.json` as a logical identifier in the API and the CLI — don't try to resolve the absolute path yourself. Use the CLI; it picks up the configured workspace automatically. Run `npm run blueprint -- config` to see what's in effect. The user can also change the workspace from the browser via the toolbar's ⚙ Settings button (writes `blueprint.config.json` and re-binds the dev-server watcher at runtime, no restart needed). The CLI / env var stays the canonical way to script changes.

Manual Save (in the browser) and the CLI are the only actions that should write a workspace blueprint file. LocalStorage is a recovery cache. The optional workspace registry at `<workspace>/blueprint.types.toml` controls node types, status ladders, and edge types for documents without a per-document `GraphFile.registry`; edit it deliberately because it changes the vocabulary agents and the browser validate against. When editing the Vite sync API or `src/cli/operations.ts::resolveDocumentPath`, keep path validation strict: no absolute paths, no `..`, `.json` documents only, all wire paths scoped to the `blueprints/` prefix, and the workspace tool file (`blueprint.types.toml`) excluded from the document picker.

Preserve the simple one-file-per-concern architecture, and avoid new dependencies or backend scope unless the trade-off is explicit.
