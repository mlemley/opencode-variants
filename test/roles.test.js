import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveRoles } from "../src/roles.js";

test("resolveRoles merges built-ins, global json+markdown, project-upward config, env content", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "amc-home-"));
  fs.mkdirSync(path.join(home, ".config", "opencode", "agent"), { recursive: true });
  fs.writeFileSync(path.join(home, ".config", "opencode", "opencode.json"), JSON.stringify({
    agent: { plan: { model: "m-global" }, reviewer: { model: "r-global" } },
  }));
  fs.writeFileSync(path.join(home, ".config", "opencode", "agent", "scout.md"),
    "---\nmode: subagent\nmodel: acme/old\n---\nexplore thing\n");

  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "amc-proj-"));
  fs.mkdirSync(path.join(proj, ".opencode", "agent"), { recursive: true });
  fs.writeFileSync(path.join(proj, "opencode.json"), JSON.stringify({
    agent: { reviewer: { model: "r-project" } },
  }));
  fs.writeFileSync(path.join(proj, ".opencode", "agent", "picker.md"), "---\nmode: primary\n---\n");

  const env = {
    HOME: home,
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ agent: { plan: { model: "m-env" } } }),
  };
  const roles = resolveRoles({ cwd: path.join(proj, "sub", "deep"), env });

  assert.equal(roles.plan.model, "m-env", "OPENCODE_CONFIG_CONTENT wins last");
  assert.equal(roles.reviewer.model, "r-project", "project opencode.json beats global");
  assert.equal(roles.scout.mode, "subagent", "global markdown agent discovered");
  assert.ok(roles.picker, "project markdown agent discovered");
  assert.ok(roles.build, "built-in build present");
});

test("resolveRoles tolerates missing files and malformed env content", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "amc-home-"));
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "amc-proj-"));
  const roles = resolveRoles({ cwd: proj, env: { HOME: home, OPENCODE_CONFIG_CONTENT: "{oops" } });
  assert.ok(roles.build && roles.plan);
});

test("resolveRoles skips unreadable agent files (dangling symlink)", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "amc-home-"));
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "amc-proj-"));
  fs.mkdirSync(path.join(proj, ".opencode", "agent"), { recursive: true });
  fs.symlinkSync(path.join(proj, "does-not-exist.md"), path.join(proj, ".opencode", "agent", "draft.md"));
  const roles = resolveRoles({ cwd: proj, env: { HOME: home } });
  assert.ok(roles.build && !roles.draft);
});
