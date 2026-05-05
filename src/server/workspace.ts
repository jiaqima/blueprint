import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { normalizeRegistry } from "../graphFile";
import type { Registry } from "../types";

const CONFIG_FILE = "blueprint.config.json";
const FALLBACK_DIR = "blueprints";
const ENV_VAR = "BLUEPRINT_WORKSPACE";
const REGISTRY_FILE = "blueprint.types.toml";

export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

// Read the workspace path from env, falling back to a per-machine config
// file at the repo root, falling back to <repoRoot>/blueprints.
export function getWorkspaceDir(repoRoot: string): string {
  const env = process.env[ENV_VAR]?.trim();
  if (env) return path.resolve(repoRoot, expandHome(env));

  const cfgPath = path.join(repoRoot, CONFIG_FILE);
  if (existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as {
        workspace?: unknown;
      };
      if (typeof cfg.workspace === "string" && cfg.workspace.trim()) {
        return path.resolve(repoRoot, expandHome(cfg.workspace.trim()));
      }
    } catch {
      // malformed config → fall through to default
    }
  }

  return path.resolve(repoRoot, FALLBACK_DIR);
}

// Convert a wire-format path like "blueprints/foo.json" to the absolute
// filesystem path inside the configured workspace dir. The wire prefix
// is just an opaque identifier — the server stores files at
// <workspaceDir>/<basename>.
export function documentFsPath(workspaceDir: string, wirePath: string): string {
  const basename = path.posix.basename(wirePath);
  return path.join(workspaceDir, basename);
}

export const CONFIG_FILENAME = CONFIG_FILE;
export const REGISTRY_FILENAME = REGISTRY_FILE;

// The `BLUEPRINT_WORKSPACE` env value, trimmed, or null if unset/empty.
export function envWorkspaceOverride(): string | null {
  const env = process.env[ENV_VAR]?.trim();
  return env ? env : null;
}

// Write or remove `<repoRoot>/blueprint.config.json`. Pass null/empty to
// remove the file (falls back to env or default on next read).
//
// We deliberately preserve the user's original string (e.g. "~/Documents/bp")
// in the file rather than the expanded absolute path. `getWorkspaceDir`
// expands `~` on read.
export function setWorkspaceConfig(
  repoRoot: string,
  workspace: string | null,
): void {
  const cfgPath = path.join(repoRoot, CONFIG_FILE);
  const trimmed = workspace?.trim();
  if (!trimmed) {
    if (existsSync(cfgPath)) unlinkSync(cfgPath);
    return;
  }
  const cfg = { workspace: trimmed };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

export function workspaceRegistryPath(workspaceDir: string): string {
  return path.join(workspaceDir, REGISTRY_FILE);
}

// Tool-managed files that live in the workspace dir alongside user
// documents. The list endpoint and CLI exclude these so they don't
// leak into the document picker.
export function isWorkspaceToolFile(basename: string): boolean {
  return basename === REGISTRY_FILE;
}

// Read the workspace registry from <workspaceDir>/blueprint.types.toml.
// Returns null if the file doesn't exist or is malformed (caller falls
// back to the built-in default registry).
export function getWorkspaceRegistry(workspaceDir: string): Registry | null {
  const tomlPath = workspaceRegistryPath(workspaceDir);
  if (!existsSync(tomlPath)) return null;
  try {
    return normalizeRegistry(parseToml(readFileSync(tomlPath, "utf8")));
  } catch {
    return null;
  }
}

export function describeWorkspaceSource(repoRoot: string): {
  dir: string;
  source: "env" | "config" | "default";
} {
  if (process.env[ENV_VAR]?.trim()) {
    return { dir: getWorkspaceDir(repoRoot), source: "env" };
  }
  if (existsSync(path.join(repoRoot, CONFIG_FILE))) {
    // Only treat the config file as the source if it has a usable workspace
    // field; otherwise we'd silently fall back to default.
    try {
      const cfg = JSON.parse(
        readFileSync(path.join(repoRoot, CONFIG_FILE), "utf8"),
      ) as { workspace?: unknown };
      if (typeof cfg.workspace === "string" && cfg.workspace.trim()) {
        return { dir: getWorkspaceDir(repoRoot), source: "config" };
      }
    } catch {
      // ignore
    }
  }
  return { dir: getWorkspaceDir(repoRoot), source: "default" };
}
