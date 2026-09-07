import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { readJson, writeJson, stateDir } from "./store.js";

export function variantsDir(env) {
  return path.join(stateDir(env), "variants");
}

export function scopedVariantsDir(dir) {
  return path.join(dir, ".opencode-variants", "variants");
}

function walkUp(cwd) {
  const dirs = [];
  let d = path.resolve(cwd);
  for (;;) {
    dirs.push(d);
    const p = path.dirname(d);
    if (p === d) break;
    d = p;
  }
  return dirs;
}

function valid(v) {
  if (!v || typeof v !== "object" || typeof v.roles !== "object" || v.roles === null || Array.isArray(v.roles)) return false;
  for (const sel of Object.values(v.roles)) {
    if (!sel || typeof sel !== "object" || Array.isArray(sel)) return false;
  }
  return true;
}

// Nearest tree-scoped definition (<dir>/.opencode-variants/variants/<name>.json
// walking up from cwd) shadows the global store; a shadowing file that fails
// validation returns null rather than silently falling through to global.
export function resolveVariant(name, env = process.env, cwd = process.cwd()) {
  for (const d of walkUp(cwd)) {
    const file = path.join(scopedVariantsDir(d), `${name}.json`);
    if (!fs.existsSync(file)) continue;
    const v = readJson(file, null);
    return valid(v) ? { variant: { name, ...v }, scope: d } : null;
  }
  const v = readJson(path.join(variantsDir(env), `${name}.json`), null);
  return valid(v) ? { variant: { name, ...v }, scope: null } : null;
}

export function loadVariant(name, env = process.env, cwd = process.cwd()) {
  return resolveVariant(name, env, cwd)?.variant ?? null;
}

// Absolute path of the file the variant resolves from, or null.
export function variantFilePath(name, env = process.env, cwd = process.cwd()) {
  for (const d of walkUp(cwd)) {
    const file = path.join(scopedVariantsDir(d), `${name}.json`);
    if (fs.existsSync(file)) return file;
  }
  const file = path.join(variantsDir(env), `${name}.json`);
  return fs.existsSync(file) ? file : null;
}

// The tree's variant store: nearest directory (self included) owning a
// .opencode-variants/variants dir, or null when no tree store exists.
export function nearestStoreDir(cwd = process.cwd()) {
  for (const d of walkUp(cwd)) {
    if (fs.existsSync(scopedVariantsDir(d))) return d;
  }
  return null;
}

// Names visible from cwd: nearest scoped definitions shadow global ones.
export function variantNames(env = process.env, cwd = process.cwd()) {
  const out = new Set();
  for (const d of walkUp(cwd)) {
    let files = [];
    try {
      files = fs.readdirSync(scopedVariantsDir(d));
    } catch { /* none at this level */ }
    for (const f of files) if (f.endsWith(".json")) out.add(f.replace(/\.json$/, ""));
  }
  try {
    for (const f of fs.readdirSync(variantsDir(env))) {
      if (f.endsWith(".json")) out.add(f.replace(/\.json$/, ""));
    }
  } catch { /* no global store */ }
  return [...out].sort();
}

// scopeDir: tree base directory to store in; null keeps it global.
export const RESERVED = new Set(["init", "add", "use", "edit", "fork", "patch", "restrict", "restrictions", "models", "status", "show", "log", "inspect", "info", "rm", "remove", "delete", "unmanage", "detach", "forget", "prune", "serve", "cost", "help", "variants"]);

export function assertVariantName(name) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`invalid variant name: ${name}`);
  if (RESERVED.has(name)) throw new Error(`variant name '${name}' collides with an ov subcommand — pick another`);
}

export function saveVariant(variant, env = process.env, scopeDir = null) {
  assertVariantName(variant.name);
  const { name, ...rest } = variant;
  const dir = scopeDir ? scopedVariantsDir(scopeDir) : variantsDir(env);
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, `${name}.json`), rest);
}
