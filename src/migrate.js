import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stateDir } from "./store.js";

// One-shot migration from the legacy ai-model-configure names (pre-rename
// state dir, per-dir selector, tree stores). Returns steps taken and the
// directories whose .envrc still carries the legacy marker.
export function migrateIfNeeded(env = process.env) {
  const steps = [];
  const legacyMarkerDirs = [];
  const legacyHome = env.AMC_HOME || path.join(os.homedir(), ".config", "ai-model-configure");
  const target = stateDir(env);

  if (legacyHome !== target && fs.existsSync(legacyHome)) {
    if (!fs.existsSync(target)) {
      try {
        fs.renameSync(legacyHome, target);
      } catch {
        fs.cpSync(legacyHome, target, { recursive: true });
        fs.rmSync(legacyHome, { recursive: true, force: true });
      }
      steps.push(`state: ${legacyHome} → ${target}`);
    } else {
      try {
        for (const f of fs.readdirSync(path.join(legacyHome, "variants"))) {
          const dst = path.join(target, "variants", f);
          if (!fs.existsSync(dst)) {
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            fs.copyFileSync(path.join(legacyHome, "variants", f), dst);
            steps.push(`merged variant ${f}`);
          }
        }
      } catch { /* legacy store unreadable: leave it */ }
    }
  }

  let dirs = [];
  try {
    dirs = JSON.parse(fs.readFileSync(path.join(target, "dirs.json"), "utf8"));
  } catch { /* no registry */ }
  for (const d of Array.isArray(dirs) ? dirs : []) {
    const oldSel = path.join(d, ".ai-model-configure.json");
    const newSel = path.join(d, ".opencode-variants.json");
    if (fs.existsSync(oldSel) && !fs.existsSync(newSel)) {
      fs.renameSync(oldSel, newSel);
      steps.push(`selector in ${d}`);
    }
    const oldStore = path.join(d, ".ai-model-configure");
    const newStore = path.join(d, ".opencode-variants");
    if (fs.existsSync(oldStore) && !fs.existsSync(newStore)) {
      fs.renameSync(oldStore, newStore);
      steps.push(`variant store in ${d}`);
    }
    try {
      const text = fs.readFileSync(path.join(d, ".envrc"), "utf8");
      const m = text.match(/^# managed-by: ai-model-configure \S+ @([0-9a-f]{64})/);
      if (m) {
        const body = text.slice(text.indexOf("\n") + 1);
        const h = crypto.createHash("sha256").update(body).digest("hex");
        if (h === m[1]) {
          fs.rmSync(path.join(d, ".envrc"));
          legacyMarkerDirs.push(d);
        } else {
          steps.push(`${d}/.envrc kept (drifted, legacy marker) — rebind with: ov use <variant>`);
        }
      }
    } catch { /* no .envrc */ }
  }
  return { steps, legacyMarkerDirs };
}
