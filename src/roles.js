import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readJson } from "./store.js";

export function resolveRoles({ cwd = process.cwd(), env = process.env } = {}) {
  const home = env.HOME || os.homedir();
  const roles = {};
  const apply = (name, patch) => { roles[name] = { ...(roles[name] || {}), ...(patch || {}) }; };

  for (const n of ["build", "plan"]) apply(n);

  const layers = [{
    json: path.join(home, ".config", "opencode", "opencode.json"),
    mdDirs: [
      path.join(home, ".config", "opencode", "agent"),
      path.join(home, ".config", "opencode", "agents"),
    ],
  }];

  const chain = [];
  let dir = path.resolve(cwd);
  while (true) {
    chain.unshift(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const d of chain) {
    layers.push({
      json: path.join(d, "opencode.json"),
      mdDirs: [
        path.join(d, ".opencode", "agent"),
        path.join(d, ".opencode", "agents"),
        path.join(d, "agent"),
        path.join(d, "agents"),
      ],
    });
  }
  for (const layer of layers) applyLayer(layer, apply);

  if (env.OPENCODE_CONFIG_CONTENT) {
    try {
      const cfg = JSON.parse(env.OPENCODE_CONFIG_CONTENT);
      for (const [n, a] of Object.entries(cfg.agent || {})) apply(n, a);
    } catch {
      // malformed inherited content ignored; built-ins/global still apply
    }
  }
  return roles;
}

function applyLayer({ json, mdDirs }, apply) {
  const cfg = readJson(json, null);
  if (cfg?.agent) {
    for (const [n, a] of Object.entries(cfg.agent)) apply(n, a);
  }
  for (const d of mdDirs) {
    let files = [];
    try {
      files = fs.readdirSync(d).filter((f) => f.endsWith(".md"));
    } catch {
      continue;
    }
    for (const f of files) {
      try {
        const fm = frontmatter(fs.readFileSync(path.join(d, f), "utf8"));
        const patch = {};
        if (fm.mode) patch.mode = fm.mode;
        if (fm.model) patch.model = fm.model;
        apply(f.replace(/\.md$/, ""), patch);
      } catch {
        continue;
      }
    }
  }
}

function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fm = {};
  if (!m) return fm;
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return fm;
}
