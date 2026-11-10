#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CliError,
  DOCUMENTS_DIR,
  addChild,
  addEdgePaperRef,
  addPaperRef,
  addSibling,
  clearEdgePaperRefs,
  clearPaperRefs,
  defaultRegistry,
  deleteNode,
  effectiveRegistry,
  find,
  findEdge,
  findNode,
  importMarkdown,
  link,
  move,
  normalizeGraphFile,
  outline,
  removeEdgePaperRef,
  removePaperRef,
  rename,
  resolveDocumentPath,
  seedGraphFile,
  setEdgeBody,
  setEdgeType,
  setNodeBody,
  setNodeLabel,
  setNodeStatus,
  setNodeType,
  setNotes,
  stripFileForPersist,
  synthesize,
  unlink,
} from "../src/cli/operations.js";
import { lint } from "../src/lint.js";
import {
  REGISTRY_FILENAME,
  describeWorkspaceSource,
  documentFsPath,
  getWorkspaceDir,
  getWorkspaceRegistry,
  isWorkspaceToolFile,
  workspaceRegistryPath,
} from "../src/server/workspace.js";
import type { GraphFile, PaperRef, Registry } from "../src/types.js";

const REPO_ROOT = process.cwd();
const WORKSPACE_DIR = getWorkspaceDir(REPO_ROOT);

function fsPath(wirePath: string): string {
  return documentFsPath(WORKSPACE_DIR, wirePath);
}

type Flags = Record<string, string | true>;
type Parsed = { positional: string[]; flags: Flags };

function parseArgs(argv: string[]): Parsed {
  const positional: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (a === "-h") {
      flags.help = true;
      continue;
    }
    if (a.startsWith("--")) {
      const body = a.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--") && next !== "-h") {
          flags[body] = next;
          i++;
        } else {
          flags[body] = true;
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function flagString(flags: Flags, name: string): string | undefined {
  const v = flags[name];
  return typeof v === "string" ? v : undefined;
}

function requireString(flags: Flags, name: string): string {
  const v = flagString(flags, name);
  if (v === undefined || v === "") {
    throw new CliError(`missing --${name}`);
  }
  return v;
}

async function readDocument(wirePath: string): Promise<GraphFile> {
  const filePath = fsPath(wirePath);
  if (!existsSync(filePath)) {
    throw new CliError(`document not found: ${filePath}`);
  }
  const text = await readFile(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new CliError(`invalid JSON in ${filePath}: ${(e as Error).message}`);
  }
  const file = normalizeGraphFile(parsed);
  if (!file) {
    throw new CliError(`invalid graph file at ${filePath}`);
  }
  return file;
}

async function writeDocument(wirePath: string, file: GraphFile): Promise<void> {
  const filePath = fsPath(wirePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  const clean = stripFileForPersist(file);
  await writeFile(filePath, JSON.stringify(clean, null, 2), "utf8");
}

function shortId(id: string, label: string): string {
  return `${id}  "${label}"`;
}

type PaperRefChange =
  | { kind: "add"; loc: string; note?: string }
  | { kind: "remove"; index: number }
  | { kind: "clear" };

// Shared flag parsing for `paperref` / `edgepaperref`. Returns null in
// read (print) mode.
function paperRefMode(flags: Flags): PaperRefChange | null {
  const addLoc = flagString(flags, "add");
  const removeIndex = flagString(flags, "remove");
  const clear = flags.clear === true;
  const picked = [addLoc, removeIndex, clear ? "" : undefined].filter(
    (v) => v !== undefined,
  );
  if (picked.length > 1) {
    throw new CliError("use only one of --add / --remove / --clear");
  }
  const note = flagString(flags, "note");
  if (note !== undefined && addLoc === undefined) {
    throw new CliError("--note requires --add");
  }
  if (addLoc !== undefined) return { kind: "add", loc: addLoc, note };
  if (removeIndex !== undefined) {
    const index = Number(removeIndex);
    if (!Number.isInteger(index)) {
      throw new CliError(
        `--remove expects an index number, got "${removeIndex}"`,
      );
    }
    return { kind: "remove", index };
  }
  if (clear) return { kind: "clear" };
  return null;
}

function printPaperRefs(refs: PaperRef[] | undefined): void {
  if (!refs || refs.length === 0) {
    console.log("(no paper refs)");
    return;
  }
  refs.forEach((r, i) => {
    console.log(`${i + 1}. ${r.loc}${r.note ? ` — ${r.note}` : ""}`);
  });
}

function describePaperRefChange(mode: PaperRefChange, what: string): string {
  if (mode.kind === "add") return `added paper ref to ${what}: ${mode.loc}`;
  if (mode.kind === "remove") return `removed paper ref ${mode.index} from ${what}`;
  return `cleared paper refs on ${what}`;
}

const TOP_HELP = `blueprint — manipulate workspace blueprint documents (rendered as mindmaps in the browser)

Usage:
  npm run blueprint -- <command> [options]

Documents:
  list                                       List all documents in the workspace
  show <doc> [--json]                        Print outline of <doc>
  find <doc> <query>                         Find nodes whose label matches <query>
  lint <doc>                                 Print soft warnings about structural issues
  config                                     Print the resolved workspace dir

Concepts:
  label  short title shown on the canvas (one line, tens of chars)
  body   full Markdown + KaTeX content rendered in the Inspector pane

Editing:
  new <doc>                                  Create an empty document (1 root node)
  add <doc> --parent <ref> --label <text>
            [--body <text> | --body-file <path> | --body-stdin]
                                             Add a child of <ref>. --body* sets the body in
                                             the same call.
  add-sibling <doc> --of <ref> --label <text>
              [--body <text> | --body-file <path> | --body-stdin]
                                             Add a sibling of <ref>
  delete <doc> <ref> [--subtree]             Delete a node (or its subtree)
  move <doc> <ref> --to <new-parent-ref>     Reparent a node
  link <doc> <source-ref> <target-ref>       Add an edge
  unlink <doc> <source-ref> <target-ref>     Remove an edge
  synthesize <doc> <parent-claim> <ev1> [<ev2> ...]
             --label <title> [--type <typeId>]
             [--body <text> | --body-file <path> | --body-stdin] [--keep]
                                             Insert a synthesis node bundling several parents
                                             under one supports edge to <parent-claim>. By
                                             default, the original parent_i → parent-claim
                                             supports edges (and their bodies) are rewired
                                             through the synthesis; --keep preserves them.

Labels (short title):
  label <doc> <ref>                          Print label
  label <doc> <ref> --set <text>             Replace label
  label <doc> <ref> --append <text>          Append to label
  rename <doc> <ref> <new-label>             Alias for "label --set"

Types & status:
  settype <doc> <ref> --type <typeId>        Set node type
  setstatus <doc> <ref> --status <statusId>  Set node status (within current type)
  setedgetype <doc> <src> <tgt> --type <id>  Set edge type
  registry <doc>                             Print the effective registry for <doc>
  registry --workspace                       Print the workspace registry
  registry --init [--force]                  Write the built-in default to <workspace>/blueprint.types.toml

Bodies (Markdown + KaTeX, rendered in the Inspector):
  body <doc> <ref>                           Print node body
  body <doc> <ref> --set <text>              Replace node body
  body <doc> <ref> --append <text>           Append to node body
  body <doc> <ref> --file <path>             Replace node body from a file
  body <doc> <ref> --stdin                   Replace node body from stdin
  edgebody <doc> <src> <tgt>                 Print edge body  (also --set / --append / --file / --stdin)

Paper references (optional links from an element to the prose paper):
  paperref <doc> <ref>                       Print paper refs
  paperref <doc> <ref> --add <loc> [--note <text>]
                                             Add one, e.g. --add "§4.2 ¶3" --note "data model"
  paperref <doc> <ref> --remove <n>          Remove by index (as printed)
  paperref <doc> <ref> --clear               Remove all
  edgepaperref <doc> <src> <tgt> [...]       Same for an edge
  Keep paper locators here, not in bodies — bodies carry the argument.
  A blueprint made before the paper exists has none; that's normal.

Notes:
  notes <doc>                                Print the notes
  notes <doc> --set <text>                   Replace notes
  notes <doc> --append <text>                Append to notes

Bulk:
  import-md <doc> [--file <path> | --stdin]  Replace graph from a Markdown outline

Common:
  -h, --help                                 Print this help

Conventions:
  <doc> is a document name (e.g. "paper") — resolved to <workspace>/<name>.json.
  <ref> resolves in this order: (1) system node id (e.g. n_xyz_3),
        (2) exact label, (3) unambiguous case-insensitive label substring.
        Use the system id from 'show' output when label substrings collide.
  Commands operate on the file directly. If "npm run dev" is running, the
  browser will live-update within ~200 ms after any write.

Workspace location (highest priority first):
  1. BLUEPRINT_WORKSPACE env var
  2. blueprint.config.json in the repo root (field "workspace")
  3. ./${DOCUMENTS_DIR}/ in the repo root (default)

Run "blueprint config" to see which one is in effect.
`;

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const REGISTRY_INIT_HEADER = `Workspace registry override.

Edit freely — node types, status ladders, and edge types defined here
apply to every blueprint in this workspace, unless a per-document
GraphFile.registry overrides them.`;

// Serialize a Registry as TOML. The status array stays as inline tables
// (compact, aligned per row) instead of unfolding to [[array-of-tables]].
// `smol-toml`'s stringify always unfolds, so we render by hand.
function registryToToml(registry: Registry, header?: string): string {
  const out: string[] = [];
  if (header) {
    for (const line of header.split("\n")) {
      out.push(line ? `# ${line}` : "#");
    }
    out.push("");
  }
  for (const [id, type] of Object.entries(registry.nodeTypes)) {
    out.push(`[nodeTypes.${tomlKey(id)}]`);
    out.push(`label = ${tomlString(type.label)}`);
    if (type.color !== undefined) out.push(`color = ${tomlString(type.color)}`);
    if (type.icon !== undefined) out.push(`icon = ${tomlString(type.icon)}`);
    if (type.defaultStatus !== undefined) {
      out.push(`defaultStatus = ${tomlString(type.defaultStatus)}`);
    }
    if (type.statuses && type.statuses.length > 0) {
      out.push("statuses = [");
      for (const s of type.statuses) {
        const parts = [
          `id = ${tomlString(s.id)}`,
          `label = ${tomlString(s.label)}`,
        ];
        if (s.color !== undefined) parts.push(`color = ${tomlString(s.color)}`);
        out.push(`  { ${parts.join(", ")} },`);
      }
      out.push("]");
    }
    out.push("");
  }
  for (const [id, edge] of Object.entries(registry.edgeTypes)) {
    out.push(`[edgeTypes.${tomlKey(id)}]`);
    out.push(`label = ${tomlString(edge.label)}`);
    if (edge.color !== undefined) out.push(`color = ${tomlString(edge.color)}`);
    if (edge.lineStyle !== undefined) {
      out.push(`lineStyle = ${tomlString(edge.lineStyle)}`);
    }
    out.push("");
  }
  return out.join("\n").replace(/\n+$/, "") + "\n";
}

function tomlKey(s: string): string {
  return /^[A-Za-z0-9_-]+$/.test(s) ? s : tomlString(s);
}

function tomlString(s: string): string {
  // TOML basic strings accept the same escapes as JSON basic strings
  // (\b \t \n \f \r \" \\ \uXXXX). JSON.stringify is a strict subset.
  return JSON.stringify(s);
}

// Resolve a body source from a triple of mutually-exclusive flags.
// Returns undefined when none are set; throws on conflict.
async function resolveBodySource(flags: Flags): Promise<string | undefined> {
  const inline = flagString(flags, "body");
  const fromFile = flagString(flags, "body-file");
  const fromStdin = flags["body-stdin"] === true;
  const sources = [inline, fromFile, fromStdin ? "" : undefined].filter(
    (v) => v !== undefined,
  );
  if (sources.length > 1) {
    throw new CliError(
      "use only one of --body / --body-file / --body-stdin",
    );
  }
  if (inline !== undefined) return inline;
  if (fromFile !== undefined) return readFile(fromFile, "utf8");
  if (fromStdin) return readStdin();
  return undefined;
}

type CommandHandler = (parsed: Parsed) => Promise<number>;

const commands: Record<string, CommandHandler> = {
  list: async () => {
    if (!existsSync(WORKSPACE_DIR)) {
      console.log("(no documents yet)");
      return 0;
    }
    const entries = await readdir(WORKSPACE_DIR, { withFileTypes: true });
    const docs = entries
      .filter(
        (e) =>
          e.isFile() && e.name.endsWith(".json") && !isWorkspaceToolFile(e.name),
      )
      .map((e) => e.name.replace(/\.json$/, ""))
      .sort();
    if (docs.length === 0) {
      console.log("(no documents yet)");
      return 0;
    }
    for (const d of docs) console.log(d);
    return 0;
  },

  config: async () => {
    const ws = describeWorkspaceSource(REPO_ROOT);
    console.log(`workspace: ${ws.dir}  (from ${ws.source})`);
    return 0;
  },

  show: async ({ positional, flags }) => {
    const [doc] = positional;
    if (!doc) throw new CliError("show requires a document name");
    const documentPath = resolveDocumentPath(doc);
    const file = await readDocument(documentPath);
    if (flags.json) {
      console.log(JSON.stringify(stripFileForPersist(file), null, 2));
    } else {
      console.log(`# ${doc}  (${file.nodes.length} nodes, ${file.edges.length} edges)`);
      const registry = effectiveRegistry(file, getWorkspaceRegistry(WORKSPACE_DIR));
      console.log(outline(file, registry));
      if (file.notes.trim().length > 0) {
        console.log("\n## notes");
        console.log(file.notes);
      }
    }
    return 0;
  },

  find: async ({ positional }) => {
    const [doc, ...rest] = positional;
    const query = rest.join(" ");
    if (!doc || !query) throw new CliError("find requires <doc> <query>");
    const documentPath = resolveDocumentPath(doc);
    const file = await readDocument(documentPath);
    const matches = find(file, query);
    if (matches.length === 0) {
      console.log(`(no matches for "${query}")`);
      return 0;
    }
    for (const m of matches) console.log(shortId(m.id, m.label));
    return 0;
  },

  lint: async ({ positional }) => {
    const [doc] = positional;
    if (!doc) throw new CliError("lint requires a document name");
    const documentPath = resolveDocumentPath(doc);
    const file = await readDocument(documentPath);
    const registry = effectiveRegistry(
      file,
      getWorkspaceRegistry(WORKSPACE_DIR),
    );
    const issues = lint(file, registry);
    if (issues.length === 0) {
      console.log("(no lint issues)");
      return 0;
    }
    const nodeById = new Map(file.nodes.map((n) => [n.id, n]));
    const edgeById = new Map(file.edges.map((e) => [e.id, e]));
    for (const issue of issues) {
      console.log(`[${issue.severity}] ${issue.ruleId}`);
      if (issue.target.kind === "node") {
        const n = nodeById.get(issue.target.id);
        console.log(`  node ${issue.target.id}: "${n?.data.label ?? "?"}"`);
      } else {
        const e = edgeById.get(issue.target.id);
        const s = e ? nodeById.get(e.source) : undefined;
        const t = e ? nodeById.get(e.target) : undefined;
        console.log(
          `  edge ${issue.target.id}: "${s?.data.label ?? "?"}" → "${t?.data.label ?? "?"}"`,
        );
      }
      console.log(`  ${issue.message}`);
    }
    return issues.some((i) => i.severity === "error") ? 1 : 0;
  },

  new: async ({ positional }) => {
    const [doc] = positional;
    if (!doc) throw new CliError("new requires a document name");
    const documentPath = resolveDocumentPath(doc);
    const filePath = fsPath(documentPath);
    if (existsSync(filePath)) {
      throw new CliError(`document already exists: ${filePath}`);
    }
    await writeDocument(documentPath, seedGraphFile());
    console.log(`created ${filePath}`);
    return 0;
  },

  add: async ({ positional, flags }) => {
    const [doc] = positional;
    if (!doc) throw new CliError("add requires a document name");
    const parent = requireString(flags, "parent");
    const label = requireString(flags, "label");
    const body = await resolveBodySource(flags);
    const documentPath = resolveDocumentPath(doc);
    const file = await readDocument(documentPath);
    const opts: { body?: string } = {};
    if (body !== undefined) opts.body = body;
    const { file: next, node } = addChild(file, parent, label, opts);
    await writeDocument(documentPath, next);
    console.log(`added ${shortId(node.id, node.data.label)} as child of "${parent}"`);
    return 0;
  },

  "add-sibling": async ({ positional, flags }) => {
    const [doc] = positional;
    if (!doc) throw new CliError("add-sibling requires a document name");
    const of = requireString(flags, "of");
    const label = requireString(flags, "label");
    const body = await resolveBodySource(flags);
    const documentPath = resolveDocumentPath(doc);
    const file = await readDocument(documentPath);
    const opts: { body?: string } = {};
    if (body !== undefined) opts.body = body;
    const { file: next, node } = addSibling(file, of, label, opts);
    await writeDocument(documentPath, next);
    console.log(`added ${shortId(node.id, node.data.label)} as sibling of "${of}"`);
    return 0;
  },

  rename: async ({ positional }) => {
    const [doc, ref, ...rest] = positional;
    const newLabel = rest.join(" ");
    if (!doc || !ref || !newLabel) {
      throw new CliError("rename requires <doc> <ref> <new-label>");
    }
    const documentPath = resolveDocumentPath(doc);
    const file = await readDocument(documentPath);
    const next = rename(file, ref, newLabel);
    await writeDocument(documentPath, next);
    console.log(`renamed "${ref}" to "${newLabel}"`);
    return 0;
  },

  label: async ({ positional, flags }) => {
    const [doc, ref] = positional;
    if (!doc || !ref) throw new CliError("label requires <doc> <ref>");
    const documentPath = resolveDocumentPath(doc);
    const file = await readDocument(documentPath);

    const setText = flagString(flags, "set");
    const appendText = flagString(flags, "append");
    if (setText !== undefined && appendText !== undefined) {
      throw new CliError("use only one of --set / --append");
    }

    if (setText === undefined && appendText === undefined) {
      // Read mode: print the label.
      const node = findNode(file, ref);
      console.log(node.data.label);
      return 0;
    }

    const text = setText !== undefined ? setText : (appendText as string);
    const next = setNodeLabel(file, ref, text, {
      append: appendText !== undefined,
    });
    await writeDocument(documentPath, next);
    console.log(appendText !== undefined ? "label appended" : "label set");
    return 0;
  },

  delete: async ({ positional, flags }) => {
    const [doc, ref] = positional;
    if (!doc || !ref) throw new CliError("delete requires <doc> <ref>");
    const documentPath = resolveDocumentPath(doc);
    const file = await readDocument(documentPath);
    const subtree = flags.subtree === true;
    const { file: next, removed } = deleteNode(file, ref, { subtree });
    await writeDocument(documentPath, next);
    console.log(`deleted ${removed.length} node${removed.length === 1 ? "" : "s"}: ${removed.join(", ")}`);
    return 0;
  },

  move: async ({ positional, flags }) => {
    const [doc, ref] = positional;
    if (!doc || !ref) throw new CliError("move requires <doc> <ref> --to <new-parent>");
    const to = requireString(flags, "to");
    const documentPath = resolveDocumentPath(doc);
    const file = await readDocument(documentPath);
    const next = move(file, ref, to);
    await writeDocument(documentPath, next);
    console.log(`moved "${ref}" under "${to}"`);
    return 0;
  },

  link: async ({ positional }) => {
    const [doc, source, target] = positional;
    if (!doc || !source || !target) {
      throw new CliError("link requires <doc> <source-ref> <target-ref>");
    }
    const documentPath = resolveDocumentPath(doc);
    const file = await readDocument(documentPath);
    const next = link(file, source, target);
    await writeDocument(documentPath, next);
    console.log(`linked "${source}" -> "${target}"`);
    return 0;
  },

  unlink: async ({ positional }) => {
    const [doc, source, target] = positional;
    if (!doc || !source || !target) {
      throw new CliError("unlink requires <doc> <source-ref> <target-ref>");
    }
    const documentPath = resolveDocumentPath(doc);
    const file = await readDocument(documentPath);
    const next = unlink(file, source, target);
    await writeDocument(documentPath, next);
    console.log(`unlinked "${source}" -> "${target}"`);
    return 0;
  },

  synthesize: async ({ positional, flags }) => {
    const [doc, target, ...parentRefs] = positional;
    if (!doc || !target || parentRefs.length === 0) {
      throw new CliError(
        "synthesize requires <doc> <parent-claim> <ev1> [<ev2> ...] --label <title>",
      );
    }
    const label = requireString(flags, "label");
    const typeId = flagString(flags, "type");
    const body = await resolveBodySource(flags);
    const keep = flags.keep === true;
    const documentPath = resolveDocumentPath(doc);
    const file = await readDocument(documentPath);
    const registry = effectiveRegistry(
      file,
      getWorkspaceRegistry(WORKSPACE_DIR),
    );
    const opts: Parameters<typeof synthesize>[3] = { label, registry, keep };
    if (typeId) opts.typeId = typeId;
    if (body !== undefined) opts.body = body;
    const { file: next, node } = synthesize(file, target, parentRefs, opts);
    await writeDocument(documentPath, next);
    console.log(
      `synthesized ${shortId(node.id, node.data.label)} from ${
        parentRefs.length
      } parent${parentRefs.length === 1 ? "" : "s"} into "${target}"`,
    );
    return 0;
  },

  settype: async ({ positional, flags }) => {
    const [doc, ref] = positional;
    if (!doc || !ref) {
      throw new CliError("settype requires <doc> <ref> --type <typeId>");
    }
    const typeId = requireString(flags, "type");
    const documentPath = resolveDocumentPath(doc);
    const file = await readDocument(documentPath);
    const registry = effectiveRegistry(file, getWorkspaceRegistry(WORKSPACE_DIR));
    const next = setNodeType(file, ref, typeId, registry);
    await writeDocument(documentPath, next);
    console.log(`set type of "${ref}" to "${typeId}"`);
    return 0;
  },

  setstatus: async ({ positional, flags }) => {
    const [doc, ref] = positional;
    if (!doc || !ref) {
      throw new CliError("setstatus requires <doc> <ref> --status <statusId>");
    }
    const statusId = requireString(flags, "status");
    const documentPath = resolveDocumentPath(doc);
    const file = await readDocument(documentPath);
    const registry = effectiveRegistry(file, getWorkspaceRegistry(WORKSPACE_DIR));
    const next = setNodeStatus(file, ref, statusId, registry);
    await writeDocument(documentPath, next);
    console.log(`set status of "${ref}" to "${statusId}"`);
    return 0;
  },

  body: async ({ positional, flags }) => {
    const [doc, ref] = positional;
    if (!doc || !ref) throw new CliError("body requires <doc> <ref>");
    const documentPath = resolveDocumentPath(doc);
    const file = await readDocument(documentPath);

    const setText = flagString(flags, "set");
    const appendText = flagString(flags, "append");
    const filePath = flagString(flags, "file");
    const useStdin = flags.stdin === true;
    const sources = [setText, appendText, filePath, useStdin ? "" : undefined].filter(
      (v) => v !== undefined,
    );
    if (sources.length > 1) {
      throw new CliError("use only one of --set / --append / --file / --stdin");
    }

    const text =
      setText !== undefined
        ? setText
        : appendText !== undefined
          ? appendText
          : filePath !== undefined
            ? await readFile(filePath, "utf8")
            : useStdin
              ? await readStdin()
              : undefined;

    if (text === undefined) {
      // Read mode: print body
      const node = findNode(file, ref);
      const body = node.data.body ?? "";
      if (body.length === 0) console.log("(no body)");
      else console.log(body);
      return 0;
    }

    const next = setNodeBody(file, ref, text, { append: appendText !== undefined });
    await writeDocument(documentPath, next);
    console.log(appendText !== undefined ? "body appended" : "body set");
    return 0;
  },

  setedgetype: async ({ positional, flags }) => {
    const [doc, source, target] = positional;
    if (!doc || !source || !target) {
      throw new CliError(
        "setedgetype requires <doc> <source-ref> <target-ref> --type <typeId>",
      );
    }
    const typeId = requireString(flags, "type");
    const documentPath = resolveDocumentPath(doc);
    const file = await readDocument(documentPath);
    const registry = effectiveRegistry(file, getWorkspaceRegistry(WORKSPACE_DIR));
    const next = setEdgeType(file, source, target, typeId, registry);
    await writeDocument(documentPath, next);
    console.log(`set type of edge "${source}" -> "${target}" to "${typeId}"`);
    return 0;
  },

  edgebody: async ({ positional, flags }) => {
    const [doc, source, target] = positional;
    if (!doc || !source || !target) {
      throw new CliError("edgebody requires <doc> <source-ref> <target-ref>");
    }
    const documentPath = resolveDocumentPath(doc);
    const file = await readDocument(documentPath);

    const setText = flagString(flags, "set");
    const appendText = flagString(flags, "append");
    const filePath = flagString(flags, "file");
    const useStdin = flags.stdin === true;
    const sources = [setText, appendText, filePath, useStdin ? "" : undefined].filter(
      (v) => v !== undefined,
    );
    if (sources.length > 1) {
      throw new CliError("use only one of --set / --append / --file / --stdin");
    }

    const text =
      setText !== undefined
        ? setText
        : appendText !== undefined
          ? appendText
          : filePath !== undefined
            ? await readFile(filePath, "utf8")
            : useStdin
              ? await readStdin()
              : undefined;

    if (text === undefined) {
      const edge = findEdge(file, source, target);
      const body = edge.data?.body ?? "";
      if (body.length === 0) console.log("(no body)");
      else console.log(body);
      return 0;
    }

    const next = setEdgeBody(file, source, target, text, {
      append: appendText !== undefined,
    });
    await writeDocument(documentPath, next);
    console.log(appendText !== undefined ? "edge body appended" : "edge body set");
    return 0;
  },

  paperref: async ({ positional, flags }) => {
    const [doc, ref] = positional;
    if (!doc || !ref) throw new CliError("paperref requires <doc> <ref>");
    const documentPath = resolveDocumentPath(doc);
    const file = await readDocument(documentPath);

    const mode = paperRefMode(flags);
    if (mode === null) {
      printPaperRefs(findNode(file, ref).data.paperRefs);
      return 0;
    }

    const next =
      mode.kind === "add"
        ? addPaperRef(file, ref, mode.loc, mode.note)
        : mode.kind === "remove"
          ? removePaperRef(file, ref, mode.index)
          : clearPaperRefs(file, ref);
    await writeDocument(documentPath, next);
    console.log(describePaperRefChange(mode, `"${ref}"`));
    return 0;
  },

  edgepaperref: async ({ positional, flags }) => {
    const [doc, source, target] = positional;
    if (!doc || !source || !target) {
      throw new CliError("edgepaperref requires <doc> <source-ref> <target-ref>");
    }
    const documentPath = resolveDocumentPath(doc);
    const file = await readDocument(documentPath);

    const mode = paperRefMode(flags);
    if (mode === null) {
      printPaperRefs(findEdge(file, source, target).data?.paperRefs);
      return 0;
    }

    const next =
      mode.kind === "add"
        ? addEdgePaperRef(file, source, target, mode.loc, mode.note)
        : mode.kind === "remove"
          ? removeEdgePaperRef(file, source, target, mode.index)
          : clearEdgePaperRefs(file, source, target);
    await writeDocument(documentPath, next);
    console.log(describePaperRefChange(mode, `edge "${source}" -> "${target}"`));
    return 0;
  },

  registry: async ({ positional, flags }) => {
    const force = flags.force === true;
    const tomlPath = workspaceRegistryPath(WORKSPACE_DIR);

    if (flags.init === true) {
      if (existsSync(tomlPath) && !force) {
        throw new CliError(
          `${tomlPath} already exists. Pass --force to overwrite.`,
        );
      }
      await mkdir(path.dirname(tomlPath), { recursive: true });
      await writeFile(
        tomlPath,
        registryToToml(defaultRegistry(), REGISTRY_INIT_HEADER),
        "utf8",
      );
      console.log(`wrote ${tomlPath}`);
      return 0;
    }

    if (flags.workspace === true) {
      const ws = getWorkspaceRegistry(WORKSPACE_DIR);
      if (!ws) {
        console.log(
          `(no ${REGISTRY_FILENAME} in ${WORKSPACE_DIR} — using built-in default)`,
        );
      } else {
        process.stdout.write(registryToToml(ws));
      }
      return 0;
    }
    const [doc] = positional;
    if (!doc) {
      throw new CliError(
        "registry requires <doc>, or use --workspace / --init",
      );
    }
    const documentPath = resolveDocumentPath(doc);
    const file = await readDocument(documentPath);
    const registry = effectiveRegistry(
      file,
      getWorkspaceRegistry(WORKSPACE_DIR),
    );
    process.stdout.write(registryToToml(registry));
    return 0;
  },

  notes: async ({ positional, flags }) => {
    const [doc] = positional;
    if (!doc) throw new CliError("notes requires a document name");
    const documentPath = resolveDocumentPath(doc);
    const file = await readDocument(documentPath);

    const setText = flagString(flags, "set");
    const appendText = flagString(flags, "append");
    if (setText !== undefined && appendText !== undefined) {
      throw new CliError("use either --set or --append, not both");
    }
    if (setText !== undefined) {
      await writeDocument(documentPath, setNotes(file, setText));
      console.log("notes set");
      return 0;
    }
    if (appendText !== undefined) {
      await writeDocument(documentPath, setNotes(file, appendText, { append: true }));
      console.log("notes appended");
      return 0;
    }
    if (file.notes.length === 0) {
      console.log("(no notes)");
    } else {
      console.log(file.notes);
    }
    return 0;
  },

  "import-md": async ({ positional, flags }) => {
    const [doc] = positional;
    if (!doc) throw new CliError("import-md requires a document name");
    const documentPath = resolveDocumentPath(doc);
    const file = existsSync(fsPath(documentPath))
      ? await readDocument(documentPath)
      : seedGraphFile();

    let markdown = "";
    if (flags.stdin === true) {
      markdown = await readStdin();
    } else {
      const sourcePath = flagString(flags, "file");
      if (!sourcePath) throw new CliError("import-md needs --file <path> or --stdin");
      markdown = await readFile(sourcePath, "utf8");
    }
    const next = importMarkdown(file, markdown);
    await writeDocument(documentPath, next);
    console.log(`imported ${next.nodes.length} nodes from markdown into ${fsPath(documentPath)}`);
    return 0;
  },
};

async function main(argv: string[]): Promise<number> {
  if (argv.length === 0) {
    console.log(TOP_HELP);
    return 0;
  }
  const first = argv[0];
  if (first === "-h" || first === "--help" || first === "help") {
    console.log(TOP_HELP);
    return 0;
  }
  const handler = commands[first];
  if (!handler) {
    console.error(`unknown command: ${first}\n`);
    console.log(TOP_HELP);
    return 1;
  }
  const parsed = parseArgs(argv.slice(1));
  if (parsed.flags.help === true) {
    console.log(TOP_HELP);
    return 0;
  }
  try {
    return await handler(parsed);
  } catch (err) {
    if (err instanceof CliError) {
      console.error(`error: ${err.message}`);
      return 1;
    }
    console.error("internal error:", err);
    return 2;
  }
}

const isMain =
  typeof process !== "undefined" &&
  process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error("internal error:", err);
      process.exit(2);
    },
  );
}
