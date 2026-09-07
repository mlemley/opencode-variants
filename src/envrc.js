import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readJson, writeJson, stateFile } from "./store.js";
import { markerHash, contentHash } from "./generate.js";

export function writeEnvrc(dir, content, { variantName, force = false, env = process.env } = {}) {
  const target = path.join(dir, ".envrc");
  if (fs.existsSync(target)) {
    const cur = fs.readFileSync(target, "utf8");
    const h = markerHash(cur);
    const managed = Boolean(h) && h === contentHash(cur);
    if (!managed) {
      if (!force) throw new Error("refusing to overwrite hand-edited .envrc (use --force)");
      fs.copyFileSync(target, path.join(dir, ".envrc.drifted-backup"));
    }
  }
  fs.writeFileSync(target, content);
  writeJson(path.join(dir, ".opencode-variants.json"), { variant: variantName });
  registerDir(dir, env);
  const cmd = env.OV_DIRENV || "direnv";
  try {
    execFileSync(cmd, ["allow", dir], { stdio: "ignore" });
  } catch {
    console.error(`warning: run 'direnv allow ${dir}' manually`);
  }
}

export function registerDir(dir, env = process.env) {
  const file = stateFile(env, "dirs.json");
  const dirs = readJson(file, []);
  if (!dirs.includes(dir)) {
    dirs.push(dir);
    writeJson(file, dirs);
  }
}

export function loadDirs(env = process.env) {
  return readJson(stateFile(env, "dirs.json"), []);
}

export function writeDirs(dirs, env = process.env) {
  writeJson(stateFile(env, "dirs.json"), dirs);
}

function samePath(a, b) {
  if (a === b) return true;
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return false;
  }
}

export function unregisterDir(dir, env = process.env) {
  const dirs = loadDirs(env);
  const next = dirs.filter((d) => !samePath(d, dir));
  if (next.length !== dirs.length) writeDirs(next, env);
  return next.length !== dirs.length;
}

// Detach a directory: delete the generated .envrc (never a drifted one),
// the selector file, and the registry entry.
export function unmanageDir(dir, { env = process.env } = {}) {
  let envrcAction = "none";
  const envrc = path.join(dir, ".envrc");
  if (fs.existsSync(envrc)) {
    const cur = fs.readFileSync(envrc, "utf8");
    if (markerHash(cur) && markerHash(cur) === contentHash(cur)) {
      fs.rmSync(envrc);
      envrcAction = "removed .envrc";
    } else if (markerHash(cur)) {
      envrcAction = "kept drifted .envrc";
    } else {
      envrcAction = "kept unmanaged .envrc";
    }
  }
  const selPath = path.join(dir, ".opencode-variants.json");
  const hadSel = fs.existsSync(selPath);
  if (hadSel) fs.rmSync(selPath);
  const unregistered = unregisterDir(dir, env);
  const cmd = env.OV_DIRENV || "direnv";
  try {
    execFileSync(cmd, ["reload"], { stdio: "ignore", cwd: dir });
  } catch { /* best-effort; user can reload or open a new shell */ }
  return { envrcAction, hadSel, unregistered };
}

export function selectorOf(dir) {
  return readJson(path.join(dir, ".opencode-variants.json"), null);
}

// The variant currently in effect for a directory: its own selector if
// managed, else the nearest ancestor's (direnv loads the nearest .envrc).
export function nearestSelector(dir, env = process.env) {
  let d = path.resolve(dir);
  for (;;) {
    const sel = selectorOf(d);
    if (sel?.variant) return { dir: d, variant: sel.variant };
    const parent = path.dirname(d);
    if (parent === d) return null;
    d = parent;
  }
}
