import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readJson, writeJson, stateFile } from "./store.js";

const REGISTRY_URL = "https://models.dev/api.json";
const execFileAsync = promisify(execFile);

export function globalConfigPath(env = process.env) {
  return path.join(env.HOME || os.homedir(), ".config", "opencode", "opencode.json");
}

function normalize(entry) {
  return {
    "ref": entry.ref,
    "name": entry.name,
    "context": entry.context ?? null,
    "output": entry.output ?? null,
    "cost": entry.cost ?? null,
    "variants": Object.keys(entry.variants || {}),
    "variantDefs": entry.variants || null,
  };
}

export function localCatalog(opencodeJsonPath) {
  const cfg = readJson(opencodeJsonPath, {});
  const out = [];
  for (const [provider, pdef] of Object.entries(cfg.provider || {})) {
    for (const [id, m] of Object.entries(pdef?.models || {})) {
      out.push(normalize({
        ref: `${provider}/${id}`,
        name: m.name || id,
        context: m.limit?.context,
        output: m.limit?.output,
        cost: m.cost,
        variants: m.variants,
      }));
    }
  }
  return out;
}

export function normalizeRemote(api) {
  const out = [];
  for (const [provider, pdata] of Object.entries(api?.providers || {})) {
    for (const [id, m] of Object.entries(pdata?.models || {})) {
      out.push(normalize({
        ref: `${provider}/${id}`,
        name: m.name || id,
        context: m.limit?.context,
        output: m.limit?.output,
        cost: m.cost,
        variants: m.variants,
      }));
    }
  }
  return out;
}

export function mergeCatalog(local, remote = []) {
  const map = new Map();
  for (const m of remote) map.set(m.ref, m);
  for (const m of local) {
    const prev = map.get(m.ref);
    if (!prev) {
      map.set(m.ref, m);
      continue;
    }
    // Local wins, but null/empty values from a sparse local entry must not
    // clobber real metadata (limits, cost, efforts) from live/cache.
    const merged = { ...prev };
    for (const [k, v] of Object.entries(m)) {
      if (v === null || v === undefined) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      merged[k] = v;
    }
    map.set(m.ref, merged);
  }
  return [...map.values()].sort((a, b) => a.ref.localeCompare(b.ref));
}

export async function refreshCatalog({ env = process.env, fetchFn = globalThis.fetch, opencodeJson = globalConfigPath(env) } = {}) {
  let remote = [];
  try {
    remote = normalizeRemote(await (await fetchFn(REGISTRY_URL)).json());
  } catch {
    // offline: cache + local definitions still work
  }
  const merged = mergeCatalog(localCatalog(opencodeJson), remote);
  writeJson(stateFile(env, "models.json"), merged);
  return merged;
}

export function loadCatalog({ env = process.env, opencodeJson = globalConfigPath(env) } = {}) {
  const cached = readJson(stateFile(env, "models.json"), []);
  return mergeCatalog(localCatalog(opencodeJson), cached);
}

export function cleanEnvForProbe(env) {
  const { OPENCODE_CONFIG_CONTENT, ...rest } = env;
  return rest;
}

function defaultRunOpencode(env) {
  const bin = env.OV_OPENCODE_BIN || "opencode";
  // Probe with a sanitized env: if OPENCODE_CONFIG_CONTENT is exported
  // (e.g. by a direnv-loaded managed .envrc we generated), opencode restricts
  // its model list to the injected config instead of listing all models.
  return execFileAsync(bin, ["models", "--verbose"], { env: cleanEnvForProbe(env) }).then(({ stdout }) => stdout);
}

// `opencode models --verbose` prints "provider/ref" followed by an indented
// JSON object (top level closes with "}" at column 0). Plain output
// (no --verbose support / older builds) is just ref lines; both parse.
export function parseLive(raw) {
  const out = [];
  let cur = null; // { ref, lines: [] }
  const flush = () => {
    if (!cur) return;
    let meta = {};
    if (cur.lines.length) {
      try {
        meta = JSON.parse(cur.lines.join("\n"));
      } catch {
        meta = {};
      }
    }
    const { ref } = cur;
    if (meta && typeof meta === "object" && Object.keys(meta).length) {
      out.push(normalize({
        ref,
        name: meta.name || ref.split("/")[1],
        context: meta.limit?.context,
        output: meta.limit?.output,
        cost: meta.cost,
        variants: meta.variants,
      }));
    } else {
      // Plain output: ref only, so cached/config metadata merges over it.
      out.push({ ref });
    }
    cur = null;
  };
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    if (cur && (line.startsWith("{") || line.startsWith("}") || line.startsWith(" ") || line.startsWith("\t"))) {
      cur.lines.push(line);
      if (line === "}") flush();
      continue;
    }
    flush(); // previous ref had no (or incomplete) JSON block
    cur = { ref: line.trim(), lines: [] };
  }
  flush();
  return out;
}

export async function discoverCatalog({ env = process.env, run = () => defaultRunOpencode(env), opencodeJson = globalConfigPath(env) } = {}) {
  let live = [];
  try {
    live = parseLive(await run());
  } catch {
    console.error("warning: 'opencode models' unavailable; using cached catalog + configs");
  }
  const cached = readJson(stateFile(env, "models.json"), []);
  // live entries carry metadata from `--verbose` and override cache; local
  // config entries (custom variant defs) always win.
  const merged = mergeCatalog(localCatalog(opencodeJson), mergeCatalog(live, cached));
  writeJson(stateFile(env, "models.json"), merged);
  return merged;
}
