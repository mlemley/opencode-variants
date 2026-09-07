import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeEnvrc, loadDirs, selectorOf } from "../src/envrc.js";
import { renderEnvrc } from "../src/generate.js";

function setup() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-dir-")));
  const env = { OV_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "amc-state-")), OV_DIRENV: "/usr/bin/true" };
  const content = renderEnvrc({ provider: {}, agent: {} }, { variantName: "t", cwd: dir });
  return { dir, env, content };
}

test("writes .envrc, selector file, registers dir", () => {
  const { dir, env, content } = setup();
  writeEnvrc(dir, content, { variantName: "t", env });
  assert.equal(fs.readFileSync(path.join(dir, ".envrc"), "utf8"), content);
  assert.equal(selectorOf(dir).variant, "t");
  assert.deepEqual(loadDirs(env), [dir]);
});

test("managed files may be overwritten by newer generations", () => {
  const { dir, env, content } = setup();
  writeEnvrc(dir, content, { variantName: "t", env });
  const newer = renderEnvrc({ provider: {}, agent: {} }, { variantName: "u", cwd: dir });
  writeEnvrc(dir, newer, { variantName: "u", env });
  assert.equal(selectorOf(dir).variant, "u");
});

test("refuses hand-edited .envrc; --force backs it up first", () => {
  const { dir, env, content } = setup();
  fs.writeFileSync(path.join(dir, ".envrc"), "hand written\n");
  assert.throws(
    () => writeEnvrc(dir, content, { variantName: "t", env }),
    /refusing to overwrite hand-edited/,
  );
  writeEnvrc(dir, content, { variantName: "t", force: true, env });
  assert.equal(fs.readFileSync(path.join(dir, ".envrc.drifted-backup"), "utf8"), "hand written\n");
});
