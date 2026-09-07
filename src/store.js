import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export function stateDir(env = process.env) {
  return env.OV_HOME || path.join(os.homedir(), ".config", "opencode-variants");
}

export function stateFile(env, name) {
  return path.join(stateDir(env), name);
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}
