import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_SLOTS, loadSlots, saveSlots } from "../src/slots.js";

test("loadSlots defaults to unset slots; saveSlots round-trips", () => {
  const env = { OV_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "amc-slots-")) };
  assert.deepEqual(loadSlots(env), DEFAULT_SLOTS);
  assert.equal(DEFAULT_SLOTS["model-reasoning"], null);
  saveSlots({ ...loadSlots(env), "model-fast": "prov/x" }, env);
  assert.equal(loadSlots(env)["model-fast"], "prov/x");
});

test("defaults merge into partial or legacy files without clobbering", () => {
  const env = { OV_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "amc-slots-")) };
  fs.writeFileSync(
    path.join(env.OV_HOME, "slots.json"),
    JSON.stringify({ "local-fast": "old/x", "model-reasoning": "keep/y" }),
  );
  const s = loadSlots(env);
  assert.equal(s["model-reasoning"], "keep/y");
  assert.equal(s["model-fast"], null);
  assert.equal(s["local-fast"], "old/x");
});
