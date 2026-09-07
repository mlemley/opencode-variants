import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stateDir, stateFile, readJson, writeJson } from "../src/store.js";

test("stateDir honors OV_HOME and defaults to ~/.config/opencode-variants", () => {
  assert.equal(stateDir({ OV_HOME: "/tmp/x" }), "/tmp/x");
  assert.equal(stateDir({}), path.join(os.homedir(), ".config", "opencode-variants"));
});

test("stateFile joins under stateDir", () => {
  assert.equal(stateFile({ OV_HOME: "/tmp/x" }, "slots.json"), path.join("/tmp/x", "slots.json"));
});

test("readJson falls back on missing or corrupt file", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "amc-store-"));
  assert.deepEqual(readJson(path.join(d, "nope.json"), { ok: 1 }), { ok: 1 });
  fs.writeFileSync(path.join(d, "bad.json"), "{oops");
  assert.equal(readJson(path.join(d, "bad.json"), null), null);
});

test("writeJson round-trips and creates parent dirs", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "amc-store-"));
  const f = path.join(d, "nested", "a.json");
  writeJson(f, { a: 1 });
  assert.deepEqual(readJson(f), { a: 1 });
});
