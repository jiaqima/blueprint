---
name: blueprint
description: |
  Inspect, edit, and reorganize **research blueprints** — heterogeneous
  DAGs of typed nodes and edges that capture the logic chain of a
  scientific project, rendered as mindmaps in the browser editor — via a
  CLI. Each node carries a short label (title), an optional longer
  Markdown+KaTeX body, a system-generated id (`n_xyz_N`, visible in the
  canvas badge and `show` output), an extensible type (claim, evidence,
  definition, question, …) with a status ladder, and may have multiple
  parents. Edges are typed too (expands, supports, contradicts, relates,
  addresses) and can carry bodies. Use this whenever the user wants to:
  build, restructure, or extend a blueprint (add / rename / delete /
  move / link nodes); set a node's type, status, label, or body; set an
  edge's type or body; view the outline, search, or import a Markdown
  outline; or inspect / initialize the workspace registry of types.
  Also use it on prompts like "show the blueprint", "mark Section 3 as
  supported", "add a Motivation node under Introduction", "import this
  outline", or "what types are available". The browser UI lives in this
  same repo; if the user has `npm run dev` running, your edits live-sync
  to their canvas within ~200 ms.
---

# /blueprint

Wrapper around `bin/blueprint.ts` — a Node CLI that performs atomic
operations on workspace blueprint documents. **Prefer it over hand-editing
the JSON files** with Read/Edit/Write: it validates inputs against the
type/status registry, resolves node refs by system id, exact label, or
unambiguous label substring, preserves multi-parent (DAG) semantics, and
keeps the schema correct on every write.

### Node identifiers

Every node has a system-generated id like `n_2g4f6_1` — unique by
construction, immutable. It's visible in `show` output (the trailing
`(n_xxx)`) and as a small monospace badge on the canvas (with the
constant `n_` prefix dropped). Use it as the unambiguous handle for
CLI commands when label substrings are too generic. There is no
separate user-facing id field on nodes.

### Three node content fields, three different jobs

| Field | Job | Where it shows |
|---|---|---|
| **`data.label`** | one-line title | always visible on the canvas |
| **`data.body`** | full Markdown + KaTeX detail | rendered in the Inspector when the node is selected |
| **document-level `notes`** | doc-wide scratchpad | Notes tab in the side panel |

The browser editor lives in the same repo. With `npm run dev` running,
the dev server's file watcher live-syncs your CLI writes to the user's
canvas within ~200 ms.

## When to use

Trigger on prompts like:
- "show me the outline" / "search the blueprint" / "list documents"
- "add / rename / delete / move / link / unlink a node"
- "set Section 1 to a claim / status drafted / body ..."
- "set the edge from X to Y to supports / explain it ..."
- "import this Markdown outline as a blueprint"
- "what's in the registry / what types / statuses are available"
- any explicit `/blueprint` invocation

Do **not** use for editing the app's source code, debugging the React
side, or anything unrelated to the user's blueprint *documents*.

## Invocation

Always run from the repo root:

```bash
npm run blueprint -- <command> [options]
npm run blueprint -- --help     # full command surface
npm run blueprint -- config     # resolved workspace dir + source
```

The workspace dir is resolved at startup: `BLUEPRINT_WORKSPACE` env var >
`blueprint.config.json` at the repo root > `./blueprints/` (default). You
only pass bare doc names; the CLI handles the rest.

## Hard rules

1. **Always start with `list` and `show`** before editing. Do not guess
   node ids or labels. The user's browser may have unsaved changes.
2. **One small operation at a time.** Each command rewrites the document
   atomically and the browser updates after each. Avoid long pipelines
   that hide intermediate state from the user.
3. **No destructive ops without confirmation.** Before `delete`,
   `delete --subtree`, or `import-md` (which replaces the whole graph),
   run `show` to surface what will go away and confirm with the user.
4. **Refs**: `<ref>` resolves in this order — (1) system id (e.g.
   `n_xyz_3`), (2) exact label, (3) case-insensitive label substring.
   If the CLI reports ambiguity, re-run with a more specific ref or
   the exact system id from `show`.
5. **Names**: `<doc>` is a bare name like `paper`. No paths, no `..`,
   no leading `blueprints/`. Names match `[A-Za-z0-9][A-Za-z0-9 _.-]*`.
6. **Don't delete document files** (`blueprints/<name>.json` or whatever
   the configured workspace is) unless the user explicitly asks.

## Workflows

### Inspect

```bash
npm run blueprint -- list                # all documents in the workspace
npm run blueprint -- show paper          # indented outline with ids and [type · status]
npm run blueprint -- show paper --json   # full GraphFile JSON (incl. bodies, registry)
npm run blueprint -- find paper "method" # nodes whose label contains "method"
npm run blueprint -- lint paper          # soft warnings about structural issues
npm run blueprint -- registry paper      # effective taxonomy (per-doc → workspace → built-in)
```

`lint` is non-blocking: it surfaces structural patterns that almost
always indicate a mistake. Current rules (all `warn` severity):

- **Soundness of the support graph**
  - `supports-direction` — `supports` runs claim → evidence (backwards;
    convention is evidence → claim).
  - `support-needs-explanation` — `evidence → claim` `supports` with no
    body. Spell out why on the edge, or route through a synthesis.
  - `supports-source-not-grounded` — `supports` into a matured node
    from a non-grounded source. Promote the source or downgrade the
    target.
  - `matured-without-support` — matured node with zero incoming
    `supports`. Add supports or downgrade.
- **Argument structure**
  - `cycle-in-supports` — `supports` edges form a directed cycle
    (circular reasoning). Issue is on the back-edge.
  - `synthesis-with-single-parent` — synthesis with one supporter;
    synthesis is for *joint* support, replace with a direct edge.
  - `empty-synthesis` — `synthesis · stated` with empty body. Set the
    joint argument with `body --set` or downgrade to draft.
- **Lifecycle consistency**
  - `open-question-on-supported-claim` — `question · open` adjacent to
    a matured node. Answer the question or downgrade the matured node.
- **Vocabulary integrity (against the effective registry)**
  - `untyped-node`, `unknown-typeid`, `unknown-statusid` — node typing
    drifted out of sync with the registry.
  - `unknown-edge-typeid` — same for edges.
  - `empty-label` — node label is empty / whitespace-only.

### Iterate on a single node (most common)

Once the user tells you which node to update, the typical sequence is:

```bash
npm run blueprint -- show paper                                     # locate the node
npm run blueprint -- settype paper "Section 1" --type claim         # if not yet typed
npm run blueprint -- setstatus paper "Section 1" --status stated # advance the status
npm run blueprint -- body paper "Section 1" --set "..."             # write the detailed body
npm run blueprint -- label paper "Section 1" --set "Section 1: Why" # change the title only
npm run blueprint -- show paper                                     # confirm
```

`blueprint show` decorates each node line with `[<id>] label  (system-id)
[type · status]` so the user can see the structure at a glance.

The status ids depend on the type — check `registry <doc>` for the set
that applies. For the workspace's default `claim` type the ladder is
`draft → stated → supported`.

### Build a tree from scratch

```bash
npm run blueprint -- new paper
npm run blueprint -- add paper --parent "My Paper"     --label "Introduction"
npm run blueprint -- add paper --parent "Introduction" --label "Motivation"
npm run blueprint -- add paper --parent "Introduction" --label "Contributions"
npm run blueprint -- add-sibling paper --of "Introduction" --label "Method"
```

Refer to nodes by an unambiguous label substring (as above) or by the
system id from `show` output (e.g. `n_2g4f6_1`). For nodes you'll
cross-reference often, prefer a label that's easy to substring-match
without colliding with other labels.

You can also set the body in the same call:

```bash
npm run blueprint -- add paper --parent "Introduction" --label "Approach" \
  --body "## Sketch\n\nWe ..."
# or --body-file ./snippets/approach.md  /  --body-stdin
```

### Restructure

```bash
npm run blueprint -- label paper "Motivation" --set "Why this paper exists"   # change label
npm run blueprint -- move paper "Contributions" --to "Method"
npm run blueprint -- delete paper "Method"            # node only; children may become orphaned
npm run blueprint -- delete paper "Method" --subtree  # smart prune (keeps shared children with another live parent)
npm run blueprint -- link paper "Why this paper exists" "Contributions"        # cross-link (DAG)
npm run blueprint -- unlink paper "Why this paper exists" "Contributions"
```

`rename <doc> <ref> <new-label>` still works as an alias for
`label <doc> <ref> --set <new-label>`.

### Type and annotate edges

Edges are first-class typed objects too. They identify by `source` +
`target` (one edge per ordered pair).

```bash
npm run blueprint -- setedgetype paper "Section 1" "Section 2" --type supports
npm run blueprint -- edgebody paper "Section 1" "Section 2" --set "X is a special case of Y"
npm run blueprint -- edgebody paper "Section 1" "Section 2"      # print the edge body
```

### Where support arguments live

When a piece of evidence supports a claim (or several pieces support a
claim jointly), there are three places the elaboration can live. Pick in
this order:

1. **Default — edge body.** Per-edge prose. The relational explanation
   lives where the relationship lives.

   ```bash
   npm run blueprint -- edgebody paper E-1 C-X --set "E-1 establishes P, which is the missing premise for Q in C-X"
   ```

   The lint rule `support-needs-explanation` fires on `evidence → claim`
   `supports` edges with no body, nudging you toward this.

2. **Joint support — synthesis node.** When a claim is well-supported
   only when several parents hold *together* and a single edge body
   can't carry the joint argument, insert a `synthesis`-typed
   intermediate. Each parent supports the synthesis; the synthesis
   supports the claim. The joint argument lives in the synthesis node's
   body.

   ```bash
   npm run blueprint -- synthesize paper "Claim X" "Evidence 1" "Evidence 2" "Evidence 3" \
     --label "All three failures" \
     --body "## Joint argument\n\nE-1, E-2, E-3 together rule out ..."
   ```

   Synthesis nodes have a `draft` (created, joint argument not yet
   written) → `stated` (joint argument is in the body) status
   ladder. **Use with caution:** synthesis nodes hide structure;
   in the limit a whole paper collapses into one synthesis hub. Prefer
   per-edge bodies until joint arguments genuinely need a name.

3. **Fallback — claim-body summary.** A `## Support summary` section in
   the parent claim's body, narrating how the evidence collectively
   bears on it. Acceptable when synthesis would be overkill, but prefer
   the synthesis form when you can name the joint argument.

### Labels (short title)

The label is the one-line title shown on the canvas — keep it tight.

```bash
npm run blueprint -- label paper "Section 1"                         # print the label
npm run blueprint -- label paper "Section 1" --set "Why this matters" # replace
npm run blueprint -- label paper "Section 1" --append " (revised)"    # append
npm run blueprint -- rename paper "Section 1" "Why this matters"      # alias for --set
```

### Node and edge bodies (Markdown + KaTeX)

Bodies hold the long-form detail rendered in the Inspector. Use `$...$`
for inline math, `$$...$$` for display math. Headings, lists, code
blocks, and links all render.

```bash
npm run blueprint -- body paper "Section 1" --set "## Why\n\nBecause $E=mc^2$ ..."
npm run blueprint -- body paper "Section 1" --append "...more..."
npm run blueprint -- body paper "Section 1" --file ./fragment.md
echo "..." | npm run blueprint -- body paper "Section 1" --stdin
npm run blueprint -- body paper "Section 1"                     # print the body
```

### Per-document notes (separate from node bodies)

A free-form scratchpad attached to the whole document — useful for
TODOs, drafting notes, or messages between you and the user.

```bash
npm run blueprint -- notes paper                                 # print
npm run blueprint -- notes paper --set "..."                     # replace
npm run blueprint -- notes paper --append "TODO: cite Smith"     # append
```

### Import from Markdown

`#`/`##`/`###` headings and `-`/`*` bullets are both supported and may
be mixed. **This replaces the document's nodes and edges** — confirm
with the user before running it on a non-trivial doc.

```bash
npm run blueprint -- import-md paper --file outline.md
cat outline.md | npm run blueprint -- import-md paper --stdin
```

### Manage the type/status registry

```bash
npm run blueprint -- registry paper                  # effective registry
npm run blueprint -- registry --workspace            # workspace-level registry (or "(none)")
npm run blueprint -- registry --init [--force]       # write the built-in default to <workspace>/blueprint.types.toml
npm run blueprint -- registry --migrate [--force] [--delete-legacy]
                                                   # convert legacy blueprint.types.toml to TOML
```

Resolution: per-doc `GraphFile.registry` (full override) → workspace
`blueprint.types.toml` (legacy `.json` still readable) → built-in
default. To customize, edit the TOML directly. Built-in default ships
7 node types (`claim`, `evidence`, `definition`, `question`,
`assumption`, `risk`, `synthesis`) and 5 edge types (`expands`,
`supports`, `contradicts`, `relates`, `addresses`).

#### Status ladders at a glance

Each node type has a domain-shaped status ladder. Three "non-empirical
lifecycle" types share the same first two stages (`draft → stated`);
the others use names that fit their lifecycle.

| node type | ladder | default |
|---|---|---|
| `claim` | draft → stated → supported | draft |
| `definition` | draft → stated | draft |
| `synthesis` | draft → stated | draft |
| `evidence` | missing → cited → verified | missing |
| `question` | open → answered | open |
| `assumption` | given → questioned | given |
| `risk` | noted → addressed → accepted | noted |

Read each ladder column-wise: the *first* stage is "exists but not yet
substantive" in domain terms (a draft of a claim, a placeholder for
evidence, an unanswered question, an unchallenged assumption, a
just-noted risk); subsequent stages encode what "matured" means for
that type.

## Schema reference

```jsonc
{
  "nodes": [
    {
      "id": "n_xyz_1",                 // system id, runtime-generated, immutable
      "type": "mind",
      "position": { "x": 0, "y": 0 },
      "data": {
        "label": "Section 1",          // short title (always visible on the canvas)
        "body": "## Why\n\n...",      // Markdown + KaTeX (rendered in the Inspector)
        "typeId": "claim",             // → registry.nodeTypes
        "statusId": "stated"       // → that type's status set
      }
    }
  ],
  "edges": [
    {
      "id": "e_a_b",
      "source": "n_xyz_1",
      "target": "n_xyz_2",
      "data": { "typeId": "supports", "body": "..." }
    }
  ],
  "notes": "...",
  "ui": {
    "selection": { "nodeIds": [], "edgeIds": [] },
    "viewport":  { "x": 0, "y": 0, "zoom": 1 },
    "collapsed": []                   // node ids whose children are visually hidden
  },
  "registry": null                    // optional per-doc override
}
```

Bodies, types, statuses, edge types, and edge bodies all round-trip
through the JSON. The `ui` block is per-user view state (selection /
viewport / collapsed) and is also persisted with the document.

## Caveats

- **Last-writer-wins.** If the user is actively editing in the browser,
  prefer small focused edits and confirm intent. The browser auto-saves
  recovery to `localStorage` but does **not** push to the workspace file
  until the user clicks Save. Your CLI writes go to the workspace file
  directly.
- **No undo.** Deleted nodes / edges / bodies are gone. Snapshot first
  with `blueprint show <doc> --json > /tmp/snapshot.json` if you're about
  to do something risky.
- **Layout positions.** New nodes get `position: { x: 0, y: 0 }`; the
  browser's dagre layout assigns real coordinates on next load.
  Existing positions are preserved.
- **Cycles.** `link` allows multi-parent edges (DAGs), but cycles render
  noisily and break collapse/visibility heuristics. Don't create one
  unless the user explicitly asks.
- **Status validation.** `setstatus` requires the node to have a type
  whose status set includes the requested status. `settype` auto-falls-
  back to a valid status (the new type's `defaultStatus`) if the
  current status isn't in the new type's set.
- **Workspace location.** The on-disk workspace dir is configurable
  (`BLUEPRINT_WORKSPACE` env var → `blueprint.config.json` → `./blueprints/`).
  Workspace contents (`blueprints/*.json` plus the registry override
  `blueprint.types.toml`) are **per-machine and gitignored** — the
  shared baseline registry is the built-in default in
  `src/graphFile.ts:defaultRegistry`.
- **Markdown body** rendering happens in the browser. The CLI just
  stores the raw source — it doesn't validate that your Markdown or
  KaTeX is well-formed. Bad input renders as a KaTeX error in the
  Inspector preview.
